import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { geminiModel } from "@/server/gemini/gemini-request";

export { geminiModel };

export const geminiApiLimits = {
  requestsPerMinute: 9,
  requestsPerDay: 200,
  inputTokensPerMinute: 25_000,
} as const;

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
