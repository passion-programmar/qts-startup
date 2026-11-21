"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { interviews, settings, users } from "@/db/schema";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";
import { db } from "@/lib/db";
import { getCurrentUser, requireUser } from "@/lib/session";
import type { RecordActionState } from "@/app/record-action-state";
import { isManagersTrack, passEarlierRounds, readBidChoice, readBidTrack, readCallerCompanyClash, readCallerHistory, readTrack, searchBidChoices, type BidChoice, type CallerHistoryRow } from "@/server/interviews/interviews-list";
import { toInterviewRecord, type InterviewRecord } from "@/server/interviews/interview-record";
import { isManagersCaller } from "@/server/callers/callers";
import {
  isInterviewResult,
  isInterviewStep,
  normalizeInterviewDate,
  normalizeInterviewTime,
  normalizeMeetingLink,
  interviewSettingsKey,
  parseInterviewSettings,
  type InterviewResult,
} from "@/server/interviews/interview-values";
import { isTimeZone, zonedMoment } from "@/server/interviews/zone-time";

// Interview rounds are the Manager's own notes about applied jobs: added from a bid (its account,
// category and applied date are fixed; company, title and link can be changed) or by hand (everything
// can be changed). Bids themselves never change here.

function text(data: FormData, name: string, max: number): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isDuplicate(error: unknown): boolean {
  return error instanceof Error && /interviews_bid_step_starts_at_unique/.test(`${error.message} ${String(error.cause ?? "")}`);
}
function refresh() {
  revalidatePath("/interviews");
  revalidatePath("/bids");
}

/** Adds a round (no id) or saves changes to one (with id). */
export async function saveInterviewAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  const bidId = text(formData, "bidId", 36);
  const step = text(formData, "step", 20);
  const result = text(formData, "result", 20) || "waiting";
  // Date, start and end are entered in the zone picked in the window (the Manager's zone unless they
  // switched it, e.g. to Japan); the applied date is in the Manager's own zone.
  const timeZone = text(formData, "timeZone", 64);
  const appliedZone = text(formData, "appliedTimeZone", 64);
  const interviewDate = normalizeInterviewDate(text(formData, "interviewDate", 10));
  const interviewTime = normalizeInterviewTime(text(formData, "interviewTime", 5));
  const interviewEndTime = normalizeInterviewTime(text(formData, "interviewEndTime", 5));
  const meetingLink = normalizeMeetingLink(text(formData, "meetingLink", 2048));
  const interviewer = text(formData, "interviewer", 600);
  const comment = text(formData, "comment", 2000);
  if (!isInterviewStep(step)) return { error: "Choose the step.", success: null };
  if (!isInterviewResult(result)) return { error: "Choose the result.", success: null };
  if (!isTimeZone(timeZone)) return { error: "The time zone is not known. Check the time settings.", success: null };
  if (!interviewDate) return { error: "Enter the date.", success: null };
  if (!interviewTime) return { error: "Enter the start time as HH:MM.", success: null };
  if (!interviewEndTime) return { error: "Enter the end time as HH:MM.", success: null };
  if (interviewEndTime <= interviewTime) return { error: "The end time must be after the start time.", success: null };
  if (meetingLink === null) return { error: "The meeting link must be a web address (https://…).", success: null };
  // The job: company, title and link can always be changed. Account, category and applied date
  // come from the applied job when there is one; only a round entered by hand takes them from the form.
  const company = text(formData, "company", 500);
  const jobTitle = text(formData, "jobTitle", 500);
  const jobUrl = text(formData, "jobUrl", 2048);
  if (!company) return { error: "Enter the company.", success: null };
  if (!jobTitle) return { error: "Enter the job title.", success: null };
  if (!isHttpUrl(jobUrl)) return { error: "The job URL must be a web address (https://…).", success: null };

  if (id && !uuid(id)) return { error: "Interview was not found.", success: null };
  const [existing] = id
    ? await db.select({ bidId: interviews.bidId, callerId: interviews.callerId, trackId: interviews.trackId }).from(interviews)
      .where(and(eq(interviews.id, id), eq(interviews.managerId, manager.id))).limit(1)
    : [];
  if (id && !existing) return { error: "Interview was not found.", success: null };

  // The caller: one of the Admin's callers. A removed caller may stay on a round that already has it.
  const callerId = text(formData, "callerId", 36);
  if (callerId && (!uuid(callerId) || !(await isManagersCaller(manager.id, callerId, callerId === existing?.callerId)))) {
    return { error: "Choose one of the callers your Admin added.", success: null };
  }

  // A new round joins a track: the one it was added next to (Add next step), else its bid's, else a new one.
  const askedTrack = id ? "" : text(formData, "trackId", 36);
  if (askedTrack && (!uuid(askedTrack) || !(await isManagersTrack(manager.id, askedTrack)))) {
    return { error: "The interview this follows was not found.", success: null };
  }
  let trackId: string | null = askedTrack || null;

  let linkedBid: string | null = existing?.bidId ?? null;
  let accountValues: { candidateId: string; category: string | null; appliedAt: Date } | null = null;
  if (!id && bidId) {
    if (!uuid(bidId)) return { error: "Choose one of your applied jobs.", success: null };
    const bid = await readBidChoice(manager.id, bidId);
    if (!bid) return { error: "Choose one of your applied jobs.", success: null };
    linkedBid = bid.id;
    trackId ??= await readBidTrack(manager.id, bid.id);
    accountValues = { candidateId: bid.candidateId, category: bid.category, appliedAt: new Date(bid.appliedAt) };
  } else if (!linkedBid) {
    const candidateId = text(formData, "candidateId", 36);
    const category = text(formData, "category", 200);
    const appliedDate = normalizeInterviewDate(text(formData, "appliedDate", 10));
    if (!uuid(candidateId)) return { error: "Choose the account.", success: null };
    if (!appliedDate) return { error: "Enter the applied date.", success: null };
    const [account] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, candidateId), eq(users.parentUserId, manager.id), eq(users.role, "account")))
      .limit(1);
    if (!account) return { error: "Choose one of your accounts.", success: null };
    // Only the date is shown; noon in the zone stays that day there.
    accountValues = { candidateId, category: category || null, appliedAt: zonedMoment(appliedDate, "12:00", isTimeZone(appliedZone) ? appliedZone : timeZone) };
  }

  const values = {
    company,
    jobTitle,
    jobUrl: normalizeJobUrl(jobUrl),
    step,
    result,
    startsAt: zonedMoment(interviewDate, interviewTime, timeZone),
    endsAt: zonedMoment(interviewDate, interviewEndTime, timeZone),
    meetingLink: meetingLink || null,
    interviewer: interviewer || null,
    callerId: callerId || null,
    comment: comment || null,
  };

  // The 2-month rule: the same caller may speak to this company for another job only 2 months or
  // more away from their nearest round there. The job's own track (next steps, new dates) is fine.
  if (callerId) {
    const ownTrack = id ? existing?.trackId ?? null : trackId;
    const clash = await readCallerCompanyClash(manager.id, callerId, company, values.startsAt, ownTrack, id || null);
    if (clash) {
      const day = clash.toISOString().slice(0, 10);
      return { error: `This caller already had an interview with ${company} on ${day} for another job. The same caller can speak to this company again 2 months after that (or choose another caller).`, success: null };
    }
  }

  try {
    if (id) {
      // A round from an applied job keeps that job's account, category and applied date.
      const updated = await db.update(interviews).set({ ...values, ...(accountValues ?? {}), updatedAt: new Date() })
        .where(and(eq(interviews.id, id), eq(interviews.managerId, manager.id)))
        .returning({ id: interviews.id });
      if (!updated.length) return { error: "Interview was not found.", success: null };
    } else if (accountValues) {
      await db.insert(interviews).values({ ...values, ...accountValues, managerId: manager.id, bidId: linkedBid, ...(trackId ? { trackId } : {}) });
      // Adding a later step means the earlier ones that were still Waiting were passed.
      if (trackId) await passEarlierRounds(manager.id, trackId, step);
    }
  } catch (error) {
    if (isDuplicate(error)) return { error: "Already added: this job has this step at that time.", success: null };
    throw error;
  }
  refresh();
  return { error: null, success: id ? "Interview saved." : "Interview added." };
}

