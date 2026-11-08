import "server-only";

import { recordAiSlotCall, requestGeminiApi } from "@/lib/gemini-usage";

// Reading Gemini's errors, and asking Google to count a request's tokens in Gemini Count mode.

export type GeminiTokenCounts = { local: number; gemini: number | null };
export type GeminiContent = { role: "user" | "model"; parts: { text: string }[] };

/** An Error carrying a diagnostic code (gemini_http_429, ...) and Gemini's own message. */
function geminiError(code: string, message: string, providerMessage?: string): Error {
  return Object.assign(new Error(message), { code, providerMessage });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Gemini's error message without the key, or undefined. */
function readGeminiErrorMessage(responseBody: string, apiKey: string): string | undefined {
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

/** Google's own token count for a request, as one more call on that key + model slot. */
export async function requestGeminiTokenCount(
  apiKey: string,
  modelId: string,
  slotId: string,
  contents: GeminiContent[],
  config: Record<string, unknown>,
): Promise<number> {
  await recordAiSlotCall(slotId, "count_tokens");
  const response = await requestGeminiApi(
    apiKey,
    "count_tokens",
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:countTokens`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        generateContentRequest: {
          model: `models/${modelId}`,
          contents,
          generationConfig: config,
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
    {},
    slotId,
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
