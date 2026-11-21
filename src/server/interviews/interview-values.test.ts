import assert from "node:assert/strict";
import { test } from "node:test";
import {
  joinInterviewer,
  markTodayRounds,
  nextInterviewStep,
  normalizeInterviewDate,
  normalizeInterviewTime,
  normalizeMeetingLink,
  parseInterviewSettings,
  splitInterviewer,
} from "./interview-values";
import { addDays, addMonths, startOfWeek, zonedDay, zonedMoment, zonedTime, zoneShortName } from "./zone-time";

test("next step runs Intro → Tech → Final → Offer, then stops", () => {
  assert.equal(nextInterviewStep("intro"), "tech");
  assert.equal(nextInterviewStep("tech"), "final");
  assert.equal(nextInterviewStep("final"), "offer");
  assert.equal(nextInterviewStep("offer"), null);
});

test("times are 24-hour HH:MM", () => {
  assert.equal(normalizeInterviewTime("9:05"), "09:05");
  assert.equal(normalizeInterviewTime(" 15:00 "), "15:00");
  assert.equal(normalizeInterviewTime("24:00"), "");
  assert.equal(normalizeInterviewTime("12:60"), "");
  assert.equal(normalizeInterviewTime("3pm"), "");
});

test("dates must be real calendar days", () => {
  assert.equal(normalizeInterviewDate("2026-11-18"), "2026-11-18");
  assert.equal(normalizeInterviewDate("2026-02-30"), "");
  assert.equal(normalizeInterviewDate("18/11/2026"), "");
});

test("meeting links: empty is none, web addresses only", () => {
  assert.equal(normalizeMeetingLink(""), "");
  assert.equal(normalizeMeetingLink("https://zoom.us/j/123"), "https://zoom.us/j/123");
  assert.equal(normalizeMeetingLink("javascript:alert(1)"), null);
  assert.equal(normalizeMeetingLink("zoom meeting"), null);
});

test("today's rounds: done when their end has come, first not done is next", () => {
  const rows = [
    { endsAt: "2026-11-15T07:30:00Z" },
    { endsAt: "2026-11-15T13:30:00Z" },
    { endsAt: "2026-11-15T16:00:00Z" },
  ];
  const marked = markTodayRounds(rows, new Date("2026-11-15T13:00:00Z"));
  assert.deepEqual(marked.map((row) => [row.done, row.next]), [[true, false], [false, true], [false, false]]);
  assert.equal(markTodayRounds(rows, new Date("2026-11-15T13:30:00Z"))[1]?.done, true);
  assert.ok(markTodayRounds(rows, new Date("2026-11-15T20:00:00Z")).every((row) => row.done && !row.next));
});

test("interviewers: several choices in one line, each with an optional name", () => {
  assert.equal(joinInterviewer(["Team Member", "Recruiter"], {}), "Recruiter, Team Member");
  assert.equal(joinInterviewer(["Recruiter", "Client", "Team Member"], { Recruiter: " Anna ", "Team Member": "Bob, Eve" }), "Recruiter (Anna), Client, Team Member (Bob, Eve)");
  assert.equal(joinInterviewer(["Client", "Other"], { Other: " John Smith " }), "Client, John Smith");
  assert.equal(joinInterviewer(["Other"], {}), "Other");
  assert.equal(joinInterviewer(["Recruiter"], { Recruiter: "Anna (HR)" }), "Recruiter (Anna HR)");
  assert.equal(joinInterviewer([], { Recruiter: "ignored" }), "");
  assert.deepEqual(splitInterviewer("Recruiter (Anna), Client, Team Member (Bob, Eve)"), { kinds: ["Recruiter", "Client", "Team Member"], names: { Recruiter: "Anna", "Team Member": "Bob, Eve" } });
  // Lines saved before names: kinds alone, and Other's name in its place.
  assert.deepEqual(splitInterviewer("Recruiter, Team Member"), { kinds: ["Recruiter", "Team Member"], names: {} });
  assert.deepEqual(splitInterviewer("Client, John Smith"), { kinds: ["Client", "Other"], names: { Other: "John Smith" } });
  assert.deepEqual(splitInterviewer("Other"), { kinds: ["Other"], names: {} });
  assert.deepEqual(splitInterviewer("Anna (HR)"), { kinds: ["Other"], names: { Other: "Anna (HR)" } });
  assert.deepEqual(splitInterviewer(null), { kinds: [], names: {} });
  const line = "Recruiter (Anna), Team Member (Bob, Eve), Jane Doe";
  const { kinds, names } = splitInterviewer(line);
  assert.equal(joinInterviewer(kinds, names), line);
});

