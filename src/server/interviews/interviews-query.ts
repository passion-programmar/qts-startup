import { isInterviewStep, normalizeInterviewDate, type InterviewStep } from "./interview-values";

// The Interviews page address: the calendar mode (Day, Week, Month or the List table) and the day
// it shows, and for the List its rounds, search and page. No server imports, so links are built
// with it in the browser too.

export const calendarModes = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "list", label: "List" },
  { key: "jobs", label: "By job" },
] as const;
export type CalendarMode = (typeof calendarModes)[number]["key"];

export const interviewViews = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "all", label: "All" },
] as const;
export type InterviewView = (typeof interviewViews)[number]["key"];

// By job: where each job's track stands, from its latest round.
export const trackStatuses = [
  { key: "all", label: "All" },
  { key: "active", label: "In progress" },
  { key: "offer", label: "Offer" },
  { key: "ended", label: "Ended" },
] as const;
export type TrackStatus = (typeof trackStatuses)[number]["key"];
export const trackSearchFields = [
  { key: "account", label: "Account" },
  { key: "company", label: "Company" },
] as const;

export const interviewSearchFields = [
  { key: "account", label: "Account" },
  { key: "company", label: "Company" },
  { key: "interviewer", label: "Interviewer" },
  { key: "comment", label: "Comment" },
] as const;
export type InterviewSearchField = "all" | (typeof interviewSearchFields)[number]["key"];

const pageSizes = [10, 25, 50];
export const defaultInterviewPageSize = 25;

export type InterviewsQuery = {
  mode: CalendarMode;
  // The day the calendar shows (in the Manager's zone); "" is today.
  date: string;
  view: InterviewView;
  // By job: which tracks.
  status: TrackStatus;
  step: "all" | InterviewStep;
  candidate: string;
  field: InterviewSearchField;
  q: string;
  page: number;
  size: number;
  // A bid to open the Add window with (from the Bids page's "+ Interview").
  add: string;
};

export const defaultInterviewsQuery: InterviewsQuery = {
  mode: "week",
  date: "",
  view: "upcoming",
  status: "all",
  step: "all",
  candidate: "all",
  field: "all",
  q: "",
  page: 1,
  size: defaultInterviewPageSize,
  add: "",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Reads the page address; anything unknown falls back to the default. */
export function parseInterviewsQuery(raw: Record<string, string | string[] | undefined>): InterviewsQuery {
  const mode = first(raw.mode);
  const view = first(raw.view);
  const status = first(raw.status);
  const step = first(raw.step);
  const candidate = first(raw.candidate);
  const field = first(raw.field);
  const page = Number.parseInt(first(raw.page), 10);
  const size = Number.parseInt(first(raw.size), 10);
  const add = first(raw.add);
  return {
    mode: calendarModes.some((entry) => entry.key === mode) ? mode as CalendarMode : "week",
    date: normalizeInterviewDate(first(raw.date)),
    view: interviewViews.some((entry) => entry.key === view) ? view as InterviewView : "upcoming",
    status: trackStatuses.some((entry) => entry.key === status) ? status as TrackStatus : "all",
    step: isInterviewStep(step) ? step : "all",
    candidate: uuidPattern.test(candidate) ? candidate : "all",
    field: interviewSearchFields.some((entry) => entry.key === field) ? field as InterviewSearchField : "all",
    q: first(raw.q).slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    size: pageSizes.includes(size) ? size : defaultInterviewPageSize,
    add: uuidPattern.test(add) ? add : "",
  };
}

/** The mode and filters as address values, without the defaults: the List keeps them when it pages or searches. */
export function interviewsFilterParams(query: InterviewsQuery): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of ["mode", "date", "view", "status", "step", "candidate"] as const) {
    if (query[key] !== defaultInterviewsQuery[key]) params[key] = query[key];
  }
  return params;
}

/** The page address with some values changed; a changed filter goes back to page 1. */
export function interviewsHref(query: InterviewsQuery, changes: Partial<InterviewsQuery> = {}): string {
  const next = { ...query, add: "", ...changes };
  if (!("page" in changes)) next.page = 1;
  const params = new URLSearchParams();
  for (const key of ["mode", "date", "view", "status", "step", "candidate", "field", "q", "page", "size", "add"] as const) {
    const value = String(next[key]);
    if (value && value !== String(defaultInterviewsQuery[key])) params.set(key, value);
  }
  if (!next.q) params.delete("field");
  const search = params.toString();
  return search ? `/interviews?${search}` : "/interviews";
}
