"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bids, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getCurrentUser, requireUser } from "@/lib/session";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";
import type { RecordActionState } from "@/app/record-action-state";
import type { SubmittedAnswer } from "@/app/components/submitted-answers";

// A bid is an independent, permanent record of one confirmed application: it can be edited but not
// deleted, and editing it never changes a jobs row. Its submitted answers and applied time stay as they were.

export async function updateBidAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  const jobUrl = text(formData, "jobUrl", 2048);
  const jobTitle = text(formData, "jobTitle", 500);
  const company = text(formData, "company", 500);
  const location = text(formData, "location", 500);
  const workType = text(formData, "workType", 200);
  const salary = text(formData, "salary", 500);
  const resumeFolder = text(formData, "resumeFolder", 2048);
  const googleDrivePath = text(formData, "googleDrivePath", 2048);
  // A bid from a Resume page download has no job URL, and no folder when the browser saved its PDFs.
  if (!uuid(id) || !jobTitle || !company || (jobUrl && !isHttpUrl(jobUrl))) {
    return { error: "Enter a valid job title, company, and URL (or leave the URL empty).", success: null };
  }
  // The account never changes after the bid is made: the bid keeps its own, whatever the form sends.
  const [ownAccount] = await db.select({ candidateId: bids.candidateId }).from(bids)
    .where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).limit(1);
  if (!ownAccount) return { error: "Bid was not found.", success: null };
  // Blocked candidates are read-only, so their bids cannot be edited either.
  const [candidate] = await db.select({ id: profiles.userId }).from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(
      eq(profiles.userId, ownAccount.candidateId),
      eq(users.parentUserId, manager.id),
      eq(users.role, "account"),
      isNull(users.blockedAt),
    )).limit(1);
  if (!candidate) return { error: "This account is blocked or no longer yours, so its bid cannot be edited.", success: null };
  try {
    const updated = await db.update(bids).set({
      jobUrl: jobUrl ? normalizeJobUrl(jobUrl) : "",
      jobTitle,
      company,
      titleCompanyKey: computeTitleCompanyKey(jobTitle, company) || null,
      location: location || null,
      workType: workType || null,
      salary: salary || null,
      resumeFolder,
      googleDrivePath: googleDrivePath || null,
      updatedAt: new Date(),
    }).where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).returning({ id: bids.id });
    if (!updated.length) return { error: "Bid was not found.", success: null };
  } catch (error) {
    if (error instanceof Error && /bids_candidate_job_url_unique/.test(`${error.message} ${String(error.cause ?? "")}`)) {
      return { error: "This candidate already has a bid for this job address.", success: null };
    }
    throw error;
  }
  revalidatePath("/bids");
  return { error: null, success: "Bid updated." };
}

function text(data: FormData, name: string, max: number): string { const value = data.get(name); return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

/** One bid's submitted answers, for its View window (the list does not load them). */
export async function loadBidAnswersAction(bidId: string): Promise<SubmittedAnswer[] | null> {
  const manager = await getCurrentUser();
  if (!manager || manager.role !== "manager" || typeof bidId !== "string" || !uuid(bidId)) return null;
  const [row] = await db.select({ answers: bids.answers }).from(bids)
    .where(and(eq(bids.id, bidId), eq(bids.managerId, manager.id))).limit(1);
  if (!row) return null;
  return Array.isArray(row.answers) ? row.answers as SubmittedAnswer[] : [];
}
