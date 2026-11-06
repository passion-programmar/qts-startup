// The Jobs page's tab, filters, search and page, read from and written to the page address.
// Plain values only: the page (server) and its filter bar (browser) both use this file.

/** Where a saved job stands, worked out on the server from the job and its latest application. */
export type JobStage = "answer" | "failed" | "applying" | "generating" | "ready" | "not_started";

export const jobTabs = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Needs action" },
  { key: "generating", label: "Generating" },
  { key: "applying", label: "Applying" },
  { key: "ready", label: "Ready to apply" },
  { key: "failed", label: "Failed" },
  { key: "not_started", label: "Not started" },
] as const;
export type JobTab = (typeof jobTabs)[number]["key"];

/** The stages each tab shows; "Needs action" is everything waiting for the Manager, failures included. */
export const tabStages: Record<JobTab, JobStage[] | null> = {
  all: null,
  needs_action: ["answer", "failed"],
  generating: ["generating"],
  applying: ["applying"],
  ready: ["ready"],
  failed: ["failed"],
  not_started: ["not_started"],
};

export const jobSearchFields = [
  { key: "name", label: "Name" },
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "url", label: "Job URL" },
  { key: "setup", label: "Prompt · Template" },
] as const;
export type JobSearchField = "all" | (typeof jobSearchFields)[number]["key"];

export const datePresets = [
  { key: "all", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
] as const;

export const jobPageSizes = [10, 25, 50] as const;
export const defaultJobPageSize = 25;
const defaultPageSize = defaultJobPageSize;

export type JobsQuery = {
  tab: JobTab;
  /** A candidate's id, or "all". */
  candidate: string;
  /** "all", "today", "yesterday", "week", or one day as YYYY-MM-DD. */
  date: string;
  field: JobSearchField;
  q: string;
  page: number;
  size: number;
};

export const defaultJobsQuery: JobsQuery = {
  tab: "all", candidate: "all", date: "all", field: "all", q: "", page: 1, size: defaultPageSize,
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Reads the page address; anything unknown falls back to the default. */
export function parseJobsQuery(raw: Record<string, string | string[] | undefined>): JobsQuery {
  const tab = first(raw.tab);
  const candidate = first(raw.candidate);
  const date = first(raw.date);
  const field = first(raw.field);
  const page = Number.parseInt(first(raw.page), 10);
  const size = Number.parseInt(first(raw.size), 10);
  return {
    tab: jobTabs.some((entry) => entry.key === tab) ? tab as JobTab : "all",
    candidate: uuidPattern.test(candidate) ? candidate.toLowerCase() : "all",
    date: datePresets.some((entry) => entry.key === date) || (dayPattern.test(date) && dateRange(date, date)) ? date : "all",
    field: jobSearchFields.some((entry) => entry.key === field) ? field as JobSearchField : "all",
    q: first(raw.q).slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    size: (jobPageSizes as readonly number[]).includes(size) ? size : defaultPageSize,
  };
}

/** The page address for a query with some values changed. Changing anything but the page goes back to page 1. */
export function jobsHref(query: JobsQuery, changes: Partial<JobsQuery> = {}): string {
  const next = { ...query, ...changes };
  if (!("page" in changes)) next.page = 1;
  const params = new URLSearchParams();
  for (const key of ["tab", "candidate", "date", "field", "q", "page", "size"] as const) {
    const value = String(next[key]);
    if (value && value !== String(defaultJobsQuery[key])) params.set(key, value);
  }
  // A search field means nothing without words to search for.
  if (!next.q) params.delete("field");
  const search = params.toString();
  return search ? `/jobs?${search}` : "/jobs";
}

/** The tab and filters as address values, without the defaults: the table keeps them when it pages or searches. */
export function jobsFilterParams(query: JobsQuery): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of ["tab", "candidate", "date"] as const) {
    if (query[key] !== defaultJobsQuery[key]) params[key] = query[key];
  }
  return params;
}

function shiftDay(day: string, days: number): string | null {
  const [year, month, date] = day.split("-").map(Number);
  const moment = new Date(Date.UTC(year, month - 1, date + days));
  if (Number.isNaN(moment.getTime())) return null;
  return moment.toISOString().slice(0, 10);
}

/** The first and last day (inclusive) a date filter keeps, against today in Romania time; null keeps every day. */
export function dateRange(date: string, today: string): { from: string; to: string } | null {
  if (date === "today") return { from: today, to: today };
  if (date === "yesterday") {
    const yesterday = shiftDay(today, -1);
    return yesterday ? { from: yesterday, to: yesterday } : null;
  }
  if (date === "week") {
    const from = shiftDay(today, -6);
    return from ? { from, to: today } : null;
  }
  if (dayPattern.test(date) && shiftDay(date, 0) === date) return { from: date, to: date };
  return null;
}

/** How many jobs each tab holds, from the count of each stage. */
export function tabCounts(stageCounts: Partial<Record<JobStage, number>>): Record<JobTab, number> {
  const counts = {} as Record<JobTab, number>;
  for (const { key } of jobTabs) {
    const stages = tabStages[key];
    counts[key] = stages
      ? stages.reduce((sum, stage) => sum + (stageCounts[stage] ?? 0), 0)
      : Object.values(stageCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  }
  return counts;
}

/** Escapes % _ and \ so words are matched as typed. */
export function likePattern(words: string): string {
  return `%${words.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
