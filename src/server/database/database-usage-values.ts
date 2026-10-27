// Rules for the Database usage page: which tables Super Admin can empty by hand and how far, each
// quota's level, forecasts from real usage, and reading Neon's API answers without turning missing
// numbers into zero. Pure, so they are testable without a database or Neon.

// How a table may be emptied by hand: rows older than some days (or all of them, when allowed),
// only rows already expired, or not at all.
export type DeleteRule =
  | { kind: "age"; minDays: number; allowAll: boolean }
  | { kind: "expired" }
  | { kind: "none" };

export type DataTable = {
  key: string;
  label: string;
  // What one row is, for the page.
  holds: string;
  // How long rows stay without anyone deleting them.
  kept: string;
  // True when the table only grows (nothing removes its rows by itself).
  growsForever: boolean;
  rule: DeleteRule;
  // Shown in the delete confirmation: what is lost.
  warning?: string;
};

export const GENERATION_KEEP_DAYS_DEFAULT = 3;
export const GENERATION_KEEP_DAYS_MAX = 365;
export const MAX_DELETE_DAYS = 3650;

// Tables Super Admin can delete from, by the name Postgres knows them. Every other table (users,
// profiles, prompts, settings, reusable answers, rules) is shown but never deleted from here.
export const DATA_TABLES: DataTable[] = [
  {
    key: "bids",
    label: "Bids",
    holds: "One confirmed application: job details, résumé folder, the answers sent.",
    kept: "forever",
    growsForever: true,
    rule: { kind: "age", minDays: 0, allowAll: true },
    warning: "QTS forgets these applications: Get JD can offer those jobs again, and the 7-day rule no longer sees them.",
  },
  {
    key: "jobs",
    label: "Job rows (Applied and Failed)",
    holds: "A job saved by Get JD for one candidate, with its description and documents' text.",
    kept: "Applied rows until the daily “Clear applied jobs?”; Failed rows forever",
    growsForever: true,
    rule: { kind: "age", minDays: 0, allowAll: true },
    warning: "Only Applied and Failed rows not being applied right now are deleted, with their Apply history. To-do and Pending rows stay.",
  },
  {
    key: "generation_runs",
    label: "Generation runs",
    holds: "One ChatGPT résumé and cover letter run: the prompt and the reply.",
    kept: "by the keep days; each job's newest delivered run stays while its job row exists",
    growsForever: false,
    rule: { kind: "age", minDays: 0, allowAll: true },
    warning: "Each existing job keeps its newest delivered run, so Apply can still print its résumé.",
  },
  {
    key: "apply_attempts",
    label: "Apply history",
    holds: "One Apply try on a job: which Chrome, when, the result.",
    kept: "until its job row is deleted",
    growsForever: true,
    rule: { kind: "age", minDays: 0, allowAll: true },
    warning: "Only finished tries are deleted; applications being filled or reviewed stay.",
  },
  {
    key: "gemini_api_call_logs",
    label: "Gemini logs",
    holds: "One Google API response, for Gemini usage → Google responses.",
    kept: "today and the 2 previous Pacific days",
    growsForever: false,
    rule: { kind: "age", minDays: 0, allowAll: true },
  },
  {
    key: "gemini_key_usage_events",
    label: "Gemini key counters",
    holds: "One Gemini request counted against a key's per-minute and per-day limits.",
    kept: "forever",
    growsForever: true,
    // Today's Pacific day and the last minute decide each key's limits.
    rule: { kind: "age", minDays: 2, allowAll: false },
  },
  {
    key: "get_jd_page_checks",
    label: "Get JD checks",
    holds: "One job page being checked by Gemini, shared by the Chromes for 10 minutes.",
    kept: "10 minutes",
    growsForever: false,
    rule: { kind: "expired" },
  },
  {
    key: "apply_question_memory",
    label: "Question memory",
    holds: "One application question: how often it was met and its most common answers.",
    kept: "90 days after it was last met",
    growsForever: false,
    rule: { kind: "age", minDays: 0, allowAll: true },
    warning: "Apply forgets these questions: their suggestions and remembered choices are gone.",
  },
  {
    key: "login_history",
    label: "Login history",
    holds: "One sign-in to QTS.",
    kept: "the latest sign-ins of each user",
    growsForever: false,
    rule: { kind: "age", minDays: 0, allowAll: true },
  },
  {
    key: "login_rate_limit_events",
    label: "Login attempt counters",
    holds: "One sign-in attempt, counted to slow down password guessing.",
    kept: "15 minutes",
    growsForever: false,
    // Recent attempts are what stops a password guesser.
    rule: { kind: "age", minDays: 1, allowAll: false },
  },
];

