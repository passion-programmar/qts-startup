import { parsePositiveInteger } from "@/server/gemini/gemini-api-limits";
import { buildGetJdEvaluationPrompt } from "@/server/gemini/build-get-jd-evaluation-prompt";
import {
  classifyAiNetworkError,
  classifyGeminiReply,
  type AiBlockedReason,
  type AiFailedReason,
  type AiOutcome,
} from "@/server/gemini/ai-reply";
import { formatPacificTime, formatWait, nextPacificMidnight, pacificDay, type AiProvider } from "@/server/gemini/ai-models";

export { formatPacificTime, nextPacificMidnight, pacificDay };

// Gemini Usage's "Model test" tab: how many calls each chosen key and model can really make. It
// has its own settings and saved results, and its calls count toward each slot's usage for the
// day. This file is the rules only (no database, no network), so the page can share it.

export const modelTestModels = [
  { id: "gemini-3.8-flash", provider: "gemini", label: "3.8 Flash", defaultMaxCalls: 25, reportedDailyLimit: 20 },
  { id: "gemini-3.6-flash", provider: "gemini", label: "3.6 Flash", defaultMaxCalls: 25, reportedDailyLimit: 20 },
  { id: "gemini-3.5-flash-lite", provider: "gemini", label: "3.5 Flash-Lite", defaultMaxCalls: 5, reportedDailyLimit: null },
  { id: "openai/gpt-oss-120b", provider: "groq", label: "Groq GPT-OSS 120B", defaultMaxCalls: 5, reportedDailyLimit: null },
] as const;

export type ModelTestModelId = (typeof modelTestModels)[number]["id"];

/** The saved results' setting. Live requests read it once, to count calls made before they counted. */
export const modelTestRunSetting = "gemini_model_test_run";

/** Up to this many keys for each provider. */
export const maxModelTestKeys = 3;
const maxModelTestCalls = 5_000;
const maxCallsPerMinute = 60;
const maxFailuresBeforeNextModel = 100;
export const maxModelTestTextLength = 100_000;
/** Above this many Flash-Lite calls the page warns: test calls use up what live work can use. */
export const modelTestLiteWarningCalls = 20;
const maxTimelineEvents = 100;
const defaultMinuteWaitSeconds = 60;

export type ModelTestSettings = {
  models: Record<ModelTestModelId, { enabled: boolean; maxCalls: number }>;
  callsPerMinute: number;
  failuresBeforeNextModel: number;
  testText: string;
};

const defaultTestText =
  "Fake job post for a QTS model test. Senior Backend Engineer at Example Labs. Fully remote, " +
  "full-time, open worldwide. Salary 120,000 to 150,000 USD a year. Build Python services and " +
  "PostgreSQL databases. At least five years of backend experience.";

const testInstructions =
  "Decide whether this page is a job posting and whether the job is remote. Fill every field of " +
  "the JSON response. matchingProfileIndexes lists the candidates who fit the job.";

