// The Overview's time ranges and period labels. No server imports, so the page, the charts and the
// tests share them.

// Week: one week, Monday to Sunday, day by day (this week first; ?back=N goes N weeks earlier).
// Month and Year: the last 12 months or 5 years, the current one included.
export const analysisRanges = {
  week: { label: "Week", anchor: "week", bucket: "day", step: "1 day", count: 7 },
  month: { label: "Month", anchor: "month", bucket: "month", step: "1 month", count: 12 },
  year: { label: "Year", anchor: "year", bucket: "year", step: "1 year", count: 5 },
} as const;
export type AnalysisRange = keyof typeof analysisRanges;

// The time zones days, weeks and "today" are counted in. Japan unless another is chosen (?tz=).
// CET follows Central European summer time too (CEST), as Berlin does.
export const analysisZones = {
  jp: { label: "Japan", zone: "Asia/Tokyo" },
  cet: { label: "CET", zone: "Europe/Berlin" },
  ro: { label: "Romania", zone: "Europe/Bucharest" },
} as const;
export type AnalysisZone = keyof typeof analysisZones;
export const defaultAnalysisZone: AnalysisZone = "jp";

export type AnalysisView = { range: AnalysisRange; weeksBack: number; zone: AnalysisZone };

const maxWeeksBack = 520;

/** Reads ?range=, ?back= and ?tz= from the address; this week in Japan time unless asked otherwise. */
export function parseAnalysisView(raw: Record<string, string | string[] | undefined>): AnalysisView {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const rangeValue = first(raw.range);
  const range: AnalysisRange = rangeValue === "month" || rangeValue === "year" ? rangeValue : "week";
  const back = Number.parseInt(first(raw.back), 10);
  const zoneValue = first(raw.tz);
  const zone: AnalysisZone = zoneValue === "cet" || zoneValue === "ro" ? zoneValue : defaultAnalysisZone;
  return { range, weeksBack: range === "week" && Number.isFinite(back) && back > 0 ? Math.min(back, maxWeeksBack) : 0, zone };
}

/** How far before the current week, month or year the window starts, as a Postgres interval. */
export function windowStartOffset(view: AnalysisView): string {
  if (view.range === "week") return `${view.weeksBack} weeks`;
  const { bucket, count } = analysisRanges[view.range];
  return `${count - 1} ${bucket}s`;
}

/** The Overview address for a view: this week in Japan time is plain "/". */
export function analysisHref(view: AnalysisView): string {
  const params = new URLSearchParams();
  if (view.range !== "week") params.set("range", view.range);
  else if (view.weeksBack > 0) params.set("back", String(view.weeksBack));
  if (view.zone !== defaultAnalysisZone) params.set("tz", view.zone);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A period's start ("2026-11-09") as the axis label ("Mon 9", "Apr 26", "2026") and the full name
 * the tooltip and table use ("Monday, Nov 9, 2026", "April 2026", "2026").
 */
export function periodLabels(start: string, range: AnalysisRange): { short: string; full: string } {
  const year = start.slice(0, 4);
  const month = Number(start.slice(5, 7)) - 1;
  if (range === "year") return { short: year, full: year };
  if (range === "week") {
    const date = new Date(`${start}T00:00:00Z`);
    const dayName = dayNames[date.getUTCDay()];
    return { short: `${dayName.slice(0, 3)} ${date.getUTCDate()}`, full: `${dayName}, ${monthNames[month]} ${date.getUTCDate()}, ${year}` };
  }
  return { short: `${monthNames[month]} ${year.slice(2)}`, full: `${longMonthNames[month]} ${year}` };
}

/** A week from its Monday ("2026-11-09"): "Nov 9 – Nov 15, 2026". */
export function weekSpan(monday: string): string {
  const first = new Date(`${monday}T00:00:00Z`);
  const last = new Date(first.getTime() + 6 * 86_400_000);
  const day = (date: Date) => `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return `${day(first)} – ${day(last)}, ${last.getUTCFullYear()}`;
}

// Bids each Manager aims for per day (a day in the chosen zone), shown as today's progress on the Overview.
export const DAILY_BID_TARGET = 500;

export type Change = { direction: "up" | "down" | "same"; text: string } | null;

/** A total against the one before it: "▲ 12%", "▼ 8%", "Same", "▲ from 0"; null when both are 0. */
export function changeVsPrevious(current: number, previous: number): Change {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return { direction: "up", text: "from 0" };
  if (current === previous) return { direction: "same", text: "Same" };
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  return { direction: current > previous ? "up" : "down", text: `${percent}%` };
}


/** What the comparison is against, e.g. "vs last week, same point" or "vs the 12 months before". */
export function previousLabel(view: AnalysisView): string {
  if (view.range === "week") return view.weeksBack === 0 ? "vs last week, same days" : "vs the week before";
  const { bucket, count } = analysisRanges[view.range];
  return `vs the ${count} ${bucket}s before`;
}

/** Total, average per period (one decimal) and the busiest period of a series. */
export function seriesSummary(values: number[]): { total: number; average: number; max: number } {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    total,
    average: values.length ? Math.round((total / values.length) * 10) / 10 : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

/** Clean y-axis ticks from 0 to at least `max`: steps of 1, 2, 2.5 or 5 times a power of ten. */
export function axisTicks(max: number, wanted = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / wanted;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough && Number.isInteger(candidate)) ?? Math.max(1, Math.ceil(rough));
  const ticks: number[] = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}