export function dataTable(key: string): DataTable | null {
  return DATA_TABLES.find((table) => table.key === key) ?? null;
}

export type DeleteRequest = { table: DataTable; mode: "older" | "all" | "expired"; days: number };

/** What a delete form sent, checked against the table's rule; a string is the error to show. */
export function parseDeleteRequest(tableKey: unknown, mode: unknown, days: unknown): DeleteRequest | string {
  const table = typeof tableKey === "string" ? dataTable(tableKey) : null;
  if (!table || table.rule.kind === "none") return "That table cannot be deleted from here.";
  if (table.rule.kind === "expired") return { table, mode: "expired", days: 0 };
  if (mode === "all") {
    return table.rule.allowAll ? { table, mode: "all", days: 0 } : `${table.label} can only be deleted by age.`;
  }
  const value = typeof days === "string" ? Number(days.trim()) : typeof days === "number" ? days : Number.NaN;
  if (!Number.isInteger(value) || value < table.rule.minDays || value > MAX_DELETE_DAYS) {
    return `Enter whole days from ${table.rule.minDays} to ${MAX_DELETE_DAYS}.`;
  }
  return { table, mode: "older", days: value };
}

/** The saved keep days for Generation runs, or the default when missing or invalid. */
export function parseKeepDays(value: unknown): { generationRuns: number } {
  const days = value && typeof value === "object" ? (value as Record<string, unknown>).generationRuns : undefined;
  return {
    generationRuns: typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= GENERATION_KEEP_DAYS_MAX
      ? days
      : GENERATION_KEEP_DAYS_DEFAULT,
  };
}

// ---- Plan limits and levels ----

// Neon's Free plan, from https://neon.com/docs/introduction/plans (checked 27 Oct 2026): per
// project, per monthly billing period. Super Admin corrects them when the plan differs.
export const NEON_LIMITS_CHECKED_ON = "2026-10-27";
export type Thresholds = { warning: number; high: number; critical: number };
export type PlanLimits = {
  storageMb: number;
  computeHours: number;
  transferGb: number;
  // Free plan: 20 GB of storage across all projects of the account.
  accountStorageGb: number;
  thresholds: Thresholds;
};
export const DEFAULT_THRESHOLDS: Thresholds = { warning: 70, high: 85, critical: 95 };
export const NEON_FREE_LIMITS: PlanLimits = {
  storageMb: 1024,
  computeHours: 100,
  transferGb: 5,
  accountStorageGb: 20,
  thresholds: DEFAULT_THRESHOLDS,
};
const LIMIT_MAX = 1_000_000;

const positive = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= LIMIT_MAX ? value : fallback;

function parseThresholds(value: unknown): Thresholds {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const percent = (key: keyof Thresholds) => {
    const number = item[key];
    return typeof number === "number" && Number.isFinite(number) && number > 0 && number < 100 ? number : DEFAULT_THRESHOLDS[key];
  };
  const thresholds = { warning: percent("warning"), high: percent("high"), critical: percent("critical") };
  // Out of order means a mistake: the defaults are safer than a level that never shows.
  return thresholds.warning < thresholds.high && thresholds.high < thresholds.critical ? thresholds : DEFAULT_THRESHOLDS;
}

