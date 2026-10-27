import assert from "node:assert/strict";
import test from "node:test";
import {
  DATA_TABLES,
  dailyUse,
  endpointIdOfHost,
  formatBytes,
  GENERATION_KEEP_DAYS_DEFAULT,
  type HistoryPoint,
  levelOf,
  NEON_FREE_LIMITS,
  parseDeleteRequest,
  parseKeepDays,
  parseNeonBranches,
  parseNeonEndpoints,
  parseNeonProject,
  parsePlanLimits,
  parseProjectIds,
  periodForecast,
  quotasToAlert,
  quotaViews,
  storageForecast,
  worstLevel,
} from "./database-usage-values";

const DAY = 86_400_000;
const now = Date.parse("2026-10-20T12:00:00Z");

test("a delete is checked against its table's rule", () => {
  const all = parseDeleteRequest("bids", "all", "");
  assert.ok(typeof all !== "string" && all.mode === "all");
  const older = parseDeleteRequest("generation_runs", "older", " 30 ");
  assert.ok(typeof older !== "string" && older.mode === "older" && older.days === 30);
  // Recent counters decide limits, so they can only be deleted by age, never all at once.
  assert.equal(typeof parseDeleteRequest("gemini_key_usage_events", "all", ""), "string");
  assert.equal(typeof parseDeleteRequest("gemini_key_usage_events", "older", "1"), "string");
  assert.equal(typeof parseDeleteRequest("login_rate_limit_events", "older", "0"), "string");
  // Get JD checks only ever lose their expired rows, whatever was asked.
  const expired = parseDeleteRequest("get_jd_page_checks", "all", "");
  assert.ok(typeof expired !== "string" && expired.mode === "expired");
  // Tables outside the list (people, prompts, settings) are never deleted from here.
  for (const table of ["users", "profiles", "prompts", "settings", "reusable_answers", "x; drop table bids"]) {
    assert.equal(typeof parseDeleteRequest(table, "all", ""), "string");
  }
  assert.equal(typeof parseDeleteRequest("bids", "older", "1.5"), "string");
  assert.equal(typeof parseDeleteRequest("bids", "older", "-1"), "string");
  const keys = DATA_TABLES.map((table) => table.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[a-z_]+$/);
});

test("keep days and plan limits fall back to safe defaults", () => {
  assert.deepEqual(parseKeepDays({ generationRuns: 14 }), { generationRuns: 14 });
  for (const value of [null, {}, { generationRuns: 0 }, { generationRuns: 400 }, { generationRuns: 2.5 }, "3"]) {
    assert.deepEqual(parseKeepDays(value), { generationRuns: GENERATION_KEEP_DAYS_DEFAULT });
  }
  assert.deepEqual(parsePlanLimits(null), NEON_FREE_LIMITS);
  assert.equal(NEON_FREE_LIMITS.storageMb, 1024);
  assert.equal(NEON_FREE_LIMITS.computeHours, 100);
  assert.equal(NEON_FREE_LIMITS.transferGb, 5);
  // Levels out of order would hide a warning, so the defaults come back.
  assert.deepEqual(parsePlanLimits({ thresholds: { warning: 90, high: 80, critical: 95 } }).thresholds, NEON_FREE_LIMITS.thresholds);
  assert.equal(parsePlanLimits({ storageMb: -5, computeHours: "x" }).computeHours, 100);
});

test("levels: warning 70%, high 85%, critical 95%, reached at 100%, and configurable", () => {
  assert.equal(levelOf(69, 100), "ok");
  assert.equal(levelOf(70, 100), "warning");
  assert.equal(levelOf(85, 100), "high");
  assert.equal(levelOf(95, 100), "critical");
  assert.equal(levelOf(100, 100), "reached");
  assert.equal(levelOf(130, 100), "reached");
  assert.equal(levelOf(60, 100, { warning: 50, high: 60, critical: 90 }), "high");
  assert.equal(worstLevel(["ok", "high", "warning"]), "high");
  assert.equal(worstLevel([]), "ok");
});

