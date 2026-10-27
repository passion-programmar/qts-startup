import "server-only";

import { eq, inArray, sql, type SQL } from "drizzle-orm";
import { after } from "next/server";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";
import { removeOldGeminiApiCallLogs } from "@/lib/gemini-usage";
import { ROMANIA_TIME_ZONE, romaniaClock } from "@/lib/romania-time";
import {
  DATA_TABLES,
  type DeleteRequest,
  type HistoryPoint,
  type Level,
  parseDeleteRequest,
  parseKeepDays,
  parsePlanLimits,
  type PlanLimits,
  type QuotaKey,
  type QuotaView,
  quotaViews,
} from "./database-usage-values";
import { type NeonAccountUsage, type NeonProjectResult, readNeonAccountUsage } from "./neon-account";

// The Database usage page's server side, in two parts that run only when Super Admin clicks:
// - Check quota: Neon's management API (never wakes a compute) for compute, transfer, and
//   storage, plus one cheap size read of the database.
// - Run diagnostics: PostgreSQL statistics (tables, connections, queries).
// Each result is saved and shown until the next click. Deleting by hand goes in small steps; the
// automatic clean-up runs once a Romania day inside requests that run anyway.

const QUOTA_KEY = "database_usage_quota";
const DIAGNOSTICS_KEY = "database_usage_diagnostics";
const HISTORY_KEY = "database_usage_history";
const HEALTH_KEY = "database_health";
const ALERT_KEY = "database_alert_dismissed";
const LOCK_KEY = "database_usage_lock";
const CLEANUP_KEY = "database_cleanup";
const KEEP_DAYS_KEY = "database_keep_days";
const PLAN_LIMITS_KEY = "database_plan_limits";
const QUESTION_MEMORY_DAYS = 90;
const DELETE_CHUNK = 2000;
const MAX_HISTORY_POINTS = 400;
const MAX_HEALTH_EVENTS = 20;
const LIVE_APPLY_STATUSES = sql.raw("('claimed', 'waiting_review', 'waiting_confirmation', 'submitting')");

// Each deletable table's dating column, and which rows may go at all: live rows never do.
const TABLE_SQL: Record<string, { dateColumn: string; deletable?: SQL }> = {
  bids: { dateColumn: "applied_at" },
  jobs: {
    dateColumn: "created_at",
    deletable: sql`status in ('applied', 'failed') and not exists (
      select 1 from apply_attempts live where live.job_id = jobs.id and live.status in ${LIVE_APPLY_STATUSES})`,
  },
  // A job's newest delivered run stays while the job exists: Apply prints its résumé from it.
  generation_runs: {
    dateColumn: "created_at",
    deletable: sql`status <> 'pending' and (job_id is null or exists (
      select 1 from generation_runs newer
      where newer.job_id = generation_runs.job_id and newer.status = 'delivered' and newer.created_at > generation_runs.created_at))`,
  },
  apply_attempts: { dateColumn: "created_at", deletable: sql`status not in ${LIVE_APPLY_STATUSES}` },
  gemini_api_call_logs: { dateColumn: "started_at" },
  gemini_key_usage_events: { dateColumn: "occurred_at" },
  get_jd_page_checks: { dateColumn: "created_at", deletable: sql`expires_at < now()` },
  apply_question_memory: { dateColumn: "last_seen_at" },
  login_history: { dateColumn: "logged_in_at" },
  login_rate_limit_events: { dateColumn: "occurred_at" },
};

function deleteWhere(request: DeleteRequest): SQL {
  const spec = TABLE_SQL[request.table.key];
  const parts: SQL[] = spec.deletable ? [spec.deletable] : [];
  if (request.mode === "older") {
    parts.push(sql`${sql.identifier(spec.dateColumn)} < now() - make_interval(days => ${request.days})`);
  }
  return parts.length ? sql.join(parts.map((part) => sql`(${part})`), sql` and `) : sql`true`;
}