export function defaultModelTestSettings(): ModelTestSettings {
  const models = {} as ModelTestSettings["models"];
  for (const { id, defaultMaxCalls } of modelTestModels) models[id] = { enabled: true, maxCalls: defaultMaxCalls };
  return { models, callsPerMinute: 2, failuresBeforeNextModel: 5, testText: defaultTestText };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function parseModelTestSettings(value: unknown): ModelTestSettings | null {
  if (!isRecord(value) || !isRecord(value.models)) return null;
  const defaults = defaultModelTestSettings().models;
  const models = {} as ModelTestSettings["models"];
  for (const { id } of modelTestModels) {
    const entry = value.models[id];
    // A model added to the test since these settings were saved starts from its defaults.
    if (entry === undefined) {
      models[id] = defaults[id];
      continue;
    }
    if (!isRecord(entry) || typeof entry.enabled !== "boolean") return null;
    const maxCalls = parsePositiveInteger(entry.maxCalls, maxModelTestCalls);
    if (maxCalls === null) return null;
    models[id] = { enabled: entry.enabled, maxCalls };
  }
  if (!modelTestModels.some(({ id }) => models[id].enabled)) return null;
  const callsPerMinute = parsePositiveInteger(value.callsPerMinute, maxCallsPerMinute);
  const failuresBeforeNextModel = parsePositiveInteger(value.failuresBeforeNextModel, maxFailuresBeforeNextModel);
  if (callsPerMinute === null || failuresBeforeNextModel === null) return null;
  if (typeof value.testText !== "string" || !value.testText.trim() || value.testText.length > maxModelTestTextLength) return null;
  return { models, callsPerMinute, failuresBeforeNextModel, testText: value.testText };
}

/** Calls Google only on the Production deployment, so API keys are never used from a local run. */
export function isModelTestAllowed(env: Record<string, string | undefined>): boolean {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production";
}

/** The same shape of prompt and answer as Get JD, with a fake job post and a fake candidate. */
export function buildModelTestPrompt(testText: string): string {
  return buildGetJdEvaluationPrompt({
    savedPrompt: testInstructions,
    pageUrl: "https://example.test/jobs/model-test",
    pageTitle: "Model test job post",
    pageText: testText,
    candidates: [{ candidateIndex: 0, candidateName: "Test Candidate", jdMatching: "Backend engineering with Python" }],
  });
}

// ---- Saved counts ----

export type ModelTestReason =
  | "daily_limit" | "no_quota" | "minute_limit"
  | "overloaded" | "timeout" | "network" | "broken_reply"
  | "model_missing" | "no_access" | "bad_key" | "too_large" | "bad_request";

export type ModelTestCell = {
  /** Every attempt, whatever came back. The test's call cap counts these. */
  calls: number;
  worked: number;
  /** Overload, timeout, network, refused. Limit replies (429) are counted apart, in `limited`. */
  failed: number;
  limited: number;
  failuresInRow: number;
  /** Google's own numbers, known only once a 429 has stated them. */
  dailyLimit: number | null;
  minuteLimit: number | null;
  validJson: number;
  invalidJson: number;
  unavailable: { reason: ModelTestReason; text: string; since: string; until: string | null } | null;
  /** No more test calls to this model on this key in this run. */
  finished: boolean;
  lastReply: { httpStatus: number | null; durationMs: number; modelVersion: string | null } | null;
  /** Google's message for the last problem. */
  detail: string | null;
};

export type ModelTestEvent = { at: string; model: ModelTestModelId; available: boolean; text: string };

export type ModelTestKeyState = {
  /** Bumped on every save: a save that started from an older version is refused. */
  version: number;
  lastCallAt: string | null;
  models: Partial<Record<ModelTestModelId, ModelTestCell>>;
  timeline: ModelTestEvent[];
};

export type ModelTestRun = {
  runId: string;
  pacificDay: string;
  startedAt: string;
  selectedKeyIds: string[];
  keys: Record<string, ModelTestKeyState>;
  /** Set on runs whose calls are already in the live usage. */
  countedInLiveUsage?: boolean;
};

const emptyKeyState = (): ModelTestKeyState => ({ version: 0, lastCallAt: null, models: {}, timeline: [] });

const emptyCell = (): ModelTestCell => ({
  calls: 0, worked: 0, failed: 0, limited: 0, failuresInRow: 0, dailyLimit: null, minuteLimit: null,
  validJson: 0, invalidJson: 0, unavailable: null, finished: false, lastReply: null, detail: null,
});

export function parseModelTestRun(value: unknown): ModelTestRun | null {
  if (!isRecord(value) || typeof value.runId !== "string" || typeof value.pacificDay !== "string") return null;
  if (typeof value.startedAt !== "string" || !Array.isArray(value.selectedKeyIds) || !isRecord(value.keys)) return null;
  return value as unknown as ModelTestRun;
}

export function createModelTestRun(runId: string, keyIds: string[], nowMs: number): ModelTestRun {
  return {
    runId,
    pacificDay: pacificDay(nowMs),
    startedAt: new Date(nowMs).toISOString(),
    selectedKeyIds: keyIds,
    keys: Object.fromEntries(keyIds.map((keyId) => [keyId, emptyKeyState()])),
    countedInLiveUsage: true,
  };
}

/** Start pressed again the same day: counts carry on, and newly ticked keys join the run. */
export function continueModelTestRun(run: ModelTestRun, keyIds: string[]): ModelTestRun {
  const keys = { ...run.keys };
  for (const keyId of keyIds) keys[keyId] ??= emptyKeyState();
  return { ...run, selectedKeyIds: keyIds, keys };
}

// ---- What to do next ----

export type ModelTestStep =
  | { kind: "call"; model: ModelTestModelId }
  | { kind: "wait"; model: ModelTestModelId; until: string }
  | { kind: "done" };

/** The best ticked model not finished on this key. A per-minute limit waits on the same model. */
export function nextModelTestStep(
  settings: ModelTestSettings,
  key: ModelTestKeyState,
  nowMs: number,
  provider: AiProvider = "gemini",
): ModelTestStep {
  for (const { id, provider: modelProvider } of modelTestModels) {
    if (modelProvider !== provider) continue;
    const config = settings.models[id];
    if (!config.enabled) continue;
    const cell = key.models[id] ?? emptyCell();
    if (cell.finished || cell.calls >= config.maxCalls) continue;
    const until = cell.unavailable?.reason === "minute_limit" ? cell.unavailable.until : null;
    if (until && Date.parse(until) > nowMs) return { kind: "wait", model: id, until };
    return { kind: "call", model: id };
  }
  return { kind: "done" };
}

/**
 * Slightly lenient: the page spaces whole rounds, and a key's place inside a round is random, so
 * its own gap can run a little under the round's length without the speed being exceeded.
 */
export function isModelTestCallTooSoon(settings: ModelTestSettings, key: ModelTestKeyState, nowMs: number): boolean {
  if (!key.lastCallAt) return false;
  const roundMs = 60_000 / settings.callsPerMinute;
  return nowMs - Date.parse(key.lastCallAt) < roundMs - Math.max(roundMs * 0.1, 500);
}

/** Counts the attempt before Google is called, so a second tab can't go over the cap. */
export function reserveModelTestCall(key: ModelTestKeyState, model: ModelTestModelId, nowMs: number): ModelTestKeyState {
  const cell = key.models[model] ?? emptyCell();
  return {
    ...key,
    version: key.version + 1,
    lastCallAt: new Date(nowMs).toISOString(),
    models: { ...key.models, [model]: { ...cell, calls: cell.calls + 1 } },
  };
}

// ---- Reading Google's reply ----

type ReplyFacts = { httpStatus: number | null; durationMs: number; detail: string | null };

export type ModelTestOutcome =
  | { kind: "worked"; httpStatus: number; durationMs: number; modelVersion: string | null; validJson: boolean }
  | (ReplyFacts & { kind: "daily_limit"; limit: number | null })
  | (ReplyFacts & { kind: "minute_limit"; limit: number | null; retryAfterSeconds: number | null })
  | (ReplyFacts & { kind: "failed"; reason: AiFailedReason | "broken_reply" })
  | (ReplyFacts & { kind: "blocked"; reason: Exclude<AiBlockedReason, "broken_reply"> });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The answer Get JD would need: JSON with the job page decision and the job fields. */
function isUsableAnswer(text: string): boolean {
  const answer = parseJson(text);
  return isRecord(answer) && typeof answer.isJobPage === "boolean" && isRecord(answer.job);
}

/** A live outcome, as the test records it. A reply that wasn't valid JSON is a retryable failure. */
export function modelTestOutcomeFromAi(outcome: AiOutcome): ModelTestOutcome {
  if (outcome.kind === "worked") {
    const { text, ...rest } = outcome;
    return { ...rest, validJson: isUsableAnswer(text) };
  }
  if (outcome.kind === "blocked" && outcome.reason === "broken_reply") return { ...outcome, kind: "failed", reason: "broken_reply" };
  return outcome as ModelTestOutcome;
}

export const classifyModelTestReply = (httpStatus: number, body: string, durationMs: number): ModelTestOutcome =>
  modelTestOutcomeFromAi(classifyGeminiReply(httpStatus, body, durationMs));

export const classifyModelTestNetworkError = (errorName: string, durationMs: number): ModelTestOutcome =>
  modelTestOutcomeFromAi(classifyAiNetworkError(errorName, durationMs));

// ---- Saving what happened ----

const blockedText: Record<Exclude<AiBlockedReason, "broken_reply">, string> = {
  no_quota: "No quota for this model on this project",
  model_missing: "Model not found",
  no_access: "No access to this model",
  bad_key: "Bad or revoked key",
  too_large: "Test text is too long for this model",
  bad_request: "The provider refused the request",
};

function pushEvent(key: ModelTestKeyState, event: ModelTestEvent): void {
  key.timeline = [...key.timeline, event].slice(-maxTimelineEvents);
}

function markUnavailable(
  key: ModelTestKeyState,
  model: ModelTestModelId,
  cell: ModelTestCell,
  next: { reason: ModelTestReason; text: string; until: string | null },
  at: string,
): void {
  const changed = cell.unavailable?.text !== next.text;
  if (changed) pushEvent(key, { at, model, available: false, text: next.text });
  cell.unavailable = { ...next, since: changed || !cell.unavailable ? at : cell.unavailable.since };
}

export function applyModelTestOutcome(
  key: ModelTestKeyState,
  model: ModelTestModelId,
  outcome: ModelTestOutcome,
  settings: ModelTestSettings,
  nowMs: number,
): ModelTestKeyState {
  const next: ModelTestKeyState = { ...key, version: key.version + 1, timeline: [...key.timeline] };
  const cell: ModelTestCell = { ...(key.models[model] ?? emptyCell()) };
  next.models = { ...key.models, [model]: cell };
  const at = new Date(nowMs).toISOString();
  cell.lastReply = {
    httpStatus: outcome.httpStatus,
    durationMs: outcome.durationMs,
    modelVersion: outcome.kind === "worked" ? outcome.modelVersion : null,
  };
  cell.detail = outcome.kind === "worked" ? null : outcome.detail;

  switch (outcome.kind) {
    case "worked":
      cell.worked += 1;
      cell.failuresInRow = 0;
      if (outcome.validJson) cell.validJson += 1;
      else cell.invalidJson += 1;
      if (cell.unavailable) {
        pushEvent(next, { at, model, available: true, text: "Available again" });
        cell.unavailable = null;
      }
      break;
    case "daily_limit":
      cell.limited += 1;
      cell.dailyLimit = outcome.limit ?? cell.dailyLimit;
      cell.finished = true;
      markUnavailable(next, model, cell, {
        reason: "daily_limit",
        text: outcome.limit === null ? "Daily limit" : `Daily limit, Google says ${outcome.limit}`,
        until: new Date(nextPacificMidnight(nowMs)).toISOString(),
      }, at);
      break;
    case "minute_limit":
      cell.limited += 1;
      cell.minuteLimit = outcome.limit ?? cell.minuteLimit;
      markUnavailable(next, model, cell, {
        reason: "minute_limit",
        text: outcome.limit === null ? "Per-minute limit" : `Per-minute limit, Google says ${outcome.limit}`,
        until: new Date(nowMs + (outcome.retryAfterSeconds ?? defaultMinuteWaitSeconds) * 1000).toISOString(),
      }, at);
      break;
    case "failed": {
      cell.failed += 1;
      cell.failuresInRow += 1;
      const failure =
        outcome.reason === "timeout" ? "Timed out"
        : outcome.reason === "network" ? "Network error"
        : outcome.reason === "broken_reply" ? "Reply wasn't valid JSON"
        : `${outcome.httpStatus} overloaded`;
      const gaveUp = cell.failuresInRow >= settings.failuresBeforeNextModel;
      if (gaveUp) cell.finished = true;
      markUnavailable(next, model, cell, {
        reason: outcome.reason,
        text: gaveUp ? `${failure}, moved on after ${cell.failuresInRow} failures in a row` : failure,
        until: null,
      }, at);
      break;
    }
    case "blocked":
      if (outcome.reason === "no_quota") {
        cell.limited += 1;
        cell.dailyLimit = 0;
      } else {
        cell.failed += 1;
      }
      cell.finished = true;
      markUnavailable(next, model, cell, { reason: outcome.reason, text: blockedText[outcome.reason], until: null }, at);
      break;
  }
  return next;
}

// ---- Showing it ----

export type ModelTestCellView = {
  worked: number;
  failed: number;
  limit: string;
  left: string;
  status: "Not tested" | "Available" | "Not available";
  reason: string;
  since: string;
  availableAgain: string;
  validJson: string;
  lastReply: string;
  detail: string | null;
};

export function describeModelTestCell(
  model: (typeof modelTestModels)[number],
  cell: ModelTestCell | undefined,
  maxCalls: number,
  nowMs: number,
): ModelTestCellView {
  const current = cell ?? emptyCell();
  const reported = model.reportedDailyLimit;
  const hitDailyLimit = current.unavailable?.reason === "daily_limit" || current.unavailable?.reason === "no_quota";
  const limit = current.dailyLimit !== null ? String(current.dailyLimit) : reported === null ? "?" : `about ${reported}`;
  const left = hitDailyLimit
    ? "0"
    : current.dailyLimit !== null
      ? String(Math.max(0, current.dailyLimit - current.worked))
      : reported === null ? "?" : `about ${Math.max(0, reported - current.worked)}`;

  const until = current.unavailable?.until ?? null;
  const limitOver = until !== null && Date.parse(until) <= nowMs;
  const unavailable = current.unavailable && !limitOver ? current.unavailable : null;
  const status = current.calls === 0 ? "Not tested" : unavailable ? "Not available" : "Available";
  const reason = unavailable
    ? unavailable.text
    : limitOver
      ? "Limit has reset"
      : current.calls === 0
        ? "—"
        : current.calls >= maxCalls ? "Test cap reached" : "Working";

  let availableAgain = "—";
  if (limitOver) availableAgain = "Now";
  else if (unavailable && until) {
    availableAgain = `${formatPacificTime(until, unavailable.reason === "minute_limit")} (in ${formatWait(Date.parse(until) - nowMs)})`;
  } else if (unavailable) {
    availableAgain = ["overloaded", "timeout", "network", "broken_reply"].includes(unavailable.reason)
      ? "Unknown until a retry works"
      : "Not until fixed";
  }

  const checked = current.validJson + current.invalidJson;
  const reply = current.lastReply;
  return {
    worked: current.worked,
    failed: current.failed,
    limit,
    left,
    status,
    reason,
    since: unavailable ? formatPacificTime(unavailable.since) : "—",
    availableAgain,
    validJson: checked ? `${current.validJson} of ${checked}` : "—",
    lastReply: reply
      ? [
          reply.httpStatus === null ? "No reply" : `HTTP ${reply.httpStatus}`,
          `${(reply.durationMs / 1000).toFixed(1)} s`,
          ...(reply.modelVersion ? [reply.modelVersion] : []),
        ].join(" · ")
      : "—",
    detail: current.detail,
  };
}

/** Google's stated daily limits where known, otherwise the calls that worked (so "at least"). */
export function summarizeModelTestRun(
  run: ModelTestRun,
  keyIds: string[],
  settings: ModelTestSettings,
  providerOf: (keyId: string) => AiProvider = () => "gemini",
) {
  let total = 0;
  let exact = true;
  for (const keyId of keyIds) {
    for (const { id, provider } of modelTestModels) {
      if (provider !== providerOf(keyId) || !settings.models[id].enabled) continue;
      const cell = run.keys[keyId]?.models[id];
      if (cell?.dailyLimit != null) {
        total += cell.dailyLimit;
      } else {
        total += cell?.worked ?? 0;
        exact = false;
      }
    }
  }
  return { total, exact };
}
