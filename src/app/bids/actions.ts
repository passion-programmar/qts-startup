"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bids, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { markRowsWithBidApplied, resetRowsWithoutBid } from "@/server/jobs/job-bids";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";
import type { RecordActionState } from "@/app/record-action-state";

export async function updateBidAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  const candidateId = text(formData, "candidateId", 36);
  const jobUrl = text(formData, "jobUrl", 2048);
  const jobTitle = text(formData, "jobTitle", 500);
  const company = text(formData, "company", 500);
  const location = text(formData, "location", 500);
  const employmentType = text(formData, "employmentType", 200);
  const workplaceType = text(formData, "workplaceType", 200);
  const salary = text(formData, "salary", 500);
  const resumeLocalPath = text(formData, "resumeLocalPath", 2048);
  const googleDrivePath = text(formData, "googleDrivePath", 2048);
  const appliedAtText = text(formData, "appliedAt", 32);
  const appliedAt = new Date(appliedAtText);
  if (!uuid(id) || !uuid(candidateId) || !jobTitle || !company || !resumeLocalPath || !isHttpUrl(jobUrl) || Number.isNaN(appliedAt.getTime())) {
    return { error: "Enter valid job, candidate, resume, URL, and applied date values.", success: null };
  }
  const [candidate] = await db.select({ id: profiles.userId }).from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(profiles.userId, candidateId), eq(users.parentUserId, manager.id), eq(users.role, "account"))).limit(1);
  if (!candidate) return { error: "Select one of your candidate accounts.", success: null };
  const [current] = await db.select({
    candidateId: bids.candidateId, sourceJobId: bids.sourceJobId, jobUrl: bids.jobUrl, titleCompanyKey: bids.titleCompanyKey,
  }).from(bids).where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).limit(1);
  if (!current) return { error: "Bid was not found.", success: null };
  const normalizedUrl = normalizeJobUrl(jobUrl);
  // Rows the bid stops covering go back to To do; rows it now covers become Applied.
  const [updated] = await db.batch([
    db.update(bids).set({
      candidateId, jobUrl: normalizedUrl, jobTitle, company,
      titleCompanyKey: computeTitleCompanyKey(jobTitle, company) || null,
      location: location || null,
      employmentType: employmentType || null,
      workplaceType: workplaceType || null,
      salary: salary || null,
      resumeLocalPath, googleDrivePath: googleDrivePath || null, appliedAt, updatedAt: new Date(),
    }).where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).returning({ id: bids.id }),
    resetRowsWithoutBid(manager.id, current),
    markRowsWithBidApplied(manager.id, candidateId),
  ]);
  if (!updated.length) return { error: "Bid was not found.", success: null };
  revalidatePath("/bids");
  revalidatePath("/jobs");
  return { error: null, success: "Bid updated." };
}

export async function deleteBidAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  if (!uuid(id)) return { error: "Invalid bid.", success: null };
  const [bid] = await db.select({
    candidateId: bids.candidateId, sourceJobId: bids.sourceJobId, jobUrl: bids.jobUrl, titleCompanyKey: bids.titleCompanyKey,
  }).from(bids).where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).limit(1);
  if (!bid) return { error: "Bid was not found.", success: null };
  // The rows this bid covered are no longer Applied once no bid is left for them.
  const [deleted] = await db.batch([
    db.delete(bids).where(and(eq(bids.id, id), eq(bids.managerId, manager.id))).returning({ id: bids.id }),
    resetRowsWithoutBid(manager.id, bid),
  ]);
  if (!deleted.length) return { error: "Bid was not found.", success: null };
  revalidatePath("/bids");
  revalidatePath("/jobs");
  return { error: null, success: "Bid deleted." };
}

function text(data: FormData, name: string, max: number): string { const value = data.get(name); return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