export function parsePlanLimits(value: unknown): PlanLimits {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    storageMb: positive(item.storageMb, NEON_FREE_LIMITS.storageMb),
    computeHours: positive(item.computeHours, NEON_FREE_LIMITS.computeHours),
    transferGb: positive(item.transferGb, NEON_FREE_LIMITS.transferGb),
    accountStorageGb: positive(item.accountStorageGb, NEON_FREE_LIMITS.accountStorageGb),
    thresholds: parseThresholds(item.thresholds),
  };
}

export type Level = "ok" | "warning" | "high" | "critical" | "reached";
export const LEVEL_ORDER: Level[] = ["ok", "warning", "high", "critical", "reached"];

/** A share of a limit as a level: warning, high, critical at the thresholds, and reached at 100%. */
export function levelOf(used: number, limit: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Level {
  if (!(limit > 0)) return "ok";
  const percent = (used / limit) * 100;
  if (percent >= 100) return "reached";
  if (percent >= thresholds.critical) return "critical";
  if (percent >= thresholds.high) return "high";
  if (percent >= thresholds.warning) return "warning";
  return "ok";
}

export const levelRank = (level: Level) => LEVEL_ORDER.indexOf(level);

/** The worst of several levels, for one warning. */
export function worstLevel(levels: Level[]): Level {
  return levels.reduce<Level>((worst, level) => (levelRank(level) > levelRank(worst) ? level : worst), "ok");
}

export type QuotaKey = "storage" | "compute" | "transfer";

/**
 * Which quotas the banner shows: only those worse than when Super Admin last dismissed it, so
 * an unchanged condition does not warn again, and a worse one does.
 */
export function quotasToAlert(current: Partial<Record<QuotaKey, Level>>, dismissed: Partial<Record<QuotaKey, Level>>): QuotaKey[] {
  return (Object.keys(current) as QuotaKey[]).filter((key) => {
    const level = current[key] ?? "ok";
    return level !== "ok" && levelRank(level) > levelRank(dismissed[key] ?? "ok");
  });
}

// ---- Forecasts from real usage ----

export type Forecast =
  | { enough: false; reason: string }
  | {
      enough: true;
      perDay: number;
      // At this pace, by the end of the billing period (null when the period end is unknown).
      projectedAtPeriodEnd: number | null;
      // Days until the limit, or null when it is not reached at this pace before the period ends.
      daysToLimit: number | null;
      limitDate: string | null;
    };

const DAY_MS = 86_400_000;

/**
 * A monthly allowance's pace from Neon's own counter since the period began: the average per day
 * so far, where it ends up at the period's end, and when it reaches the limit. Less than a day of
 * the period is too little to say.
 */
export function periodForecast(input: {
  used: number;
  limit: number;
  periodStart: string | null;
  periodEnd: string | null;
  now: number;
}): Forecast {
  const start = input.periodStart ? Date.parse(input.periodStart) : Number.NaN;
  if (!Number.isFinite(start)) return { enough: false, reason: "Insufficient data: Neon gave no billing period start." };
  const elapsedDays = (input.now - start) / DAY_MS;
  if (elapsedDays < 1) return { enough: false, reason: "Insufficient data: less than a day of this billing period." };
  const perDay = input.used / elapsedDays;
  const end = input.periodEnd ? Date.parse(input.periodEnd) : Number.NaN;
  const projected = Number.isFinite(end) ? input.used + perDay * Math.max(0, (end - input.now) / DAY_MS) : null;
  if (perDay <= 0) return { enough: true, perDay: 0, projectedAtPeriodEnd: projected, daysToLimit: null, limitDate: null };
  const daysToLimit = Math.max(0, (input.limit - input.used) / perDay);
  const limitTime = input.now + daysToLimit * DAY_MS;
  // Within the period only: the counter resets when the next period starts.
  const reachedThisPeriod = !Number.isFinite(end) || limitTime <= end;
  return {
    enough: true,
    perDay,
    projectedAtPeriodEnd: projected,
    daysToLimit: reachedThisPeriod ? Math.floor(daysToLimit) : null,
    limitDate: reachedThisPeriod ? new Date(limitTime).toISOString() : null,
  };
}

/**
 * Storage has no monthly reset: its pace comes from saved measurements of the database size (the
 * daily clean-up and each Check quota add one), over the last 30 days. Fewer than two a day apart
 * is too little to say.
 */
export function storageForecast(points: { at: string; bytes: number }[], limit: number, used: number, now: number): Forecast {
  const sorted = points
    .filter((point) => Number.isFinite(Date.parse(point.at)) && now - Date.parse(point.at) <= 30 * DAY_MS)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (sorted.length < 2) return { enough: false, reason: "Insufficient data: needs size measurements on at least two days." };
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (Date.parse(last.at) - Date.parse(first.at)) / DAY_MS;
  if (days < 1) return { enough: false, reason: "Insufficient data: needs size measurements at least a day apart." };
  const perDay = (last.bytes - first.bytes) / days;
  if (perDay <= 0) return { enough: true, perDay, projectedAtPeriodEnd: null, daysToLimit: null, limitDate: null };
  const daysToLimit = Math.max(0, (limit - used) / perDay);
  return {
    enough: true,
    perDay,
    projectedAtPeriodEnd: null,
    daysToLimit: Math.floor(daysToLimit),
    limitDate: new Date(now + daysToLimit * DAY_MS).toISOString(),
  };
}

// ---- Daily history from saved checks ----

export type HistoryPoint = {
  at: string;
  // Romania day of the check, YYYY-MM-DD.
  day: string;
  projectId: string;
  periodStart: string | null;
  computeSeconds: number | null;
  transferBytes: number | null;
  databaseBytes: number | null;
};

/**
 * Per-day use of a counter Neon keeps for the billing period: the last check of each day minus
 * the day before's. When a new period starts, the counter starts again from zero, so that day's
 * use is the counter itself. Days without a check on both sides are left out, not guessed.
 */
export function dailyUse(points: HistoryPoint[], field: "computeSeconds" | "transferBytes"): { day: string; value: number }[] {
  const lastOfDay = new Map<string, HistoryPoint>();
  for (const point of [...points].sort((a, b) => a.at.localeCompare(b.at))) {
    if (point[field] !== null) lastOfDay.set(point.day, point);
  }
  const days = [...lastOfDay.values()];
  const result: { day: string; value: number }[] = [];
  for (let index = 1; index < days.length; index += 1) {
    const before = days[index - 1];
    const now = days[index];
    const samePeriod = before.periodStart === now.periodStart;
    const value = samePeriod ? now[field]! - before[field]! : now[field]!;
    if (value >= 0) result.push({ day: now.day, value });
  }
  return result;
}

// ---- Neon API answers ----

export type NeonEndpoint = {
  id: string;
  state: string | null;
  minCu: number | null;
  maxCu: number | null;
  suspendSeconds: number | null;
  lastActive: string | null;
  poolerEnabled: boolean | null;
  host: string | null;
};

export type NeonProjectUsage = {
  id: string;
  name: string;
  regionId: string | null;
  createdAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  // Neon's counters for the billing period; null when Neon did not send them, never zero.
  computeSeconds: number | null;
  activeSeconds: number | null;
  cpuSeconds: number | null;
  transferBytes: number | null;
  writtenBytes: number | null;
  // The logical size of all the project's branches, from the branch list (null until it is read).
  storageBytes: number | null;
  branchCount: number | null;
  // The size above which Neon refuses writes on a branch.
  branchLimitBytes: number | null;
  endpoints: NeonEndpoint[];
};

const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * Neon's GET /projects/{id} answer; every number Neon left out stays null. Its synthetic_storage_size
 * is deprecated and always 0, so storage comes from the branch list instead.
 */
export function parseNeonProject(id: string, body: unknown): NeonProjectUsage | null {
  const project = body && typeof body === "object" ? (body as { project?: unknown }).project : null;
  if (!project || typeof project !== "object") return null;
  const item = project as Record<string, unknown>;
  const branchLimit = numberOrNull(item.branch_logical_size_limit_bytes);
  return {
    id,
    name: textOrNull(item.name) ?? id,
    regionId: textOrNull(item.region_id),
    createdAt: textOrNull(item.created_at),
    periodStart: textOrNull(item.consumption_period_start),
    periodEnd: textOrNull(item.consumption_period_end),
    computeSeconds: numberOrNull(item.compute_time_seconds),
    activeSeconds: numberOrNull(item.active_time_seconds),
    cpuSeconds: numberOrNull(item.cpu_used_sec),
    transferBytes: numberOrNull(item.data_transfer_bytes),
    writtenBytes: numberOrNull(item.written_data_bytes),
    storageBytes: null,
    branchCount: null,
    branchLimitBytes: branchLimit && branchLimit > 0 ? branchLimit : null,
    endpoints: [],
  };
}

/** Neon's GET /projects/{id}/branches answer: the branches' total logical size, null when none had one. */
export function parseNeonBranches(body: unknown): { bytes: number | null; count: number } {
  const list = body && typeof body === "object" ? (body as { branches?: unknown }).branches : null;
  if (!Array.isArray(list)) return { bytes: null, count: 0 };
  const sizes = list.flatMap((entry) => {
    const size = entry && typeof entry === "object" ? numberOrNull((entry as Record<string, unknown>).logical_size) : null;
    return size === null ? [] : [size];
  });
  return { bytes: sizes.length ? sizes.reduce((sum, size) => sum + size, 0) : null, count: list.length };
}

/** Neon's GET /projects/{id}/endpoints answer. */
export function parseNeonEndpoints(body: unknown): NeonEndpoint[] {
  const list = body && typeof body === "object" ? (body as { endpoints?: unknown }).endpoints : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const id = textOrNull(item.id);
    if (!id) return [];
    return [{
      id,
      state: textOrNull(item.current_state),
      minCu: numberOrNull(item.autoscaling_limit_min_cu),
      maxCu: numberOrNull(item.autoscaling_limit_max_cu),
      suspendSeconds: numberOrNull(item.suspend_timeout_seconds),
      lastActive: textOrNull(item.last_active),
      poolerEnabled: typeof item.pooler_enabled === "boolean" ? item.pooler_enabled : null,
      host: textOrNull(item.host),
    }];
  });
}

