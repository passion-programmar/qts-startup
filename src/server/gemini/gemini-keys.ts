import "server-only";

import { randomInt } from "node:crypto";
import {
  acquireGeminiKey,
  geminiModel,
  pauseGeminiKey,
  type getGeminiApiLimits,
  recordGeminiApiCall,
  releaseGeminiKey,
  requestGeminiApi,
  reserveGeminiGeneration,
} from "@/lib/gemini-usage";
import { estimateGeminiInputTokens } from "@/server/gemini/gemini-request";
import type { GeminiTokenCountMode } from "@/server/gemini/token-count-mode";
import { GEMINI_UNAVAILABLE_PAUSE_MINUTES, withGeminiKeyFailover } from "@/server/gemini/gemini-retry";

// Shared by Get JD and Apply's Gemini answers: picking a Gemini key that has room under QTS's
// limits, counting tokens the configured way, and reading Gemini's replies and errors.

export type GeminiTokenCounts = { local: number; gemini: number | null };
export type GeminiContent = { role: "user" | "model"; parts: { text: string }[] };
type GenerationConfig = Parameters<typeof estimateGeminiInputTokens>[1];

/** An Error carrying a diagnostic code (gemini_http_429, ...) and Gemini's own message. */
export function geminiError(code: string, message: string, providerMessage?: string): Error {
  return Object.assign(new Error(message), { code, providerMessage });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Gemini's error message without the key, or undefined. */
export function readGeminiErrorMessage(responseBody: string, apiKey: string): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(responseBody) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const message = body.error.message;
  if (typeof message !== "string") return undefined;
  const safeMessage = message
    .replaceAll(apiKey, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return safeMessage || undefined;
}

/** The text of Gemini's first candidate reply. */
export function readGeminiText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return "";
  const candidate = value.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) return "";
  if (!Array.isArray(candidate.content.parts)) return "";
  return candidate.content.parts
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function requestGeminiTokenCount(apiKey: string, contents: GeminiContent[], config: GenerationConfig): Promise<number> {
  await recordGeminiApiCall(apiKey, "count_tokens");
  const response = await requestGeminiApi(
    apiKey,
    "count_tokens",
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:countTokens`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        generateContentRequest: {
          model: `models/${geminiModel}`,
          contents,
          generationConfig: config,
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw geminiError(
      `gemini_count_tokens_http_${response.status}`,
      "Gemini CountTokens failed.",
      readGeminiErrorMessage(response.body, apiKey),
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(response.body) as unknown;
  } catch {
    throw geminiError("gemini_count_tokens_invalid_response", "Gemini CountTokens returned invalid JSON.");
  }
  if (!isRecord(data) || typeof data.totalTokens !== "number" || !Number.isSafeInteger(data.totalTokens) || data.totalTokens < 0) {
    throw geminiError("gemini_count_tokens_invalid_response", "Gemini CountTokens returned invalid data.");
  }
  return data.totalTokens;
}

/**
 * A Gemini key with room for this request, its lease, and the counted tokens; null when every key
 * is busy or at QTS's limits. Keys are tried in random order. The caller releases the lease.
 */
export async function selectAvailableGeminiApiKey(
  apiKeys: string[],
  contents: GeminiContent[],
  config: GenerationConfig,
  tokenCountMode: GeminiTokenCountMode,
  limits: Awaited<ReturnType<typeof getGeminiApiLimits>>,
): Promise<{ apiKey: string; leaseId: string; tokenCounts: GeminiTokenCounts } | null> {
  const shuffledKeys = [...apiKeys];
  for (let index = shuffledKeys.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffledKeys[index], shuffledKeys[swapIndex]] = [shuffledKeys[swapIndex], shuffledKeys[index]];
  }
  const promptText = contents.flatMap((content) => content.parts.map((part) => part.text)).join("\n\n");

  for (const apiKey of shuffledKeys) {
    const leaseId = await acquireGeminiKey(apiKey, limits);
    if (!leaseId) continue;
    try {
      // Local Count: the local estimate only, with no CountTokens call. Gemini Count: both,
      // recorded side by side for comparison; the key's limit uses Google's count.
      const tokenCounts: GeminiTokenCounts = {
        local: estimateGeminiInputTokens(promptText, config),
        gemini: tokenCountMode === "gemini" ? await requestGeminiTokenCount(apiKey, contents, config) : null,
      };
      if (await reserveGeminiGeneration(apiKey, leaseId, tokenCounts.gemini ?? tokenCounts.local, limits)) {
        return { apiKey, leaseId, tokenCounts };
      }
    } catch (error) {
      await releaseGeminiKey(apiKey, leaseId);
      throw error;
    }
    await releaseGeminiKey(apiKey, leaseId);
  }
  return null;
}

/**
 * Runs one Gemini request with a free key (see selectAvailableGeminiApiKey). When Gemini answers
 * a key "unavailable" (5xx, for example 503 "high demand"), that key is paused for 5 minutes and
 * the request goes to another free key (up to three keys). Null when no key is free.
 */
export async function withAvailableGeminiKey<T>(
  apiKeys: string[],
  contents: GeminiContent[],
  config: GenerationConfig,
  tokenCountMode: GeminiTokenCountMode,
  limits: Awaited<ReturnType<typeof getGeminiApiLimits>>,
  run: (key: { apiKey: string; tokenCounts: GeminiTokenCounts }) => Promise<T>,
): Promise<T | null> {
  return withGeminiKeyFailover({
    select: (excluded) => selectAvailableGeminiApiKey(apiKeys.filter((apiKey) => !excluded.has(apiKey)), contents, config, tokenCountMode, limits),
    run,
    pause: ({ apiKey }) => pauseGeminiKey(apiKey, GEMINI_UNAVAILABLE_PAUSE_MINUTES),
    release: ({ apiKey, leaseId }) => releaseGeminiKey(apiKey, leaseId),
  });
}