test("settings: unknown values fall back to CET, no second zone, 60 minutes", () => {
  assert.deepEqual(parseInterviewSettings(null), { timeZone: "Europe/Berlin", secondTimeZone: null, defaultMinutes: 60 });
  assert.deepEqual(parseInterviewSettings({ timeZone: "Mars/Base", secondTimeZone: "UTC", defaultMinutes: 7 }), { timeZone: "Europe/Berlin", secondTimeZone: "UTC", defaultMinutes: 60 });
  assert.deepEqual(parseInterviewSettings({ timeZone: "Europe/Berlin", secondTimeZone: "Europe/Berlin", defaultMinutes: 45 }), { timeZone: "Europe/Berlin", secondTimeZone: null, defaultMinutes: 45 });
});

test("settings: the main zone is always CET, even when another one was saved earlier", () => {
  assert.deepEqual(parseInterviewSettings({ timeZone: "Asia/Tokyo", secondTimeZone: "Europe/Bucharest", defaultMinutes: 30 }), { timeZone: "Europe/Berlin", secondTimeZone: "Europe/Bucharest", defaultMinutes: 30 });
});

test("zone wall clock ↔ moment, summer time included", () => {
  // 15 Nov: Romania is UTC+2, Central Europe UTC+1, New York UTC−5.
  assert.equal(zonedMoment("2026-11-16", "12:00", "Europe/Bucharest").toISOString(), "2026-11-16T10:00:00.000Z");
  assert.equal(zonedMoment("2026-11-16", "12:00", "Europe/Berlin").toISOString(), "2026-11-16T11:00:00.000Z");
  assert.equal(zonedMoment("2026-11-16", "12:00", "UTC").toISOString(), "2026-11-16T12:00:00.000Z");
  assert.equal(zonedMoment("2026-11-16", "12:00", "America/New_York").toISOString(), "2026-11-16T17:00:00.000Z");
  // July: Romania UTC+3.
  assert.equal(zonedMoment("2026-07-01", "09:30", "Europe/Bucharest").toISOString(), "2026-07-01T06:30:00.000Z");
  const moment = new Date("2026-11-15T23:30:00Z");
  assert.equal(zonedDay(moment, "Europe/Bucharest"), "2026-11-16");
  assert.equal(zonedTime(moment, "Europe/Bucharest"), "01:30");
  assert.equal(zonedDay(moment, "America/Los_Angeles"), "2026-11-15");
});

test("calendar day sums", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(startOfWeek("2026-11-18"), "2026-11-15");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
});

test("a track: latest round per step (repeats counted) and the latest round overall", async () => {
  const { summarizeTrack } = await import("./interview-record");
  const round = (id: string, step: "intro" | "tech" | "final" | "offer", result: "waiting" | "passed" | "rejected", startsAt: string) => ({
    id, trackId: "t", bidId: null, candidateId: "c", candidateName: "A", category: null, appliedAt: startsAt, company: "X", jobTitle: "Y", jobUrl: "https://x",
    interviewer: null, step, result, startsAt, endsAt: startsAt, meetingLink: null, comment: null, callerId: null, callerName: null, callerLabel: null,
  });
  const { byStep, latest } = summarizeTrack([
    round("1", "intro", "passed", "2026-11-01T10:00:00.000Z"),
    round("2", "tech", "rejected", "2026-11-05T10:00:00.000Z"),
    round("3", "tech", "waiting", "2026-11-09T10:00:00.000Z"),
  ]);
  assert.equal(byStep.intro?.id, "1");
  assert.equal(byStep.tech?.id, "3");
  assert.equal(byStep.tech?.count, 2);
  assert.equal(byStep.final, undefined);
  assert.equal(latest?.id, "3");
});

test("time lists like Google Calendar: starts every 15 min, ends with their length", async () => {
  const { addMinutesToTime, endTimeOptions, lengthLabel, startTimeOptions } = await import("./interview-values");
  const starts = startTimeOptions();
  assert.equal(starts.length, 96);
  assert.deepEqual([starts[0]?.value, starts[36]?.value, starts.at(-1)?.value], ["00:00", "09:00", "23:45"]);
  const ends = endTimeOptions("14:00");
  assert.deepEqual(ends.slice(0, 4).map((option) => option.label), ["2:15 PM (15 mins)", "2:30 PM (30 mins)", "2:45 PM (45 mins)", "3:00 PM (1 hr)"]);
  assert.equal(ends.find((option) => option.value === "21:30")?.label, "9:30 PM (7.5 hrs)");
  assert.equal(ends.at(-1)?.value, "23:45");
  assert.equal(endTimeOptions("14:10")[0]?.label, "2:25 PM (15 mins)");
  assert.equal(endTimeOptions("").length, 96);
  assert.equal(lengthLabel(75), "1.25 hrs");
  assert.equal(lengthLabel(120), "2 hrs");
  assert.equal(addMinutesToTime("23:30", 60), "23:59");
});