test("the banner warns once per condition: again only when a level gets worse", () => {
  assert.deepEqual(quotasToAlert({ storage: "warning", compute: "ok" }, {}), ["storage"]);
  assert.deepEqual(quotasToAlert({ storage: "warning" }, { storage: "warning" }), []);
  assert.deepEqual(quotasToAlert({ storage: "high" }, { storage: "warning" }), ["storage"]);
  assert.deepEqual(quotasToAlert({ storage: "warning" }, { storage: "high" }), []);
  assert.deepEqual(quotasToAlert({ transfer: "reached", compute: "critical" }, { compute: "critical" }), ["transfer"]);
});

test("a monthly forecast uses Neon's counter since the period start, and says when there is too little", () => {
  const periodStart = new Date(now - 10 * DAY).toISOString();
  const periodEnd = new Date(now + 20 * DAY).toISOString();
  const forecast = periodForecast({ used: 40, limit: 100, periodStart, periodEnd, now });
  assert.ok(forecast.enough);
  assert.equal(forecast.perDay, 4);
  assert.equal(forecast.projectedAtPeriodEnd, 120);
  assert.equal(forecast.daysToLimit, 15);
  // A limit only reached after the period ends (when the counter resets) is not reached.
  const slow = periodForecast({ used: 10, limit: 100, periodStart, periodEnd, now });
  assert.ok(slow.enough && slow.daysToLimit === null && slow.limitDate === null);
  assert.equal(periodForecast({ used: 1, limit: 100, periodStart: new Date(now - 3_600_000).toISOString(), periodEnd, now }).enough, false);
  assert.equal(periodForecast({ used: 1, limit: 100, periodStart: null, periodEnd: null, now }).enough, false);
});

test("a storage forecast needs measurements on two days", () => {
  assert.equal(storageForecast([{ at: new Date(now).toISOString(), bytes: 100 }], 1000, 100, now).enough, false);
  assert.equal(storageForecast([
    { at: new Date(now - 3_600_000).toISOString(), bytes: 100 },
    { at: new Date(now).toISOString(), bytes: 110 },
  ], 1000, 110, now).enough, false);
  const forecast = storageForecast([
    { at: new Date(now - 10 * DAY).toISOString(), bytes: 100 },
    { at: new Date(now).toISOString(), bytes: 200 },
  ], 1000, 200, now);
  assert.ok(forecast.enough && forecast.perDay === 10 && forecast.daysToLimit === 80);
});

test("daily use subtracts each day's last check, starting again in a new billing period", () => {
  const point = (day: string, hour: string, periodStart: string, computeSeconds: number | null): HistoryPoint => ({
    at: `${day}T${hour}:00:00Z`, day, projectId: "p", periodStart, computeSeconds, transferBytes: null, databaseBytes: null,
  });
  const points = [
    point("2026-10-29", "08", "2026-10-01", 3600),
    point("2026-10-30", "08", "2026-10-01", 5000),
    point("2026-10-30", "20", "2026-10-01", 7200),
    point("2026-11-01", "09", "2026-11-01", 1800),
    point("2026-11-02", "09", "2026-11-01", null),
  ];
  assert.deepEqual(dailyUse(points, "computeSeconds"), [
    { day: "2026-10-30", value: 3600 },
    { day: "2026-11-01", value: 1800 },
  ]);
  assert.deepEqual(dailyUse([], "transferBytes"), []);
});

test("Neon answers: missing numbers stay null, never zero", () => {
  const project = parseNeonProject("p-1", {
    project: {
      name: "qts",
      compute_time_seconds: 7200,
      data_transfer_bytes: 0,
      // Deprecated by Neon and always 0: never taken as the project's storage.
      synthetic_storage_size: 0,
      branch_logical_size_limit_bytes: 1024 ** 3,
      consumption_period_start: "2026-10-01T00:00:00Z",
    },
  });
  assert.ok(project);
  assert.equal(project.computeSeconds, 7200);
  assert.equal(project.transferBytes, 0);
  assert.equal(project.storageBytes, null);
  assert.equal(project.branchLimitBytes, 1024 ** 3);
  assert.equal(project.activeSeconds, null);
  assert.equal(parseNeonProject("p-1", { error: "x" }), null);
  assert.equal(parseNeonProject("p-1", { project: { branch_logical_size_limit_bytes: 0 } })!.branchLimitBytes, null);
  assert.deepEqual(parseNeonBranches({ branches: [{ id: "br-main", logical_size: 30_000_000 }, { id: "br-dev", logical_size: 2_000_000 }, { id: "br-new" }] }), { bytes: 32_000_000, count: 3 });
  assert.deepEqual(parseNeonBranches({ branches: [{ id: "br-new" }] }), { bytes: null, count: 1 });
  assert.deepEqual(parseNeonBranches({ error: "x" }), { bytes: null, count: 0 });
  const [endpoint] = parseNeonEndpoints({ endpoints: [{ id: "ep-a", current_state: "idle", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25 }, { nope: 1 }] });
  assert.deepEqual([endpoint.id, endpoint.state, endpoint.minCu], ["ep-a", "idle", 0.25]);
  assert.equal(parseNeonEndpoints(null).length, 0);
  assert.deepEqual(parseProjectIds(" a-1, b-2 ,a-1,, bad id ,"), ["a-1", "b-2"]);
  assert.equal(endpointIdOfHost("ep-icy-123-pooler.c-6.us-east-2.aws.neon.tech"), "ep-icy-123");
  assert.equal(endpointIdOfHost("localhost"), null);
});

