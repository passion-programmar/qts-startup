import assert from "node:assert/strict";
import test from "node:test";
import { formatRomaniaTime, romaniaClock } from "@/lib/romania-time";

test("Romania time follows summer and winter time", () => {
  // 14:30 UTC is 17:30 in Romania in summer (UTC+3) and 16:30 in winter (UTC+2).
  assert.deepEqual(romaniaClock(new Date("2026-07-01T14:30:00Z")), { day: "2026-07-01", hour: 17 });
  assert.deepEqual(romaniaClock(new Date("2026-12-01T14:30:00Z")), { day: "2026-12-01", hour: 16 });
  // Late evening UTC is already the next day in Romania.
  assert.equal(romaniaClock(new Date("2026-12-01T22:30:00Z")).day, "2026-12-02");
  assert.equal(formatRomaniaTime("2026-10-27T15:43:00Z"), "27 Oct 2026, 17:43");
});
