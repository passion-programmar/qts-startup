import { parsePositiveInteger } from "@/server/gemini/gemini-api-limits";

// Which AI models QTS uses, in the order it tries them, and the rules for each key + model pair
// (a "slot"). Every slot has its own limits, usage, rotation and pauses. Adding a model is one
// line here. This file has no database or network access, so the Super Admin page can share it.

export type AiProvider = "gemini" | "groq";

export const aiModels = [
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    label: "3.6 Flash",
    defaults: { requestsPerMinute: 2, requestsPerDay: 18, inputTokensPerMinute: 25_000, inputTokensPerDay: null },
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    label: "3.5 Flash-Lite",
    defaults: { requestsPerMinute: 2, requestsPerDay: 200, inputTokensPerMinute: 25_000, inputTokensPerDay: null },
  },
  {
    id: "openai/gpt-oss-120b",
    provider: "groq",
    label: "Groq GPT-OSS 120B",
    defaults: { requestsPerMinute: 20, requestsPerDay: 800, inputTokensPerMinute: 6_000, inputTokensPerDay: 150_000 },
  },
] as const;

export type AiModel = (typeof aiModels)[number];
export type AiModelId = AiModel["id"];

export const isAiModelId = (value: string): value is AiModelId => aiModels.some((model) => model.id === value);
export const aiModelLabel = (id: string): string => aiModels.find((model) => model.id === id)?.label ?? id;

// ---- Limits, set per model by the Super Admin ----

export type AiModelLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
  inputTokensPerMinute: number;
  /** Null when the model has no daily token limit. */
  inputTokensPerDay: number | null;
};

export type AiLimits = Record<AiModelId, AiModelLimits>;

const maxRequestsPerMinute = 1_000;
const maxRequestsPerDay = 100_000;
const maxInputTokensPerMinute = 10_000_000;
const maxInputTokensPerDay = 1_000_000_000;

export function defaultAiLimits(): AiLimits {
  const limits = {} as AiLimits;
  for (const model of aiModels) limits[model.id] = { ...model.defaults };
  return limits;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseModelLimits(value: unknown): AiModelLimits | null {
  if (!isRecord(value)) return null;
  const requestsPerMinute = parsePositiveInteger(value.requestsPerMinute, maxRequestsPerMinute);
  const requestsPerDay = parsePositiveInteger(value.requestsPerDay, maxRequestsPerDay);
  const inputTokensPerMinute = parsePositiveInteger(value.inputTokensPerMinute, maxInputTokensPerMinute);
  if (requestsPerMinute === null || requestsPerDay === null || inputTokensPerMinute === null) return null;
  const rawDaily = value.inputTokensPerDay;
  const noDailyLimit = rawDaily === null || rawDaily === undefined || rawDaily === "";
  const inputTokensPerDay = noDailyLimit ? null : parsePositiveInteger(rawDaily, maxInputTokensPerDay);
  if (!noDailyLimit && inputTokensPerDay === null) return null;
  return { requestsPerMinute, requestsPerDay, inputTokensPerMinute, inputTokensPerDay };
}

/** The Super Admin's form: every model must be valid, or nothing is saved. */
export function parseAiLimits(value: unknown): AiLimits | null {
  if (!isRecord(value)) return null;
  const limits = {} as AiLimits;
  for (const model of aiModels) {
    const parsed = parseModelLimits(value[model.id]);
    if (!parsed) return null;
    limits[model.id] = parsed;
  }
  return limits;
}

/** Saved limits. A model added since the last save starts from its defaults. */
export function readSavedAiLimits(value: unknown): AiLimits {
  const saved = isRecord(value) ? value : {};
  const limits = {} as AiLimits;
  for (const model of aiModels) limits[model.id] = parseModelLimits(saved[model.id]) ?? { ...model.defaults };
  return limits;
}

// ---- Slots ----

/** One key on one model. Stored as the key hash in the usage, lease and log tables. */
export const aiSlotId = (keyHash: string, modelId: string): string => `${keyHash}|${modelId}`;

export function parseAiSlotId(id: string): { keyHash: string; modelId: string | null } {
  const separator = id.indexOf("|");
  return separator === -1 ? { keyHash: id, modelId: null } : { keyHash: id.slice(0, separator), modelId: id.slice(separator + 1) };
}

export type AiSlotUsage = { minuteCalls: number; minuteTokens: number; dayCalls: number; dayTokens: number };
export const emptyAiSlotUsage: AiSlotUsage = { minuteCalls: 0, minuteTokens: 0, dayCalls: 0, dayTokens: 0 };

export type AiPauseReason =
  | "overloaded" | "timeout" | "network"
  | "daily_limit" | "no_quota" | "minute_limit"
  | "model_missing" | "no_access" | "bad_key";

export type AiSlotPause = { until: string; reason: AiPauseReason; text: string; at: string };
export type AiSlotPauses = Record<string, AiSlotPause>;

export type AiSlotBlock = "too_large" | "paused" | "day_calls" | "day_tokens" | "minute_calls" | "minute_tokens";

/** Why this slot can't take a request of this size right now; null when it can. */
export function aiSlotBlock(
  limits: AiModelLimits,
  usage: AiSlotUsage,
  pause: AiSlotPause | undefined,
  tokens: number,
  nowMs: number,
): AiSlotBlock | null {
  if (aiRequestTooLarge(limits, tokens)) return "too_large";
  if (pause && Date.parse(pause.until) > nowMs) return "paused";
  if (usage.dayCalls >= limits.requestsPerDay) return "day_calls";
  if (limits.inputTokensPerDay !== null && usage.dayTokens + tokens > limits.inputTokensPerDay) return "day_tokens";
  if (usage.minuteCalls >= limits.requestsPerMinute) return "minute_calls";
  if (usage.minuteTokens + tokens > limits.inputTokensPerMinute) return "minute_tokens";
  return null;
}

/** A request bigger than the model's own limit can never run on it, whatever the usage. */
export function aiRequestTooLarge(limits: AiModelLimits, tokens: number): boolean {
  return tokens > limits.inputTokensPerMinute || (limits.inputTokensPerDay !== null && tokens > limits.inputTokensPerDay);
}

const pausesLastingTheDay: ReadonlySet<AiPauseReason> = new Set(["daily_limit", "no_quota", "bad_key", "no_access"]);

/** True when waiting a few seconds can't help this slot: it's out until the daily reset. */
export function aiSlotIsOutForTheDay(block: AiSlotBlock | null, pause: AiSlotPause | undefined): boolean {
  if (block === "day_calls" || block === "day_tokens") return true;
  return block === "paused" && pause !== undefined && pausesLastingTheDay.has(pause.reason);
}

/** Keys not yet called this round come first, each group keeping the random order it was given. */
export function keysNotCalledFirst<Key>(keys: Key[], isCalled: (key: Key) => boolean): Key[] {
  return [...keys.filter((key) => !isCalled(key)), ...keys.filter((key) => isCalled(key))];
}

// ---- Pacific time: when Google's daily limits reset ----

export const pacificTimeZone = "America/Los_Angeles";

const pacificDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: pacificTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
});
const pacificPartsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: pacificTimeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});

