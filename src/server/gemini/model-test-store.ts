import "server-only";

import { eq, inArray, sql } from "drizzle-orm";
import { settings as settingsTable } from "@/db/schema";
import { db } from "@/lib/db";
import { getGeminiApiKeyHash } from "@/lib/gemini-usage";
import {
  defaultModelTestSettings,
  parseModelTestRun,
  parseModelTestSettings,
  type ModelTestKeyState,
  type ModelTestRun,
  type ModelTestSettings,
} from "@/server/gemini/model-test";

// The Model test keeps one row of settings and one row of counts. Both are overwritten or cleared
// by the Super Admin, so they never grow into many rows.

const settingsKey = "gemini_model_test_settings";
const runKey = "gemini_model_test_run";

/** A short id for a key in saved counts and on the page. The key itself is never saved. */
export const modelTestKeyId = (apiKey: string): string => getGeminiApiKeyHash(apiKey).slice(0, 16);

export async function readModelTestState(): Promise<{ settings: ModelTestSettings; run: ModelTestRun | null; readAt: number }> {
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(inArray(settingsTable.key, [settingsKey, runKey]));
  const valueOf = (key: string) => rows.find((row) => row.key === key)?.value;
  return {
    settings: parseModelTestSettings(valueOf(settingsKey)) ?? defaultModelTestSettings(),
    run: parseModelTestRun(valueOf(runKey)),
    readAt: Date.now(),
  };
}

export async function saveModelTestSettings(value: ModelTestSettings, userId: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: settingsKey, value, updatedByUserId: userId })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedByUserId: userId, updatedAt: new Date() } });
}

export async function clearModelTestSettings(): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, settingsKey));
}

export async function writeModelTestRun(run: ModelTestRun): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: runKey, value: run })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: run, updatedAt: new Date() } });
}

export async function clearModelTestRun(): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, runKey));
}

/**
 * Saves one key's counts in a single statement, only if that run still exists and nobody has saved
 * this key since it was read. False means the save was refused.
 */
export async function writeModelTestKey(
  runId: string,
  keyId: string,
  expectedVersion: number,
  state: ModelTestKeyState,
): Promise<boolean> {
  const result = await db.execute<{ key: string }>(sql`
    update settings
    set value = jsonb_set(value, array['keys', ${keyId}::text], ${JSON.stringify(state)}::jsonb),
      updated_at = now()
    where key = ${runKey}
      and value->>'runId' = ${runId}
      and (value #>> array['keys', ${keyId}::text, 'version'])::integer = ${expectedVersion}
    returning key
  `);
  return result.rows.length > 0;
}