const numberOf = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const numberOrNull = (value: unknown) => {
  const parsed = typeof value === "number" ? value : value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
// A database error for the page and the health log: its first line only, never its parameters.
const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : "Unknown error").split("\n")[0].slice(0, 200);

/** How many rows a delete would remove, and about how many bytes, before anything is deleted. */
export async function previewDelete(request: DeleteRequest): Promise<{ rows: number; bytes: number }> {
  const table = sql.identifier(request.table.key);
  const result = await db.execute<{ rows: number; total: number; bytes: string }>(sql`
    select
      (select count(*) from ${table} where ${deleteWhere(request)})::int as rows,
      (select count(*) from ${table})::int as total,
      pg_total_relation_size(${request.table.key}::regclass)::bigint as bytes`);
  const row = result.rows[0];
  const rows = numberOf(row?.rows);
  const total = numberOf(row?.total);
  return { rows, bytes: total ? Math.round((rows / total) * numberOf(row?.bytes)) : 0 };
}

/**
 * Deletes what the request names, 2,000 rows at a time so no single statement runs long. Stops
 * after the time budget; `more` says rows are left for another click.
 */
export async function deleteRows(request: DeleteRequest, budgetMs = 20_000): Promise<{ deleted: number; more: boolean }> {
  const table = sql.identifier(request.table.key);
  const where = deleteWhere(request);
  const started = Date.now();
  let deleted = 0;
  for (;;) {
    const result = await db.execute<{ n: number }>(sql`
      with gone as (
        delete from ${table} where id in (select id from ${table} where ${where} limit ${DELETE_CHUNK}) returning 1
      )
      select count(*)::int as n from gone`);
    const removed = numberOf(result.rows[0]?.n);
    deleted += removed;
    if (removed < DELETE_CHUNK) return { deleted, more: false };
    if (Date.now() - started > budgetMs) return { deleted, more: true };
  }
}

const upsertSetting = (key: string, value: unknown, userId: string | null) => db
  .insert(settings)
  .values({ key, value, updatedByUserId: userId })
  .onConflictDoUpdate({ target: settings.key, set: { value, updatedByUserId: userId, updatedAt: new Date() } });

async function saveSetting(key: string, value: unknown, userId: string | null): Promise<void> {
  await upsertSetting(key, value, userId);
  savedCache = null;
}

export const saveKeepDays = (generationRuns: number, userId: string) =>
  saveSetting(KEEP_DAYS_KEY, { generationRuns }, userId);

export const savePlanLimits = (limits: PlanLimits, userId: string) => saveSetting(PLAN_LIMITS_KEY, limits, userId);

/** "Dismiss" on the warning banner: it shows again only when a quota gets worse. */
export const dismissAlerts = (levels: Partial<Record<QuotaKey, Level>>, userId: string) =>
  saveSetting(ALERT_KEY, { levels, at: new Date().toISOString() }, userId);

// ---- Monitoring lock: one check at a time across every server ----

export class MonitoringBusyError extends Error {
  constructor() {
    super("A check is already running. Wait a moment and refresh.");
  }
}

async function withMonitoringLock<T>(work: () => Promise<T>): Promise<T> {
  const until = new Date(Date.now() + 60_000).toISOString();
  const claimed = await db.execute<{ key: string }>(sql`
    insert into settings (key, value) values (${LOCK_KEY}, ${JSON.stringify({ until })}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
      where (settings.value->>'until')::timestamptz < now()
    returning key`);
  if (!claimed.rows.length) throw new MonitoringBusyError();
  try {
    return await work();
  } finally {
    await db.execute(sql`update settings set value = jsonb_build_object('until', now()) where key = ${LOCK_KEY}`).catch(() => undefined);
  }
}

// ---- Saved state ----

export type HealthEvent = { at: string; source: "database" | "neon"; ok: boolean; message: string; latencyMs: number | null };
export type HealthLog = { lastDatabaseOkAt: string | null; lastDatabaseFailAt: string | null; events: HealthEvent[] };