/** NEON_PROJECT_ID may list several projects, comma-separated; anything not like an ID is dropped. */
export function parseProjectIds(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((id) => id.trim()).filter((id) => /^[a-z0-9-]{1,64}$/i.test(id)))].slice(0, 10);
}

/** The endpoint ID in a database host ("ep-x-123.c-6.us-east-2.aws.neon.tech", with or without -pooler). */
export function endpointIdOfHost(host: string): string | null {
  const first = host.split(".")[0] ?? "";
  return first.startsWith("ep-") ? first.replace(/-pooler$/, "") : null;
}

// ---- One quota, ready to show ----

export type QuotaSource = "neon" | "database" | "unavailable";
export type QuotaView = {
  key: QuotaKey;
  // Null when no source gave a number: shown as unavailable, never as zero.
  used: number | null;
  limit: number;
  remaining: number | null;
  percent: number | null;
  level: Level | null;
  source: QuotaSource;
  sourceNote: string;
  forecast: Forecast;
  daily: { day: string; value: number }[];
};

const MIB = 1024 * 1024;
const GIB = 1024 ** 3;

function quota(key: QuotaKey, used: number | null, limit: number, thresholds: Thresholds, rest: Omit<QuotaView, "key" | "used" | "limit" | "remaining" | "percent" | "level">): QuotaView {
  return {
    key,
    used,
    limit,
    remaining: used === null ? null : Math.max(0, limit - used),
    percent: used === null ? null : (used / limit) * 100,
    level: used === null ? null : levelOf(used, limit, thresholds),
    ...rest,
  };
}

