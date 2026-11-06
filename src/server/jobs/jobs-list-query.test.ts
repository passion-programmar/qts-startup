import assert from "node:assert/strict";
import test from "node:test";
import {
  dateRange,
  defaultJobsQuery,
  jobsFilterParams,
  jobsHref,
  likePattern,
  parseJobsQuery,
  tabCounts,
} from "./jobs-list-query";

const candidate = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

test("an empty or unknown address is the default view", () => {
  assert.deepEqual(parseJobsQuery({}), defaultJobsQuery);
  assert.deepEqual(
    parseJobsQuery({ tab: "nope", candidate: "x", date: "2026-02-30", field: "salary", page: "-3", size: "7" }),
    defaultJobsQuery,
  );
});

test("known values are read from the address", () => {
  assert.deepEqual(
    parseJobsQuery({ tab: "needs_action", candidate: candidate.toUpperCase(), date: "2026-11-01", field: "company", q: " Acme ", page: "3", size: "50" }),
    { tab: "needs_action", candidate, date: "2026-11-01", field: "company", q: "Acme", page: 3, size: 50 },
  );
  assert.equal(parseJobsQuery({ date: ["week", "today"] }).date, "week");
});

test("links leave out defaults and go back to page 1 unless the page is what changed", () => {
  const query = { ...defaultJobsQuery, tab: "failed" as const, page: 4 };
  assert.equal(jobsHref(defaultJobsQuery), "/jobs");
  assert.equal(jobsHref(query, { page: 5 }), "/jobs?tab=failed&page=5");
  assert.equal(jobsHref(query, { candidate }), `/jobs?tab=failed&candidate=${candidate}`);
  assert.equal(jobsHref({ ...query, field: "url" }, { tab: "all" }), "/jobs");
  assert.equal(jobsHref({ ...query, field: "url", q: "lever" }, { tab: "all" }), "/jobs?field=url&q=lever");
});

test("filter params keep only the tab and filters", () => {
  assert.deepEqual(jobsFilterParams({ ...defaultJobsQuery, tab: "ready", q: "x", page: 2 }), { tab: "ready" });
  assert.deepEqual(jobsFilterParams(defaultJobsQuery), {});
});

test("date filters cover the right days, across month ends", () => {
  assert.deepEqual(dateRange("today", "2026-11-05"), { from: "2026-11-05", to: "2026-11-05" });
  assert.deepEqual(dateRange("yesterday", "2026-03-01"), { from: "2026-02-28", to: "2026-02-28" });
  assert.deepEqual(dateRange("week", "2026-11-03"), { from: "2026-10-28", to: "2026-11-03" });
  assert.deepEqual(dateRange("2026-10-31", "2026-11-05"), { from: "2026-10-31", to: "2026-10-31" });
  assert.equal(dateRange("all", "2026-11-05"), null);
  assert.equal(dateRange("2026-13-01", "2026-11-05"), null);
});

test("tab counts add up their stages", () => {
  const counts = tabCounts({ answer: 2, failed: 3, ready: 5, generating: 1 });
  assert.equal(counts.all, 11);
  assert.equal(counts.needs_action, 5);
  assert.equal(counts.failed, 3);
  assert.equal(counts.applying, 0);
  assert.equal(counts.not_started, 0);
});

test("search words are matched as typed", () => {
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
});