export type QuotaSnapshot = {
  checkedAt: string;
  database: {
    ok: boolean;
    // One round trip from the server, in milliseconds.
    latencyMs: number | null;
    // pg_database_size of this database.
    usedBytes: number | null;
    // neon.max_cluster_size: the size above which this compute refuses writes.
    writeLimitBytes: number | null;
    error: string | null;
  };
  neon: NeonAccountUsage;
};

export type CleanupResult = {
  day: string;
  at: string;
  // Rows removed per table key.
  removed: Record<string, number>;
  freedBytes: number;
  // Rows were left because the time ran out; the next run continues.
  more: boolean;
  byHand: boolean;
  // The database size after the clean-up: a daily storage point without anyone clicking.
  usedBytes: number | null;
};

export type TableDiagnostics = {
  name: string;
  bytes: number;
  tableBytes: number;
  indexBytes: number;
  rows: number;
  oldest: string | null;
  addedPerDay: number | null;
  seqScans: number;
  indexScans: number;
};

export type DiagnosticsSnapshot = {
  checkedAt: string;
  tables: TableDiagnostics[];
  bidsPerDay: { day: string; count: number }[];
  connections: {
    active: number;
    idle: number;
    idleInTransaction: number;
    waitingOnLock: number;
    // Every client connection to this compute, across its databases.
    total: number;
    max: number | null;
    reserved: number | null;
  };
  activity: {
    commits: number;
    rollbacks: number;
    deadlocks: number;
    sessions: number | null;
    sessionsAbandoned: number | null;
    sessionsFatal: number | null;
    sessionsKilled: number | null;
    cacheHitPercent: number | null;
    statsSince: string | null;
  };
  longQueries: { seconds: number; state: string; wait: string | null; query: string }[];
  locksWaiting: number;
  unusedIndexes: { table: string; index: string; bytes: number }[];
  statements: { enabled: boolean; top: { query: string; calls: number; totalMs: number; meanMs: number }[] };
  usesPooler: boolean;
};

export type UsageState = {
  quota: QuotaSnapshot | null;
  diagnostics: DiagnosticsSnapshot | null;
  history: HistoryPoint[];
  health: HealthLog;
  lastCleanup: CleanupResult | null;
  keepDays: { generationRuns: number };
  planLimits: PlanLimits;
  dismissed: Partial<Record<QuotaKey, Level>>;
  // Minutes since each saved check, for "live", "cached", and "stale".
  quotaAgeMinutes: number | null;
  diagnosticsAgeMinutes: number | null;
};

const objectOf = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);

function parseCleanup(value: unknown): CleanupResult | null {
  const item = objectOf(value);
  if (!item || typeof item.at !== "string" || !objectOf(item.removed)) return null;
  return {
    day: typeof item.day === "string" ? item.day : "",
    at: item.at,
    removed: Object.fromEntries(Object.entries(item.removed as Record<string, unknown>).map(([key, count]) => [key, numberOf(count)])),
    freedBytes: numberOf(item.freedBytes),
    more: item.more === true,
    byHand: item.byHand === true,
    usedBytes: numberOrNull(item.usedBytes),
  };
}

function parseHealth(value: unknown): HealthLog {
  const item = objectOf(value);
  return {
    lastDatabaseOkAt: typeof item?.lastDatabaseOkAt === "string" ? item.lastDatabaseOkAt : null,
    lastDatabaseFailAt: typeof item?.lastDatabaseFailAt === "string" ? item.lastDatabaseFailAt : null,
    events: Array.isArray(item?.events) ? (item.events as HealthEvent[]).slice(0, MAX_HEALTH_EVENTS) : [],
  };
}

const minutesSince = (at: string | undefined) => (at ? Math.max(0, (Date.now() - Date.parse(at)) / 60_000) : null);

