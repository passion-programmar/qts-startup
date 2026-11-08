import "server-only";

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { geminiApiCallLogs, settings } from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultGeminiApiLimits,
  type GeminiApiLimits,
  maxGeminiRequestsPerMinute,
  parseGeminiApiLimits,
} from "@/server/gemini/gemini-api-limits";
import { geminiModel } from "@/server/gemini/gemini-request";

export { geminiModel };
export { defaultGeminiApiLimits, type GeminiApiLimits };

export type GeminiApiOperation = "generate_content" | "count_tokens";

const maxStoredGeminiResponseBytes = 1_000_000;

// Provider response records are kept for today and the two previous Pacific days. Older ones are
// removed by the daily clean-up, and when a Super Admin opens Gemini Usage.
export async function removeOldGeminiApiCallLogs(): Promise<number> {
  const olderThanKeptDays = sql`${geminiApiCallLogs.startedAt} < (
    date_trunc('day', now() at time zone 'America/Los_Angeles') - interval '2 days'
  ) at time zone 'America/Los_Angeles'`;
  try {
    const [old] = await db.select({ id: geminiApiCallLogs.id }).from(geminiApiCallLogs).where(olderThanKeptDays).limit(1);
    if (!old) return 0;
    const removed = await db.delete(geminiApiCallLogs).where(olderThanKeptDays).returning({ id: geminiApiCallLogs.id });
    return removed.length;
  } catch (error) {
    // Cleanup must never block the Gemini Usage page.
    console.warn("Could not remove old Gemini API response records.", error instanceof Error ? error.name : error);
    return 0;
  }
}

/**
 * One request to Gemini or Groq, recorded in the responses list. `logKey` files the record under a
 * key + model slot; without it the record goes under the key alone.
 */
export async function requestGeminiApi(
  apiKey: string,
  operation: GeminiApiOperation,
  url: string,
  init: RequestInit,
  tokenCounts: { local?: number | null; gemini?: number | null } = {},
  logKey?: string,
): Promise<{ ok: boolean; status: number; body: string; retryAfter: string | null }> {
  const [log] = await db
    .insert(geminiApiCallLogs)
    .values({
      keyHash: logKey ?? getGeminiApiKeyHash(apiKey),
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

  return { ok: response.ok, status: response.status, body, retryAfter: response.headers.get("retry-after") };
}

/** The per-key limits still used by the token comparison tool. Live requests use per-model limits. */
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
  return { ...limits, requestsPerMinute: Math.min(limits.requestsPerMinute, maxGeminiRequestsPerMinute) };
}

const parseKeyList = (value: string | undefined): string[] => [
  ...new Set((value ?? "").split(",").map((apiKey) => apiKey.trim()).filter(Boolean)),
];

export function getGeminiApiKeys(): string[] {
  const configuredKeys = parseKeyList(process.env.GEMINI_API_KEYS);
  if (configuredKeys.length) return configuredKeys;

  const singleKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.JD_READ_PROMPT_GEMINI_API_KEY_1?.trim();
  return singleKey ? [singleKey] : [];
}

export function getGroqApiKeys(): string[] {
  return parseKeyList(process.env.GROQ_API_KEYS);
}

export function getGeminiApiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

type SlotLimits = Pick<GeminiApiLimits, "requestsPerMinute" | "requestsPerDay" | "inputTokensPerMinute">;

/** Takes a key + model slot for one request, if it's free and under its limits. */
export async function acquireAiSlot(slotId: string, limits: SlotLimits): Promise<string | null> {
  const result = await db.execute<{ leaseId: string | null }>(sql`
    select try_acquire_gemini_key(
      ${slotId},
      ${limits.requestsPerMinute},
      ${limits.requestsPerDay}
    )::text as "leaseId"
  `);
  return result.rows[0]?.leaseId ?? null;
}

/** Counts the call against the slot's limits. False means the slot had no room after all. */
export async function reserveAiSlot(slotId: string, leaseId: string, inputTokens: number, limits: SlotLimits): Promise<boolean> {
  const result = await db.execute<{ allowed: boolean }>(sql`
    select reserve_gemini_generation(
      ${slotId},
      ${leaseId}::uuid,
      ${inputTokens},
      ${limits.requestsPerMinute},
      ${limits.requestsPerDay},
      ${limits.inputTokensPerMinute}
    ) as allowed
  `);
  return result.rows[0]?.allowed === true;
}

export async function releaseAiSlot(slotId: string, leaseId: string): Promise<void> {
  await db.execute(sql`
    select release_gemini_key(${slotId}, ${leaseId}::uuid)
  `);
}

export async function recordAiSlotCall(
  slotId: string,
  operation: GeminiApiOperation,
  inputTokens = 0,
): Promise<void> {
  await db.execute(sql`
    insert into gemini_key_usage_events (key_hash, operation, input_tokens)
    values (${slotId}, ${operation}, ${inputTokens})
  `);
}

export const acquireGeminiKey = (apiKey: string, limits: GeminiApiLimits) => acquireAiSlot(getGeminiApiKeyHash(apiKey), limits);
export const releaseGeminiKey = (apiKey: string, leaseId: string) => releaseAiSlot(getGeminiApiKeyHash(apiKey), leaseId);
export const recordGeminiApiCall = (apiKey: string, operation: GeminiApiOperation, inputTokens = 0) =>
  recordAiSlotCall(getGeminiApiKeyHash(apiKey), operation, inputTokens);
