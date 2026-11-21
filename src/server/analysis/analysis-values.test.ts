import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisHref, axisTicks, changeVsPrevious, parseAnalysisView, periodLabels, previousLabel, seriesSummary, weekSpan, windowStartOffset } from "./analysis-values";

const jp = { zone: "jp" } as const;

test("the Overview opens on this week in Japan time; unknown values fall back to it", () => {
  assert.deepEqual(parseAnalysisView({}), { range: "week", weeksBack: 0, zone: "cet" });
  assert.deepEqual(parseAnalysisView({ range: "quarter", tz: "utc" }), { range: "week", weeksBack: 0, zone: "cet" });
  assert.deepEqual(parseAnalysisView({ range: ["month"], tz: "jp" }), { range: "month", weeksBack: 0, zone: "jp" });
  assert.deepEqual(parseAnalysisView({ range: "year", back: "3", tz: "ro" }), { range: "year", weeksBack: 0, zone: "cet" });
  assert.deepEqual(parseAnalysisView({ back: "2" }), { range: "week", weeksBack: 2, zone: "cet" });
  assert.deepEqual(parseAnalysisView({ back: "-4" }), { range: "week", weeksBack: 0, zone: "cet" });
  assert.deepEqual(parseAnalysisView({ back: "99999" }), { range: "week", weeksBack: 520, zone: "cet" });
});

test("addresses and window starts for each view", () => {
  assert.equal(analysisHref({ range: "week", weeksBack: 0, ...jp }), "/?tz=jp");
  assert.equal(analysisHref({ range: "week", weeksBack: 2, ...jp }), "/?back=2&tz=jp");
  assert.equal(analysisHref({ range: "week", weeksBack: 2, zone: "cet" }), "/?back=2");
  assert.equal(analysisHref({ range: "month", weeksBack: 0, ...jp }), "/?range=month&tz=jp");
  assert.equal(analysisHref({ range: "year", weeksBack: 0, ...jp }), "/?range=year&tz=jp");
  assert.equal(windowStartOffset({ range: "week", weeksBack: 0, ...jp }), "0 weeks");
  assert.equal(windowStartOffset({ range: "week", weeksBack: 3, ...jp }), "3 weeks");
  assert.equal(windowStartOffset({ range: "month", weeksBack: 0, ...jp }), "11 months");
  assert.equal(windowStartOffset({ range: "year", weeksBack: 0, ...jp }), "4 years");
});

test("period labels for each range", () => {
  assert.deepEqual(periodLabels("2026-11-09", "week"), { short: "Mon 9", full: "Monday, Nov 9, 2026" });
  assert.deepEqual(periodLabels("2026-11-15", "week"), { short: "Sun 15", full: "Sunday, Nov 15, 2026" });
  assert.deepEqual(periodLabels("2026-04-01", "month"), { short: "Apr 26", full: "April 2026" });
  assert.deepEqual(periodLabels("2025-01-01", "year"), { short: "2025", full: "2025" });
});

test("a week's span from its Monday", () => {
  assert.equal(weekSpan("2026-11-09"), "Nov 9 – Nov 15, 2026");
  assert.equal(weekSpan("2025-12-29"), "Dec 29 – Jan 4, 2026");
});

test("change against the previous period", () => {
  assert.equal(changeVsPrevious(0, 0), null);
  assert.deepEqual(changeVsPrevious(5, 0), { direction: "up", text: "from 0" });
  assert.deepEqual(changeVsPrevious(112, 100), { direction: "up", text: "12%" });
  assert.deepEqual(changeVsPrevious(46, 50), { direction: "down", text: "8%" });
  assert.deepEqual(changeVsPrevious(0, 20), { direction: "down", text: "100%" });
  assert.deepEqual(changeVsPrevious(7, 7), { direction: "same", text: "Same" });
});

test("what each view is compared with", () => {
  assert.equal(previousLabel({ range: "week", weeksBack: 0, ...jp }), "vs last week, same days");
  assert.equal(previousLabel({ range: "week", weeksBack: 2, ...jp }), "vs the week before");
  assert.equal(previousLabel({ range: "month", weeksBack: 0, ...jp }), "vs the 12 months before");
  assert.equal(previousLabel({ range: "year", weeksBack: 0, ...jp }), "vs the 5 years before");
});

test("summary of a series", () => {
  assert.deepEqual(seriesSummary([12, 32, 37, 23]), { total: 104, average: 26, max: 37 });
  assert.deepEqual(seriesSummary([1, 2]), { total: 3, average: 1.5, max: 2 });
  assert.deepEqual(seriesSummary([]), { total: 0, average: 0, max: 0 });
});

test("axis ticks are whole, clean steps that reach the maximum", () => {
  assert.deepEqual(axisTicks(37), [0, 10, 20, 30, 40]);
  assert.deepEqual(axisTicks(40), [0, 10, 20, 30, 40]);
  assert.deepEqual(axisTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(axisTicks(0), [0, 1]);
  assert.deepEqual(axisTicks(1800), [0, 500, 1000, 1500, 2000]);
});