/** Everything the page shows, as the last clicks and clean-up saved it: one small read. */
export async function readUsageState(): Promise<UsageState> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [QUOTA_KEY, DIAGNOSTICS_KEY, HISTORY_KEY, HEALTH_KEY, ALERT_KEY, CLEANUP_KEY, KEEP_DAYS_KEY, PLAN_LIMITS_KEY]));
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  const quota = objectOf(value(QUOTA_KEY)) && typeof objectOf(value(QUOTA_KEY))!.checkedAt === "string" ? value(QUOTA_KEY) as QuotaSnapshot : null;
  const diagnostics = objectOf(value(DIAGNOSTICS_KEY)) && Array.isArray(objectOf(value(DIAGNOSTICS_KEY))!.tables) ? value(DIAGNOSTICS_KEY) as DiagnosticsSnapshot : null;
  const dismissed = objectOf(objectOf(value(ALERT_KEY))?.levels);
  return {
    quota,
    diagnostics,
    history: Array.isArray(value(HISTORY_KEY)) ? value(HISTORY_KEY) as HistoryPoint[] : [],
    health: parseHealth(value(HEALTH_KEY)),
    lastCleanup: parseCleanup(value(CLEANUP_KEY)),
    keepDays: parseKeepDays(value(KEEP_DAYS_KEY)),
    planLimits: parsePlanLimits(value(PLAN_LIMITS_KEY)),
    dismissed: (dismissed ?? {}) as Partial<Record<QuotaKey, Level>>,
    quotaAgeMinutes: minutesSince(quota?.checkedAt),
    diagnosticsAgeMinutes: minutesSince(diagnostics?.checkedAt),
  };
}

// A saved check per project per hour at most, so the history stays small: the newer replaces it.
function addHistory(history: HistoryPoint[], points: HistoryPoint[]): HistoryPoint[] {
  let next = [...history];
  for (const point of points) {
    const last = [...next].reverse().find((entry) => entry.projectId === point.projectId);
    if (last && Date.parse(point.at) - Date.parse(last.at) < 3_600_000) next = next.filter((entry) => entry !== last);
    next.push(point);
  }
  return next.slice(-MAX_HISTORY_POINTS);
}

function addHealth(health: HealthLog, events: HealthEvent[]): HealthLog {
  const database = events.filter((event) => event.source === "database");
  return {
    lastDatabaseOkAt: database.find((event) => event.ok)?.at ?? health.lastDatabaseOkAt,
    lastDatabaseFailAt: database.find((event) => !event.ok)?.at ?? health.lastDatabaseFailAt,
    events: [...events, ...health.events].slice(0, MAX_HEALTH_EVENTS),
  };
}

// ---- Check quota ----

async function readDatabaseSize(): Promise<QuotaSnapshot["database"]> {
  const started = Date.now();
  try {
    const result = await db.execute<{ used: string; limit_mb: string | null }>(sql`
      select pg_database_size(current_database())::bigint as used,
        (select setting from pg_settings where name = 'neon.max_cluster_size') as limit_mb`);
    const limitMb = numberOrNull(result.rows[0]?.limit_mb);
    return {
      ok: true,
      latencyMs: Date.now() - started,
      usedBytes: numberOrNull(result.rows[0]?.used),
      writeLimitBytes: limitMb && limitMb > 0 ? limitMb * 1024 * 1024 : null,
      error: null,
    };
  } catch (error) {
    return { ok: false, latencyMs: null, usedBytes: null, writeLimitBytes: null, error: errorText(error) };
  }
}