test("typed times are read loosely; the end keeps the length when the start moves", async () => {
  const { endAfterStartChange, parseTypedTime } = await import("./interview-values");
  assert.equal(parseTypedTime("9"), "09:00");
  assert.equal(parseTypedTime("930"), "09:30");
  assert.equal(parseTypedTime("1430"), "14:30");
  assert.equal(parseTypedTime("9.30"), "09:30");
  assert.equal(parseTypedTime("14:10"), "14:10");
  assert.equal(parseTypedTime("25"), "");
  assert.equal(parseTypedTime("abc"), "");
  assert.equal(endAfterStartChange("", "", "14:00", 60), "15:00");
  assert.equal(endAfterStartChange("14:00", "15:30", "16:00", 60), "17:30");
  assert.equal(endAfterStartChange("14:00", "13:00", "16:00", 45), "16:45");
});

test("zone short names: CET/CEST, JST, EET, US names from the browser", () => {
  const winter = new Date("2026-11-16T10:00:00Z");
  const summer = new Date("2026-07-01T10:00:00Z");
  assert.equal(zoneShortName("Europe/Berlin", winter), "CET");
  assert.equal(zoneShortName("Europe/Berlin", summer), "CEST");
  assert.equal(zoneShortName("Europe/Bucharest", winter), "EET");
  assert.equal(zoneShortName("Asia/Tokyo", winter), "JST");
  assert.equal(zoneShortName("Australia/Sydney", winter), "AEDT");
  assert.equal(zoneShortName("Australia/Sydney", summer), "AEST");
  assert.equal(zoneShortName("America/New_York", winter), "EST");
});

test("countdown: fills over the last day, colours by how close, live progress, then done", async () => {
  const { interviewCountdown } = await import("./interview-values");
  const start = "2026-11-16T14:00:00.000Z";
  const end = "2026-11-16T15:00:00.000Z";
  const at = (iso: string) => interviewCountdown(start, end, new Date(iso).getTime());
  assert.deepEqual(at("2026-11-15T10:00:00Z"), { phase: "later", fill: 0, text: "in 1 day 4 h" });
  assert.deepEqual(at("2026-11-14T14:00:00Z"), { phase: "later", fill: 0, text: "in 2 days" });
  assert.deepEqual(at("2026-11-16T10:30:00Z"), { phase: "day", fill: 1 - 3.5 / 24, text: "in 3 h 30 min" });
  assert.deepEqual(at("2026-11-16T12:00:00Z"), { phase: "day", fill: 1 - 2 / 24, text: "in 2 h" });
  assert.equal(at("2026-11-16T13:30:00Z").phase, "hour");
  assert.deepEqual(at("2026-11-16T13:48:00Z"), { phase: "soon", fill: 1 - 12 / (24 * 60), text: "in 12 min" });
  assert.equal(at("2026-11-16T13:59:30Z").text, "in 1 min");
  assert.deepEqual(at("2026-11-16T14:25:00Z"), { phase: "live", fill: 25 / 60, text: "Live · 25 of 60 min" });
  assert.deepEqual(at("2026-11-16T15:00:00Z"), { phase: "done", fill: 1, text: "Done" });
});

test("AM / PM: shown in 12-hour, typed either way, stored as 24-hour", async () => {
  const { parseTypedTime, startTimeOptions } = await import("./interview-values");
  const { to12h, timeRange } = await import("./zone-time");
  assert.deepEqual([to12h("00:00"), to12h("09:05"), to12h("12:00"), to12h("13:15"), to12h("23:45")], ["12:00 AM", "9:05 AM", "12:00 PM", "1:15 PM", "11:45 PM"]);
  assert.equal(startTimeOptions()[52]?.label, "1:00 PM");
  assert.equal(startTimeOptions()[52]?.value, "13:00");
  assert.equal(parseTypedTime("2pm"), "14:00");
  assert.equal(parseTypedTime("2:30 PM"), "14:30");
  assert.equal(parseTypedTime("230p"), "14:30");
  assert.equal(parseTypedTime("12am"), "00:00");
  assert.equal(parseTypedTime("12 PM"), "12:00");
  assert.equal(parseTypedTime("9:15 a.m."), "09:15");
  assert.equal(parseTypedTime("13pm"), "");
  assert.equal(timeRange({ startsAt: "2026-11-23T11:45:00Z", endsAt: "2026-11-23T12:15:00Z" }, "Europe/Berlin"), "12:45 PM–1:15 PM");
});

test("same company: case, spaces, punctuation and a company-form word at the end do not matter", async () => {
  const { companyKey } = await import("./interview-values");
  assert.equal(companyKey("Silent Eight, Inc."), "silenteight");
  assert.equal(companyKey("silent eight"), "silenteight");
  assert.equal(companyKey("Silent-Eight Ltd"), "silenteight");
  assert.equal(companyKey("Autodesk GmbH"), "autodesk");
  assert.equal(companyKey("Zinc"), "zinc");
  assert.equal(companyKey("Visa"), "visa");
});