/** Sets a round's result from the table. */
export async function setInterviewResultAction(id: string, result: InterviewResult): Promise<{ error: string | null }> {
  const manager = await getCurrentUser();
  if (!manager || manager.role !== "manager") return { error: "Manager access is required." };
  if (typeof id !== "string" || !uuid(id) || !isInterviewResult(result)) return { error: "Interview was not found." };
  const updated = await db.update(interviews).set({ result, updatedAt: new Date() })
    .where(and(eq(interviews.id, id), eq(interviews.managerId, manager.id)))
    .returning({ id: interviews.id });
  if (!updated.length) return { error: "Interview was not found." };
  refresh();
  return { error: null };
}

export async function deleteInterviewAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  if (!uuid(id)) return { error: "Interview was not found.", success: null };
  const deleted = await db.delete(interviews)
    .where(and(eq(interviews.id, id), eq(interviews.managerId, manager.id)))
    .returning({ id: interviews.id });
  if (!deleted.length) return { error: "Interview was not found.", success: null };
  refresh();
  return { error: null, success: "Interview deleted." };
}

/** Applied jobs for the Add window's picker. */
export async function searchBidChoicesAction(words: string): Promise<BidChoice[]> {
  const manager = await getCurrentUser();
  if (!manager || manager.role !== "manager") return [];
  return searchBidChoices(manager.id, typeof words === "string" ? words : "");
}

/** Saves the Manager's calendar settings: second time zone and default length (the main zone is always CET). */
export async function saveInterviewSettingsAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const secondTimeZone = text(formData, "secondTimeZone", 64);
  if (secondTimeZone && !isTimeZone(secondTimeZone)) return { error: "Choose a known second time zone, or None.", success: null };
  const value = parseInterviewSettings({ secondTimeZone: secondTimeZone || null, defaultMinutes: Number(text(formData, "defaultMinutes", 4)) });
  const now = new Date();
  await db.insert(settings).values({ key: interviewSettingsKey(manager.id), value, updatedByUserId: manager.id })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedByUserId: manager.id, updatedAt: now } });
  refresh();
  revalidatePath("/", "layout");
  return { error: null, success: "Time settings saved." };
}

/** Every round of a job's track, for the Track line in the details card and the Edit window. */
export async function loadTrackAction(trackId: string): Promise<InterviewRecord[]> {
  const manager = await getCurrentUser();
  if (!manager || manager.role !== "manager" || typeof trackId !== "string" || !uuid(trackId)) return [];
  return (await readTrack(manager.id, trackId)).map(toInterviewRecord);
}

/** Who already spoke to this company (other jobs' rounds with a caller), for the Add / Edit window. */
export async function callerHistoryAction(company: string, excludeTrackId: string | null): Promise<CallerHistoryRow[]> {
  const manager = await getCurrentUser();
  if (!manager || manager.role !== "manager" || typeof company !== "string") return [];
  const track = typeof excludeTrackId === "string" && uuid(excludeTrackId) ? excludeTrackId : null;
  return readCallerHistory(manager.id, company, track);
}