/** "Check quota": Neon's counters for every configured project and this database's size, saved until the next check. */
export async function checkQuota(userId: string): Promise<QuotaSnapshot> {
  return withMonitoringLock(async () => {
    const [database, neon, state] = await Promise.all([readDatabaseSize(), readNeonAccountUsage(), readUsageState()]);
    const snapshot: QuotaSnapshot = { checkedAt: new Date().toISOString(), database, neon };
    const at = snapshot.checkedAt;
    const { day } = romaniaClock();
    const points: HistoryPoint[] = [];
    const events: HealthEvent[] = [{
      at,
      source: "database",
      ok: database.ok,
      message: database.ok ? "Database answered." : `Database did not answer: ${database.error}`,
      latencyMs: database.latencyMs,
    }];
    if (neon.state === "checked") {
      for (const project of neon.projects) {
        if (project.ok) {
          points.push({
            at,
            day,
            projectId: project.id,
            periodStart: project.periodStart,
            computeSeconds: project.computeSeconds,
            transferBytes: project.transferBytes,
            databaseBytes: project.isAppProject ? database.usedBytes : null,
          });
        }
        events.push({
          at,
          source: "neon",
          ok: project.ok,
          message: project.ok
            ? `Neon answered for ${project.name}.${project.endpointError ? ` Compute state: ${project.endpointError}` : ""}${project.branchError ? ` Branch sizes: ${project.branchError}` : ""}`
            : `Neon (${project.id}): ${project.error}`,
          latencyMs: null,
        });
      }
    }
    if (!points.some((point) => point.databaseBytes !== null) && database.usedBytes !== null) {
      points.push({ at, day, projectId: "database", periodStart: null, computeSeconds: null, transferBytes: null, databaseBytes: database.usedBytes });
    }
    await db.batch([
      upsertSetting(QUOTA_KEY, snapshot, userId),
      upsertSetting(HISTORY_KEY, addHistory(state.history, points), userId),
      upsertSetting(HEALTH_KEY, addHealth(state.health, events), userId),
    ]);
    savedCache = null;
    return snapshot;
  });
}

// ---- Run diagnostics ----

