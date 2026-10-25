import "server-only";

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { geminiApiCallLogs, settings } from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultGeminiApiLimits,
  type GeminiApiLimits,
  parseGeminiApiLimits,
} from "@/server/gemini/gemini-api-limits";
import { geminiModel } from "@/server/gemini/gemini-request";

export { geminiModel };
export { defaultGeminiApiLimits, type GeminiApiLimits };

export type GeminiApiOperation = "generate_content" | "count_tokens";

const maxStoredGeminiResponseBytes = 1_000_000;

export async function requestGeminiApi(
  apiKey: string,
  operation: GeminiApiOperation,
  url: string,
  init: RequestInit,
  tokenCounts: { local?: number | null; gemini?: number | null } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const [log] = await db
    .insert(geminiApiCallLogs)
    .values({
      keyHash: getGeminiApiKeyHash(apiKey),
      operation,
      status: "pending",
      localInputTokens: tokenCounts.local ?? null,
      geminiInputTokens: tokenCounts.gemini ?? null,
    })
    .returning({ id: geminiApiCallLogs.id });
  if (!log) throw new Error("Could not create Gemini API request log.");

  const startedAt = Date.now();
  let response: Response;
  let body: string;
  try {
    response = await fetch(url, init);
    body = await response.text();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown network error.";
    await db
      .update(geminiApiCallLogs)
      .set({
        status: "network_error",
        errorMessage: errorMessage.replaceAll(apiKey, "[redacted]").slice(0, 500),
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(geminiApiCallLogs.id, log.id));
    throw error;
  }

  const safeBody = body.replaceAll(apiKey, "[redacted]");
  const bodyBuffer = Buffer.from(safeBody, "utf8");
  const responseTruncated = bodyBuffer.byteLength > maxStoredGeminiResponseBytes;
  const storedBody = responseTruncated
    ? bodyBuffer.subarray(0, maxStoredGeminiResponseBytes).toString("utf8")
    : safeBody;
  await db
    .update(geminiApiCallLogs)
    .set({
      status: response.ok ? "http_success" : "http_error",
      httpStatus: response.status,
      responseBody: storedBody,
      responseTruncated,
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
    })
    .where(eq(geminiApiCallLogs.id, log.id));

  return { ok: response.ok, status: response.status, body };
}

export async function getGeminiApiLimits(): Promise<GeminiApiLimits> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "gemini_api_limits"))
    .limit(1);
  if (!row) return { ...defaultGeminiApiLimits };
  const limits = parseGeminiApiLimits(row.value);
  if (!limits) {
    throw new Error("Saved Gemini API limits are invalid. Update them in Gemini Usage settings.");
  }
  return limits;
}

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

export async function acquireGeminiKey(
  apiKey: string,
  limits: GeminiApiLimits,
): Promise<string | null> {
  const keyHash = getGeminiApiKeyHash(apiKey);
  const result = await db.execute<{ leaseId: string | null }>(sql`
    select try_acquire_gemini_key(
      ${keyHash},
      ${limits.requestsPerMinute},
      ${limits.requestsPerDay}
    )::text as "leaseId"
  `);
  return result.rows[0]?.leaseId ?? null;
}

export async function reserveGeminiGeneration(
  apiKey: string,
  leaseId: string,
  inputTokens: number,
  limits: GeminiApiLimits,
): Promise<boolean> {
  const keyHash = getGeminiApiKeyHash(apiKey);
  const result = await db.execute<{ allowed: boolean }>(sql`
    select reserve_gemini_generation(
      ${keyHash},
      ${leaseId}::uuid,
      ${inputTokens},
      ${limits.requestsPerMinute},
      ${limits.requestsPerDay},
      ${limits.inputTokensPerMinute}
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

export async function recordGeminiApiCall(
  apiKey: string,
  operation: "generate_content" | "count_tokens",
  inputTokens = 0,
): Promise<void> {
  await db.execute(sql`
    insert into gemini_key_usage_events (key_hash, operation, input_tokens)
    values (${getGeminiApiKeyHash(apiKey)}, ${operation}, ${inputTokens})
  `);
}
