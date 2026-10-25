import assert from "node:assert/strict";
import test from "node:test";
import {
  getJobBusinessDate,
  normalizeJobUrl,
} from "@/server/jobs/job-values";

test("job URLs use one fragment-free trailing-slash identity", () => {
  assert.equal(
    normalizeJobUrl("https://Example.com/jobs/123/#apply"),
    "https://example.com/jobs/123",
  );
  assert.equal(
    normalizeJobUrl("https://example.com/"),
    "https://example.com",
  );
});

test("job business dates change at Pacific midnight", () => {
  assert.equal(
    getJobBusinessDate(new Date("2026-01-01T07:59:59.000Z")),
    "2025-12-31",
  );
  assert.equal(
    getJobBusinessDate(new Date("2026-01-01T08:00:00.000Z")),
    "2026-01-01",
  );
});

test("job business dates follow the chosen time zone", () => {
  // 2026-01-01T15:00Z is midnight in Tokyo and 17:00 in Bucharest.
  assert.equal(getJobBusinessDate(new Date("2026-01-01T14:59:59.000Z"), "Asia/Tokyo"), "2026-01-01");
  assert.equal(getJobBusinessDate(new Date("2026-01-01T15:00:00.000Z"), "Asia/Tokyo"), "2026-01-02");
  assert.equal(getJobBusinessDate(new Date("2026-01-01T22:00:00.000Z"), "Europe/Bucharest"), "2026-01-02");
});