/** "Run diagnostics": PostgreSQL's own statistics, read once, cheap views only. */
export async function runDiagnostics(userId: string): Promise<DiagnosticsSnapshot> {
  return withMonitoringLock(async () => {
    const stats = sql.join(DATA_TABLES.map((table) => {
      const column = sql.identifier(TABLE_SQL[table.key].dateColumn);
      return sql`select ${table.key}::text as key, count(*)::int as rows, min(${column}) as oldest,
        count(*) filter (where ${column} > now() - interval '7 days')::int as week from ${sql.identifier(table.key)}`;
    }), sql` union all `);
    const [tableRows, statRows, bidRows, connectionRows, databaseRows, longRows, lockRows, indexRows, statementsRow, health] = await Promise.all([
      db.execute<{ name: string; bytes: string; table_bytes: string; index_bytes: string; rows: string; seq: string; idx: string }>(sql`
        select relname as name, pg_total_relation_size(relid)::bigint as bytes, pg_table_size(relid)::bigint as table_bytes,
          pg_indexes_size(relid)::bigint as index_bytes, n_live_tup::bigint as rows,
          coalesce(seq_scan, 0)::bigint as seq, coalesce(idx_scan, 0)::bigint as idx
        from pg_stat_user_tables where schemaname = 'public'`),
      db.execute<{ key: string; rows: number; oldest: string | null; week: number }>(stats),
      db.execute<{ day: string; count: number }>(sql`
        select to_char(applied_at at time zone ${ROMANIA_TIME_ZONE}, 'YYYY-MM-DD') as day, count(*)::int as count
        from bids where applied_at > now() - interval '30 days' group by 1`),
      db.execute<Record<string, string | null>>(sql`
        select
          count(*) filter (where datname = current_database() and state = 'active') as active,
          count(*) filter (where datname = current_database() and state = 'idle') as idle,
          count(*) filter (where datname = current_database() and state like 'idle in transaction%') as idle_in_transaction,
          count(*) filter (where datname = current_database() and wait_event_type = 'Lock') as waiting,
          count(*) as total,
          (select setting from pg_settings where name = 'max_connections') as max,
          (select setting from pg_settings where name = 'superuser_reserved_connections') as reserved
        from pg_stat_activity where backend_type = 'client backend'`),
      db.execute<Record<string, string | null>>(sql`
        select xact_commit, xact_rollback, deadlocks, sessions, sessions_abandoned, sessions_fatal, sessions_killed,
          case when blks_hit + blks_read > 0 then round(100.0 * blks_hit / (blks_hit + blks_read), 2) end as hit,
          stats_reset
        from pg_stat_database where datname = current_database()`),
      db.execute<{ seconds: string; state: string; wait: string | null; query: string }>(sql`
        select extract(epoch from now() - query_start)::int as seconds, state, wait_event_type as wait, left(query, 300) as query
        from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
          and query_start < now() - interval '5 seconds'
        order by query_start limit 10`),
      db.execute<{ n: number }>(sql`select count(*)::int as n from pg_locks where not granted`),
      db.execute<{ table: string; index: string; bytes: string }>(sql`
        select s.relname as table, s.indexrelname as index, pg_relation_size(s.indexrelid)::bigint as bytes
        from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
        where s.idx_scan = 0 and not i.indisunique and not i.indisprimary
        order by pg_relation_size(s.indexrelid) desc limit 10`),
      db.execute<{ enabled: boolean }>(sql`select exists (select 1 from pg_extension where extname = 'pg_stat_statements') as enabled`),
      readUsageState(),
    ]);
    const statementsEnabled = statementsRow.rows[0]?.enabled === true;
    const top = statementsEnabled
      ? await db.execute<{ query: string; calls: string; total: string; mean: string }>(sql`
          select left(query, 300) as query, calls, round(total_exec_time::numeric, 1) as total, round(mean_exec_time::numeric, 2) as mean
          from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())
          order by total_exec_time desc limit 10`).then((result) => result.rows).catch(() => [])
      : [];

    const statsByKey = new Map(statRows.rows.map((row) => [row.key, row]));
    const counts = new Map(bidRows.rows.map((row) => [row.day, numberOf(row.count)]));
    const connections = connectionRows.rows[0] ?? {};
    const activity = databaseRows.rows[0] ?? {};
    let usesPooler = false;
    try {
      usesPooler = new URL(process.env.DATABASE_URL ?? "").hostname.split(".")[0].endsWith("-pooler");
    } catch {
      usesPooler = false;
    }
    const snapshot: DiagnosticsSnapshot = {
      checkedAt: new Date().toISOString(),
      tables: tableRows.rows.map((row) => {
        const stat = statsByKey.get(row.name);
        return {
          name: row.name,
          bytes: numberOf(row.bytes),
          tableBytes: numberOf(row.table_bytes),
          indexBytes: numberOf(row.index_bytes),
          rows: stat ? numberOf(stat.rows) : numberOf(row.rows),
          oldest: stat?.oldest ? new Date(stat.oldest).toISOString() : null,
          addedPerDay: stat ? numberOf(stat.week) / 7 : null,
          seqScans: numberOf(row.seq),
          indexScans: numberOf(row.idx),
        };
      }).sort((a, b) => b.bytes - a.bytes),
      bidsPerDay: Array.from({ length: 30 }, (_, index) => {
        const { day } = romaniaClock(new Date(Date.now() - (29 - index) * 86_400_000));
        return { day, count: counts.get(day) ?? 0 };
      }),
      connections: {
        active: numberOf(connections.active),
        idle: numberOf(connections.idle),
        idleInTransaction: numberOf(connections.idle_in_transaction),
        waitingOnLock: numberOf(connections.waiting),
        total: numberOf(connections.total),
        max: numberOrNull(connections.max),
        reserved: numberOrNull(connections.reserved),
      },
      activity: {
        commits: numberOf(activity.xact_commit),
        rollbacks: numberOf(activity.xact_rollback),
        deadlocks: numberOf(activity.deadlocks),
        sessions: numberOrNull(activity.sessions),
        sessionsAbandoned: numberOrNull(activity.sessions_abandoned),
        sessionsFatal: numberOrNull(activity.sessions_fatal),
        sessionsKilled: numberOrNull(activity.sessions_killed),
        cacheHitPercent: numberOrNull(activity.hit),
        statsSince: activity.stats_reset ? new Date(activity.stats_reset).toISOString() : null,
      },
      longQueries: longRows.rows.map((row) => ({ seconds: numberOf(row.seconds), state: row.state, wait: row.wait, query: row.query })),
      locksWaiting: numberOf(lockRows.rows[0]?.n),
      unusedIndexes: indexRows.rows.map((row) => ({ table: row.table, index: row.index, bytes: numberOf(row.bytes) })),
      statements: {
        enabled: statementsEnabled,
        top: top.map((row) => ({ query: row.query, calls: numberOf(row.calls), totalMs: numberOf(row.total), meanMs: numberOf(row.mean) })),
      },
      usesPooler,
    };
    await db.batch([
      upsertSetting(DIAGNOSTICS_KEY, snapshot, userId),
      upsertSetting(HEALTH_KEY, addHealth(health.health, [{ at: snapshot.checkedAt, source: "database", ok: true, message: "Diagnostics read.", latencyMs: null }]), userId),
    ]);
    savedCache = null;
    return snapshot;
  });
}