export function pacificDay(nowMs: number): string {
  return pacificDateFormat.format(new Date(nowMs));
}

function pacificOffsetMs(ms: number): number {
  const parts = pacificPartsFormat.formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wall - Math.floor(ms / 1000) * 1000;
}

/** When Google's daily limits reset. Worked out twice, because the clock may change before then. */
export function nextPacificMidnight(nowMs: number): number {
  const [year, month, day] = pacificDay(nowMs).split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day + 1);
  return wall - pacificOffsetMs(wall - pacificOffsetMs(nowMs));
}

export function formatPacificTime(value: string | number, withSeconds = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: pacificTimeZone, hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}),
  }).format(new Date(value));
}

export function formatWait(ms: number): string {
  if (ms >= 3_600_000) return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  if (ms >= 60_000) return `${Math.ceil(ms / 60_000)}m`;
  return `${Math.ceil(ms / 1000)}s`;
}

// ---- The Super Admin's view of a slot ----

export type AiSlotView = { used: string; status: string; tone: "ok" | "busy" | "out" | "problem" };

const flaggedStatus: Partial<Record<AiPauseReason, string>> = {
  bad_key: "Bad key",
  no_access: "No access",
  model_missing: "Model missing",
  no_quota: "No quota",
};

export function describeAiSlot(
  limits: AiModelLimits,
  usage: AiSlotUsage,
  pause: AiSlotPause | undefined,
  busy: boolean,
  nowMs: number,
): AiSlotView {
  const used = `${usage.dayCalls} of ${limits.requestsPerDay}`;
  if (pause && Date.parse(pause.until) > nowMs) {
    const flagged = flaggedStatus[pause.reason];
    if (flagged) return { used, status: flagged, tone: "problem" };
    if (pause.reason === "daily_limit") return { used, status: `Until ${formatPacificTime(pause.until)}`, tone: "out" };
    return { used, status: `Paused ${formatWait(Date.parse(pause.until) - nowMs)}`, tone: "busy" };
  }
  if (busy) return { used, status: "Busy", tone: "busy" };
  const block = aiSlotBlock(limits, usage, undefined, 0, nowMs);
  if (block === "day_calls" || block === "day_tokens") return { used, status: "Limit reached", tone: "out" };
  if (block === "minute_calls" || block === "minute_tokens") return { used, status: "Minute limit", tone: "busy" };
  return { used, status: "Available", tone: "ok" };
}
