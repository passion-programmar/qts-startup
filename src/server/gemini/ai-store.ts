import "server-only";

import { and, gte, inArray, sql } from "drizzle-orm";
import { geminiKeyUsageEvents, settings as settingsTable } from "@/db/schema";
import { db } from "@/lib/db";
import {
  aiSlotId,
  isAiModelId,
  pacificDay,
  readSavedAiLimits,
  type AiLimits,
  type AiSlotPauses,
  type AiSlotUsage,
} from "@/server/gemini/ai-models";
import type { AiJobState } from "@/server/gemini/ai-job";
import { modelTestRunSetting, parseModelTestRun, type ModelTestRun } from "@/server/gemini/model-test";

// What's saved about the key + model slots. Limits, pauses and rotation are one settings row each,
// bounded by the number of slots. Calls are counted in the usage table under the slot's id.

const limitsSetting = "gemini_model_limits";
const pausesSetting = "gemini_slot_pauses";
const roundSetting = "gemini_key_round";

const pacificDayStart = sql`
  date_trunc('day', now() at time zone 'America/Los_Angeles')
    at time zone 'America/Los_Angeles'
`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function readAiSlotUsage(slotIds: string[]): Promise<Map<string, AiSlotUsage>> {
  if (!slotIds.length) return new Map();
  const rows = await db
    .select({
      slotId: geminiKeyUsageEvents.keyHash,
      minuteCalls: sql<number>`(count(*) filter (where ${geminiKeyUsageEvents.occurredAt} > now() - interval '1 minute'))::integer`.mapWith(Number),
      minuteTokens: sql<number>`(coalesce(sum(${geminiKeyUsageEvents.inputTokens}) filter (where ${geminiKeyUsageEvents.occurredAt} > now() - interval '1 minute'), 0))::integer`.mapWith(Number),
      dayCalls: sql<number>`count(*)::integer`.mapWith(Number),
      dayTokens: sql<number>`(coalesce(sum(${geminiKeyUsageEvents.inputTokens}), 0))::bigint`.mapWith(Number),
    })
    .from(geminiKeyUsageEvents)
    .where(and(inArray(geminiKeyUsageEvents.keyHash, slotIds), gte(geminiKeyUsageEvents.occurredAt, pacificDayStart)))
    .groupBy(geminiKeyUsageEvents.keyHash);
  return new Map(rows.map(({ slotId, ...usage }) => [slotId, usage]));
}

/** Calls the Model test made before its calls were counted live. Runs once, for today's run only. */
async function countModelTestCallsOnce(run: ModelTestRun, keyHashes: string[]): Promise<void> {
  if (run.countedInLiveUsage || run.pacificDay !== pacificDay(Date.now())) return;
  const claimed = await db.execute<{ key: string }>(sql`
    update settings
    set value = value || '{"countedInLiveUsage":true}'::jsonb, updated_at = now()
    where key = ${modelTestRunSetting}
      and value->>'runId' = ${run.runId}
      and value->>'countedInLiveUsage' is null
    returning key
  `);
  if (!claimed.rows.length) return;
  const entries = keyHashes.flatMap((keyHash) => {
    const models = run.keys[keyHash.slice(0, 16)]?.models ?? {};
    return Object.entries(models)
      .filter(([modelId, cell]) => isAiModelId(modelId) && (cell?.calls ?? 0) > 0)
      .map(([modelId, cell]) => ({ slot: aiSlotId(keyHash, modelId), calls: cell?.calls ?? 0 }));
  });
  if (!entries.length) return;
  await db.execute(sql`
    insert into gemini_key_usage_events (key_hash, operation, input_tokens)
    select entry.slot, 'generate_content', 0
    from jsonb_to_recordset(${JSON.stringify(entries)}::jsonb) as entry(slot text, calls integer),
      lateral generate_series(1, entry.calls)
  `);
}

export async function readAiSettings(): Promise<{ limits: AiLimits; pauses: AiSlotPauses }> {
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(inArray(settingsTable.key, [limitsSetting, pausesSetting]));
  const valueOf = (key: string) => rows.find((row) => row.key === key)?.value;
  const pauses = valueOf(pausesSetting);
  return { limits: readSavedAiLimits(valueOf(limitsSetting)), pauses: isRecord(pauses) ? pauses as AiSlotPauses : {} };
}

/** Everything a request needs to choose a slot, in two reads. */
export async function readAiJobState(keyHashes: string[], slotIds: string[]): Promise<AiJobState> {
  const rows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(inArray(settingsTable.key, [limitsSetting, pausesSetting, roundSetting, modelTestRunSetting]));
  const valueOf = (key: string) => rows.find((row) => row.key === key)?.value;

  const run = parseModelTestRun(valueOf(modelTestRunSetting));
  if (run) await countModelTestCallsOnce(run, keyHashes);

  const savedRounds = valueOf(roundSetting);
  const rounds: Record<string, Set<string>> = {};
  if (isRecord(savedRounds)) {
    for (const [modelId, called] of Object.entries(savedRounds)) {
      if (Array.isArray(called)) rounds[modelId] = new Set(called.filter((entry): entry is string => typeof entry === "string"));
    }
  }
  const pauses = valueOf(pausesSetting);
  return {
    limits: readSavedAiLimits(valueOf(limitsSetting)),
    pauses: isRecord(pauses) ? pauses as AiSlotPauses : {},
    rounds,
    usage: await readAiSlotUsage(slotIds),
  };
}

export async function saveAiLimits(limits: AiLimits, userId: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key: limitsSetting, value: limits, updatedByUserId: userId })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: limits, updatedByUserId: userId, updatedAt: new Date() } });
}

/** Adds or replaces these slots' pauses in one statement, so parallel jobs can't overwrite each other. */
export async function saveAiSlotPauses(added: AiSlotPauses): Promise<void> {
  await db.execute(sql`
    insert into settings (key, value)
    values (${pausesSetting}, ${JSON.stringify(added)}::jsonb)
    on conflict (key) do update
    set value = settings.value || excluded.value, updated_at = now()
  `);
}

/**
 * Notes the key as called on this model. When that completes the model's round, its next round
 * starts empty. One statement, so parallel jobs can't lose each other's turn.
 */
export async function markAiSlotCalled(modelId: string, keyHash: string, allKeyHashes: string[]): Promise<void> {
  if (allKeyHashes.length < 2) return;
  const all = JSON.stringify(allKeyHashes);
  const first = JSON.stringify({ [modelId]: [keyHash] });
  await db.execute(sql`
    insert into settings (key, value)
    values (${roundSetting}, ${first}::jsonb)
    on conflict (key) do update
    set value = jsonb_set(settings.value, array[${modelId}::text], case
        when (coalesce(settings.value->${modelId}::text, '[]'::jsonb) || to_jsonb(${keyHash}::text)) @> ${all}::jsonb then '[]'::jsonb
        when coalesce(settings.value->${modelId}::text, '[]'::jsonb) @> to_jsonb(${keyHash}::text) then settings.value->${modelId}::text
        else coalesce(settings.value->${modelId}::text, '[]'::jsonb) || to_jsonb(${keyHash}::text)
      end, true),
      updated_at = now()
  `);
}