// ---- Automatic clean-up ----

// Average bytes per row of the tables the clean-up touches, to say about how much it freed.
async function rowSizes(keys: string[]): Promise<Map<string, number>> {
  const result = await db.execute<{ name: string; bytes: string; rows: string }>(sql`
    select relname as name, pg_total_relation_size(relid)::bigint as bytes, greatest(n_live_tup, 1)::bigint as rows
    from pg_stat_user_tables
    where schemaname = 'public' and relname in (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})`);
  return new Map(result.rows.map((row) => [row.name, numberOf(row.bytes) / numberOf(row.rows)]));
}

/** The automatic clean-up's rules, run now: old Generation runs, expired Get JD checks, old logs and questions. */
export async function cleanUpNow(byHand: boolean): Promise<CleanupResult> {
  const [keepRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEEP_DAYS_KEY)).limit(1);
  const keep = parseKeepDays(keepRow?.value);
  const sizes = await rowSizes(["generation_runs", "get_jd_page_checks", "apply_question_memory", "gemini_api_call_logs"]);
  const removed: Record<string, number> = {};
  let more = false;
  const run = async (key: string, mode: string, days: number) => {
    const request = parseDeleteRequest(key, mode, String(days));
    if (typeof request === "string") return;
    const result = await deleteRows(request, 8_000);
    removed[key] = result.deleted;
    more ||= result.more;
  };
  await run("generation_runs", "older", keep.generationRuns);
  await run("get_jd_page_checks", "expired", 0);
  await run("apply_question_memory", "older", QUESTION_MEMORY_DAYS);
  removed.gemini_api_call_logs = await removeOldGeminiApiCallLogs();
  const size = await readDatabaseSize();

  const at = new Date().toISOString();
  const { day } = romaniaClock();
  const result: CleanupResult = {
    day,
    at,
    removed,
    freedBytes: Math.round(Object.entries(removed).reduce((sum, [key, count]) => sum + count * (sizes.get(key) ?? 0), 0)),
    more,
    byHand,
    usedBytes: size.usedBytes,
  };
  // The day's size joins the storage history, so its forecast needs no clicks.
  const [historyRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, HISTORY_KEY)).limit(1);
  const history = Array.isArray(historyRow?.value) ? historyRow.value as HistoryPoint[] : [];
  await db.batch([
    upsertSetting(CLEANUP_KEY, result, null),
    upsertSetting(HISTORY_KEY, size.usedBytes === null ? history : addHistory(history, [
      { at, day, projectId: "database", periodStart: null, computeSeconds: null, transferBytes: null, databaseBytes: size.usedBytes },
    ]), null),
  ]);
  savedCache = null;
  return result;
}

