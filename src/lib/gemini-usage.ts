import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const geminiApiLimits = {
  requestsPerMinute: 9,
  requestsPerDay: 200,
  inputTokensPerMinute: 25_000,
} as const;

export const geminiModel = "gemini-3.5-flash-lite";

export function getGeminiApiKeys(): string[] {
  const configuredKeys = process.env.GEMINI_API_KEYS
    ?.split(",")
    .map((apiKey) => apiKey.trim())
    .filter(Boolean);
  if (configuredKeys?.length) return [...new Set(configuredKeys)];

  const singleKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.JD_READ_PROMPT_GEMINI_API_KEY_1?.trim();
  return singleKey ? [singleKey] : [];
}

export function getGeminiApiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function acquireGeminiKey(apiKey: string): Promise<string | null> {
  const keyHash = getGeminiApiKeyHash(apiKey);
  const result = await db.execute<{ leaseId: string | null }>(sql`
    select try_acquire_gemini_key(
      ${keyHash},
      ${geminiApiLimits.requestsPerMinute},
      ${geminiApiLimits.requestsPerDay}
    )::text as "leaseId"
  `);
  return result.rows[0]?.leaseId ?? null;
}

export async function reserveGeminiGeneration(
  apiKey: string,
  leaseId: string,
  inputTokens: number,
): Promise<boolean> {
  const keyHash = getGeminiApiKeyHash(apiKey);
  const result = await db.execute<{ allowed: boolean }>(sql`
    select reserve_gemini_generation(
      ${keyHash},
      ${leaseId}::uuid,
      ${inputTokens},
      ${geminiApiLimits.requestsPerMinute},
      ${geminiApiLimits.requestsPerDay},
      ${geminiApiLimits.inputTokensPerMinute}
    ) as allowed
  `);
  return result.rows[0]?.allowed === true;
}

export async function releaseGeminiKey(
  apiKey: string,
  leaseId: string,
): Promise<void> {
  const keyHash = getGeminiApiKeyHash(apiKey);
  await db.execute(sql`
    select release_gemini_key(${keyHash}, ${leaseId}::uuid)
  `);
}

export async function countGeminiInputTokens(
  apiKey: string,
  prompt: string,
  generationConfig: Record<string, unknown>,
): Promise<number> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:countTokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        generateContentRequest: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const providerMessage = await readGeminiErrorMessage(response, apiKey);
    throw Object.assign(
      new Error(`Gemini CountTokens returned HTTP ${response.status}.`),
      {
        code: `gemini_count_tokens_http_${response.status}`,
        providerMessage,
      },
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw Object.assign(
      new Error("Gemini CountTokens returned an invalid response."),
      { code: "gemini_count_tokens_invalid_response" },
    );
  }
  if (
    typeof data !== "object" ||
    data === null ||
    !("totalTokens" in data) ||
    typeof data.totalTokens !== "number" ||
    !Number.isSafeInteger(data.totalTokens) ||
    data.totalTokens < 0
  ) {
    throw Object.assign(
      new Error("Gemini CountTokens response did not contain a valid token count."),
      { code: "gemini_count_tokens_invalid_response" },
    );
  }
  return data.totalTokens;
}

async function readGeminiErrorMessage(
  response: Response,
  apiKey: string,
): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("error" in body) ||
    typeof body.error !== "object" ||
    body.error === null ||
    !("message" in body.error) ||
    typeof body.error.message !== "string"
  ) {
    return undefined;
  }
  return body.error.message
    .replaceAll(apiKey, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}
