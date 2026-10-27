"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bids, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";
import type { RecordActionState } from "@/app/record-action-state";

// A bid is an independent record of one confirmed application: editing or deleting it never
// changes a jobs row. Its submitted answers and applied time stay as they were.

export async function updateBidAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  const candidateId = text(formData, "candidateId", 36);
  const jobUrl = text(formData, "jobUrl", 2048);
  const jobTitle = text(formData, "jobTitle", 500);
  const company = text(formData, "company", 500);
  const location = text(formData, "location", 500);
  const workType = text(formData, "workType", 200);
  const salary = text(formData, "salary", 500);
  const resumeFolder = text(formData, "resumeFolder", 2048);
  const googleDrivePath = text(formData, "googleDrivePath", 2048);
  if (!uuid(id) || !uuid(candidateId) || !jobTitle || !company || !resumeFolder || !isHttpUrl(jobUrl)) {
    return { error: "Enter valid candidate, job, URL, and résumé folder values.", success: null };
  }
  // Blocked candidates are read-only, so a bid cannot be moved to one.
  const [candidate] = await db.select({ id: profiles.userId }).from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(
      eq(profiles.userId, candidateId),
      eq(users.parentUserId, manager.id),
      eq(users.role, "account"),
      isNull(users.blockedAt),
    )).limit(1);
  if (!candidate) return { error: "Select one of your active candidate accounts.", success: null };
  try {
    const updated = await db.update(bids).set({
      candidateId,
      jobUrl: normalizeJobUrl(jobUrl),
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

export async function deleteBidAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  if (!uuid(id)) return { error: "Invalid bid.", success: null };
  const deleted = await db.delete(bids).where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).returning({ id: bids.id });
  if (!deleted.length) return { error: "Bid was not found.", success: null };
  revalidatePath("/bids");
  return { error: null, success: "Bid deleted." };
}

function text(data: FormData, name: string, max: number): string { const value = data.get(name); return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
