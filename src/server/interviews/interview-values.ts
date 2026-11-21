import { CET_ZONE, isTimeZone } from "./zone-time";

// Interview steps and results, their labels and colours, and the form checks. No server imports, so
// the page, the window and the tests share them.

export const interviewSteps = [
  { key: "intro", label: "Intro" },
  { key: "tech", label: "Tech" },
  { key: "final", label: "Final" },
  { key: "offer", label: "Offer" },
] as const;
export type InterviewStep = (typeof interviewSteps)[number]["key"];

export const interviewResults = [
  { key: "waiting", label: "Waiting" },
  { key: "passed", label: "Passed" },
  { key: "rejected", label: "Rejected" },
  { key: "no_show", label: "No-show" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export type InterviewResult = (typeof interviewResults)[number]["key"];

// Who interviews: any of these, each with an optional name. Saved as one line, e.g.
// "Recruiter (Anna), Client, Team Member (Bob, Eve)"; Other's name is saved in its place
// ("Recruiter, John Smith"), or "Other" when none is typed.
export const interviewerKinds = ["Recruiter", "Client", "Team Member", "Other"] as const;
export type InterviewerNames = Partial<Record<string, string>>;

/** Splits on commas outside brackets: "Recruiter (Anna, Bob), Client" → two parts. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(depth - 1, 0);
    if (char === "," && depth === 0) { parts.push(current); current = ""; } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const kindPattern = /^(Recruiter|Client|Team Member|Other)(?:\s*\((.*)\))?$/;

/** A saved interviewer line as the ticked choices and each one's name. Unknown parts are Other's name. */
export function splitInterviewer(value: string | null): { kinds: string[]; names: InterviewerNames } {
  const found = new Set<string>();
  const names: InterviewerNames = {};
  const unknown: string[] = [];
  for (const part of splitTopLevel(value ?? "")) {
    const match = kindPattern.exec(part);
    if (!match?.[1]) { unknown.push(part); continue; }
    found.add(match[1]);
    if (match[2]?.trim()) names[match[1]] = match[2].trim();
  }
  if (unknown.length) {
    found.add("Other");
    names.Other = [names.Other, ...unknown].filter(Boolean).join(", ");
  }
  return { kinds: interviewerKinds.filter((kind) => found.has(kind)), names };
}

/** The ticked choices (in the fixed order) with their names, as one line. */
export function joinInterviewer(kinds: string[], names: InterviewerNames): string {
  return interviewerKinds
    .filter((kind) => kinds.includes(kind))
    .map((kind) => {
      // Brackets inside a name would break the line apart, so they become plain spaces.
      const name = (names[kind] ?? "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
      if (kind === "Other") return name || "Other";
      return name ? `${kind} (${name})` : kind;
    })
    .join(", ");
}

export const stepClasses: Record<InterviewStep, string> = {
  intro: "bg-slate-100 text-slate-700 ring-slate-200",
  tech: "bg-blue-50 text-blue-700 ring-blue-200",
  final: "bg-violet-50 text-violet-700 ring-violet-200",
  offer: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export const resultClasses: Record<InterviewResult, string> = {
  waiting: "bg-amber-50 text-amber-800 ring-amber-200",
  passed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  no_show: "bg-slate-100 text-slate-600 ring-slate-200",
  cancelled: "bg-orange-50 text-orange-800 ring-orange-200",
};

export function isInterviewStep(value: unknown): value is InterviewStep {
  return interviewSteps.some((step) => step.key === value);
}
export function isInterviewResult(value: unknown): value is InterviewResult {
  return interviewResults.some((result) => result.key === value);
}
export function stepLabel(step: string): string {
  return interviewSteps.find((entry) => entry.key === step)?.label ?? step;
}
export function resultLabel(result: string): string {
  return interviewResults.find((entry) => entry.key === result)?.label ?? result;
}

/** The round after this one (Intro → Tech → Final → Offer), or null after Offer. */
export function nextInterviewStep(step: InterviewStep): InterviewStep | null {
  const index = interviewSteps.findIndex((entry) => entry.key === step);
  return interviewSteps[index + 1]?.key ?? null;
}

/** "9:5" or "09:05" → "09:05"; anything that is not a 24-hour time → "". */
export function normalizeInterviewTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A real calendar date as YYYY-MM-DD, or "". */
// How close a round is, for its countdown bar. Before the start the bar fills over the last day;
// during the round it shows how far it has got.
export type CountdownPhase = "later" | "day" | "hour" | "soon" | "live" | "done";
const MINUTE = 60_000;
const COUNTDOWN_WINDOW = 24 * 60 * MINUTE;

/** "1 day 4 h", "3 h 30 min", "12 min" for some minutes. */
function spanText(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} h` : ""}`;
  if (hours) return `${hours} h${rest ? ` ${rest} min` : ""}`;
  return `${rest} min`;
}

export function interviewCountdown(startsAt: string, endsAt: string, now: number): { phase: CountdownPhase; fill: number; text: string } {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (now >= end) return { phase: "done", fill: 1, text: "Done" };
  if (now >= start) {
    const total = Math.max(Math.round((end - start) / MINUTE), 1);
    const elapsed = Math.min(Math.floor((now - start) / MINUTE), total);
    return { phase: "live", fill: elapsed / total, text: `Live · ${elapsed} of ${total} min` };
  }
  const remaining = start - now;
  const phase: CountdownPhase = remaining > COUNTDOWN_WINDOW ? "later" : remaining > 60 * MINUTE ? "day" : remaining > 15 * MINUTE ? "hour" : "soon";
  return { phase, fill: Math.min(Math.max(1 - remaining / COUNTDOWN_WINDOW, 0), 1), text: `in ${spanText(Math.ceil(remaining / MINUTE))}` };
}

/** A typed time, read loosely: "9" → 09:00, "930" / "9.30" / "9:30" → 09:30, "1430" → 14:30; "" when not a time. */
export function parseTypedTime(text: string): string {
  const trimmed = text.trim();
  if (/^\d{1,4}$/.test(trimmed)) {
    return trimmed.length <= 2
      ? normalizeInterviewTime(`${trimmed}:00`)
      : normalizeInterviewTime(`${trimmed.slice(0, -2)}:${trimmed.slice(-2)}`);
  }
  return normalizeInterviewTime(trimmed.replace(/[.hH]/, ":"));
}

const LAST_MINUTE = 23 * 60 + 59;

/** Minutes since midnight for "HH:MM", or null. */
export function timeToMinutes(time: string): number | null {
  const normal = normalizeInterviewTime(time);
  return normal ? Number(normal.slice(0, 2)) * 60 + Number(normal.slice(3)) : null;
}

function minutesToTime(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Some minutes after "HH:MM", kept within the day; "" when the time is not one. */
export function addMinutesToTime(time: string, minutes: number): string {
  const start = timeToMinutes(time);
  return start === null ? "" : minutesToTime(Math.min(Math.max(start + minutes, 0), LAST_MINUTE));
}

/** A length as Google Calendar writes it: "15 mins", "1 hr", "1.5 hrs", "1.25 hrs". */
export function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} mins`;
  if (minutes === 60) return "1 hr";
  return `${Number((minutes / 60).toFixed(2))} hrs`;
}

export type TimeOption = { value: string; label: string };

/** The start list: every 15 minutes of the day. */
export function startTimeOptions(): TimeOption[] {
  return Array.from({ length: 96 }, (_, index) => minutesToTime(index * 15)).map((value) => ({ value, label: value }));
}

/** The end list: every 15 minutes after the start, each with its length; the day's list without a start. */
export function endTimeOptions(start: string): TimeOption[] {
  const from = timeToMinutes(start);
  if (from === null) return startTimeOptions();
  const options: TimeOption[] = [];
  for (let total = from + 15; total <= LAST_MINUTE; total += 15) {
    const value = minutesToTime(total);
    options.push({ value, label: `${value} (${lengthLabel(total - from)})` });
  }
  return options;
}

/** When the start moves, the end moves with it and keeps the length; without one, the default length. */
export function endAfterStartChange(previousStart: string, previousEnd: string, nextStart: string, defaultMinutes: number): string {
  const before = timeToMinutes(previousStart);
  const end = timeToMinutes(previousEnd);
  const length = before !== null && end !== null && end > before ? end - before : defaultMinutes;
  return addMinutesToTime(nextStart, length);
}

export function normalizeInterviewDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
    ? value.trim()
    : "";
}

/** A meeting link must be a web address; empty means none. Returns null when it is not valid. */
export function normalizeMeetingLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Today's rounds in time order: a round is done when its end has come, so its Join button stays up
 * during the call, and the first round not done is next.
 */
export function markTodayRounds<T extends { endsAt: string }>(rows: T[], now: Date): (T & { done: boolean; next: boolean })[] {
  const done = rows.map((row) => new Date(row.endsAt).getTime() <= now.getTime());
  const nextIndex = done.indexOf(false);
  return rows.map((row, index) => ({ ...row, done: done[index] ?? false, next: index === nextIndex }));
}

// Each Manager's calendar settings: the zone times are shown and entered in, an optional second
// zone shown beside it (like Google Calendar), and how long a new interview is.
export const interviewLengths = [15, 30, 45, 60, 90, 120] as const;
export type InterviewSettings = { timeZone: string; secondTimeZone: string | null; defaultMinutes: number };
export const defaultInterviewSettings: InterviewSettings = { timeZone: CET_ZONE, secondTimeZone: null, defaultMinutes: 60 };
export const interviewSettingsKey = (managerId: string) => `interview-settings:${managerId}`;

/**
 * Saved settings, with anything missing or unknown set to the default. The main zone is always CET
 * for every Manager (a zone saved earlier is ignored); only the second zone can be chosen.
 */
export function parseInterviewSettings(value: unknown): InterviewSettings {
  const saved = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const minutes = Number(saved.defaultMinutes);
  return {
    timeZone: CET_ZONE,
    secondTimeZone: isTimeZone(saved.secondTimeZone) && saved.secondTimeZone !== CET_ZONE ? saved.secondTimeZone : null,
    defaultMinutes: (interviewLengths as readonly number[]).includes(minutes) ? minutes : defaultInterviewSettings.defaultMinutes,
  };
}

/** Results that close a round: no Join, no next step; the company may still offer a new date. */
export function isEndedResult(result: InterviewResult): boolean {
  return result === "rejected" || result === "no_show" || result === "cancelled";
}

// Each result's strong look for the calendar, hover card and details card: fixed colours (the dark
// theme cannot wash them out), a symbol so the colour is never the only clue, and a hint.
export const resultLook: Record<InterviewResult, { background: string; text: string; symbol: string; hint: string }> = {
  waiting: { background: "#f59e0b", text: "#1c1917", symbol: "⏳", hint: "Set the result after the call." },
  passed: { background: "#16a34a", text: "#ffffff", symbol: "✓", hint: "Add the next step when the company sets it." },
  rejected: { background: "#dc2626", text: "#ffffff", symbol: "✕", hint: "Company offered another date? Add a new date — this round stays in the history." },
  no_show: { background: "#475569", text: "#ffffff", symbol: "!", hint: "Company offered another date? Add a new date — this round stays in the history." },
  cancelled: { background: "#ea580c", text: "#ffffff", symbol: "⊘", hint: "Company offered another date? Add a new date — this round stays in the history." },
};