test("quotas: unavailable without Neon, storage named by its source, compute in CU-hours", () => {
  const without = quotaViews({ limits: NEON_FREE_LIMITS, project: null, neonMissing: "Unavailable: not connected.", databaseBytes: 12 * 1024 * 1024, history: [], now });
  assert.equal(without.compute.used, null);
  assert.equal(without.compute.level, null);
  assert.equal(without.compute.source, "unavailable");
  assert.equal(without.transfer.used, null);
  assert.equal(without.storage.source, "database");
  assert.equal(without.storage.used, 12 * 1024 * 1024);
  assert.equal(without.storage.level, "ok");

  const project = parseNeonProject("p-1", {
    project: {
      compute_time_seconds: 90 * 3600,
      data_transfer_bytes: 1024 ** 3,
      synthetic_storage_size: 0,
      consumption_period_start: new Date(now - 15 * DAY).toISOString(),
      consumption_period_end: new Date(now + 15 * DAY).toISOString(),
    },
  })!;
  const views = quotaViews({ limits: NEON_FREE_LIMITS, project, neonMissing: "", databaseBytes: 900 * 1024 * 1024, history: [], now });
  assert.equal(views.compute.used, 90);
  assert.equal(views.compute.remaining, 10);
  // 90 of 100 CU-hours: past high (85%), not yet critical (95%).
  assert.equal(views.compute.level, "high");
  assert.equal(views.compute.forecast.enough && views.compute.forecast.daysToLimit, 1);
  assert.equal(views.transfer.level, "ok");
  // Without Neon's branch sizes, storage is the database's own size, named as such.
  assert.equal(views.storage.source, "database");
  assert.equal(views.storage.level, "high");
  // With them, storage is Neon's total across the branches.
  const sized = quotaViews({ limits: NEON_FREE_LIMITS, project: { ...project, storageBytes: 300 * 1024 * 1024, branchCount: 2 }, neonMissing: "", databaseBytes: 900 * 1024 * 1024, history: [], now });
  assert.equal(sized.storage.source, "neon");
  assert.equal(sized.storage.used, 300 * 1024 * 1024);
  assert.equal(sized.storage.level, "ok");
  assert.match(sized.storage.sourceNote, /2 branches/);
  assert.match(sized.compute.sourceNote, /invoice is the official figure/);

  // A project created 9 days ago, in a period that began 27 days ago, has counted for 9 days only.
  const young = parseNeonProject("p-2", {
    project: {
      created_at: new Date(now - 9 * DAY).toISOString(),
      compute_time_seconds: 16.69 * 3600,
      consumption_period_start: new Date(now - 27 * DAY).toISOString(),
      consumption_period_end: new Date(now + 4 * DAY).toISOString(),
    },
  })!;
  const youngForecast = quotaViews({ limits: NEON_FREE_LIMITS, project: young, neonMissing: "", databaseBytes: null, history: [], now }).compute.forecast;
  assert.ok(youngForecast.enough);
  assert.ok(Math.abs(youngForecast.perDay - 16.69 / 9) < 0.001);
  assert.ok(Math.abs(youngForecast.projectedAtPeriodEnd! - (16.69 + (16.69 / 9) * 4)) < 0.001);
  assert.equal(youngForecast.limitDate, null);
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 ** 3), "1.00 GB");
});