/**
 * The three quotas of one project: storage, compute (CU-hours), and network transfer, each with
 * its source, forecast, and daily history. Storage prefers Neon's size of all the project's
 * branches; when Neon sends none it falls back to this database's size, named as such. Compute and
 * transfer come only from Neon. Neon's project counters are not its billing record (the billing
 * API is not on the Free plan), and the notes say so.
 */
export function quotaViews(input: {
  limits: PlanLimits;
  project: NeonProjectUsage | null;
  // Why Neon gave nothing, when it did not.
  neonMissing: string;
  databaseBytes: number | null;
  history: HistoryPoint[];
  now: number;
}): Record<QuotaKey, QuotaView> {
  const { limits, project, neonMissing, databaseBytes, history, now } = input;
  const projectPoints = project ? history.filter((point) => point.projectId === project.id) : [];
  const sizePoints = history
    .filter((point) => point.databaseBytes !== null && (point.projectId === "database" || point.projectId === project?.id))
    .map((point) => ({ at: point.at, bytes: point.databaseBytes! }));

  const storageLimit = limits.storageMb * MIB;
  const neonStorage = project?.storageBytes && project.storageBytes > 0 ? project.storageBytes : null;
  const storageUsed = neonStorage ?? databaseBytes;
  const storage = quota("storage", storageUsed, storageLimit, limits.thresholds, {
    source: neonStorage !== null ? "neon" : databaseBytes !== null ? "database" : "unavailable",
    sourceNote: neonStorage !== null
      ? `Logical size of the project's ${project?.branchCount === 1 ? "branch" : `${project?.branchCount ?? "all"} branches`}, from Neon's API`
      : databaseBytes !== null
        ? `This database's size (PostgreSQL)${project ? "; Neon sent no project storage" : ""}`
        : "No measurement yet",
    forecast: storageUsed === null
      ? { enough: false, reason: "Insufficient data: no size measured yet." }
      : storageForecast(sizePoints, storageLimit, storageUsed, now),
    daily: [],
  });

  const unavailable = (key: QuotaKey, limit: number): QuotaView => quota(key, null, limit, limits.thresholds, {
    source: "unavailable",
    sourceNote: neonMissing,
    forecast: { enough: false, reason: neonMissing },
    daily: [],
  });
  // A project created during the period has been counting only since it was created.
  const createdInPeriod = project?.createdAt && project.periodStart && Date.parse(project.createdAt) > Date.parse(project.periodStart);
  const period = { periodStart: createdInPeriod ? project.createdAt : project?.periodStart ?? null, periodEnd: project?.periodEnd ?? null, now };

  const computeLimit = limits.computeHours;
  const compute = !project || project.computeSeconds === null
    ? unavailable("compute", computeLimit)
    : quota("compute", project.computeSeconds / 3600, computeLimit, limits.thresholds, {
        source: "neon",
        sourceNote: "Neon's compute time this billing period (CU-hours), from Neon's API; Neon's invoice is the official figure",
        forecast: periodForecast({ used: project.computeSeconds / 3600, limit: computeLimit, ...period }),
        daily: dailyUse(projectPoints, "computeSeconds").map((entry) => ({ day: entry.day, value: entry.value / 3600 })),
      });

  const transferLimit = limits.transferGb * GIB;
  const transfer = !project || project.transferBytes === null
    ? unavailable("transfer", transferLimit)
    : quota("transfer", project.transferBytes, transferLimit, limits.thresholds, {
        source: "neon",
        sourceNote: "Neon's data transfer this billing period, from Neon's API; Neon's invoice is the official figure",
        forecast: periodForecast({ used: project.transferBytes, limit: transferLimit, ...period }),
        daily: dailyUse(projectPoints, "transferBytes"),
      });

  return { storage, compute, transfer };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