// The Romania day this server already ran or saw the clean-up, so most requests skip the database.
let cleanedDay: string | null = null;

/** Runs the clean-up when it has not run yet this Romania day: one request across every server does it. */
export async function cleanUpIfDue(): Promise<CleanupResult | null> {
  const { day } = romaniaClock();
  if (cleanedDay === day) return null;
  const claimed = await db.execute<{ key: string }>(sql`
    insert into settings (key, value) values (${CLEANUP_KEY}, ${JSON.stringify({ day })}::jsonb)
    on conflict (key) do update
      set value = settings.value || jsonb_build_object('day', ${day}::text), updated_at = now()
      where settings.value->>'day' is distinct from ${day}
    returning key`);
  cleanedDay = day;
  if (!claimed.rows.length) return null;
  return cleanUpNow(false);
}

/** From a busy route: the day's clean-up runs after the response, never slowing the request. */
export function scheduleDailyCleanup(): void {
  if (cleanedDay === romaniaClock().day) return;
  after(() => cleanUpIfDue().then(() => undefined).catch((error: unknown) => {
    console.warn("The daily database clean-up failed.", errorText(error));
  }));
}

// ---- Banner ----

let savedCache: { at: number; state: UsageState } | null = null;

/** The saved state for Super Admin's warning banner, read at most every 10 minutes per server. */
export async function readSavedState(): Promise<UsageState> {
  if (!savedCache || Date.now() - savedCache.at > 10 * 60_000) {
    savedCache = { at: Date.now(), state: await readUsageState() };
  }
  return savedCache.state;
}

// ---- Quotas for the page and the banner ----

export type ProjectQuotas = {
  id: string;
  name: string;
  isAppProject: boolean;
  usage: Extract<NeonProjectResult, { ok: true }> | null;
  error: string | null;
  views: Record<QuotaKey, QuotaView>;
};

/**
 * Each configured project's quotas, the app's own project first. Without the Neon API, the app's
 * database still shows its storage, and compute and transfer say why they are unavailable.
 */
export function projectQuotas(state: UsageState, now = Date.now()): ProjectQuotas[] {
  const { quota, planLimits, history } = state;
  const databaseBytes = quota?.database.usedBytes ?? state.lastCleanup?.usedBytes ?? null;
  const neon = quota?.neon;
  if (!neon || neon.state === "not_configured") {
    return [{
      id: "database",
      name: "This app's database",
      isAppProject: true,
      usage: null,
      error: null,
      views: quotaViews({
        limits: planLimits,
        project: null,
        neonMissing: quota ? "Unavailable: the Neon account is not connected (NEON_API_KEY, NEON_PROJECT_ID)." : "Unavailable: click Check quota.",
        databaseBytes,
        history,
        now,
      }),
    }];
  }
  return [...neon.projects]
    .sort((a, b) => Number(b.isAppProject) - Number(a.isAppProject))
    .map((project) => ({
      id: project.id,
      name: project.ok ? project.name : project.id,
      isAppProject: project.isAppProject,
      usage: project.ok ? project : null,
      error: project.ok ? null : project.error,
      views: quotaViews({
        limits: planLimits,
        project: project.ok ? project : null,
        neonMissing: project.ok ? "Unavailable: Neon did not send this number." : `Unavailable: ${project.error}`,
        databaseBytes: project.isAppProject ? databaseBytes : null,
        history,
        now,
      }),
    }));
}

/** The app's quota levels, for the banner: only ones Neon or the database measured. */
export function appLevels(state: UsageState): Partial<Record<QuotaKey, Level>> {
  const app = projectQuotas(state).find((project) => project.isAppProject);
  if (!app) return {};
  return Object.fromEntries(
    (Object.values(app.views) as QuotaView[]).filter((view) => view.level).map((view) => [view.key, view.level!]),
  ) as Partial<Record<QuotaKey, Level>>;
}
