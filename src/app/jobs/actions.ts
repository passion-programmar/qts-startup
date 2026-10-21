"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";

export type RecordActionState = { error: string | null; success: string | null };
export const initialRecordState: RecordActionState = { error: null, success: null };

export async function updateJobAction(
  _state: RecordActionState,
  formData: FormData,
): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };

  const id = text(formData, "id", 36);
  const candidateId = text(formData, "candidateId", 36);
  const jobUrl = text(formData, "jobUrl", 2048);
  const jobTitle = text(formData, "jobTitle", 500);
  const company = text(formData, "company", 500);
  const location = text(formData, "location", 500);
  const date = text(formData, "date", 10);
  const status = text(formData, "status", 20);
  const failureReason = text(formData, "failureReason", 5000);
  if (!uuid(id) || !uuid(candidateId) || !jobTitle || !company || !isHttpUrl(jobUrl)) {
    return { error: "Enter valid job, company, URL, and candidate values.", success: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["todo", "pending", "applied", "failed"].includes(status)) {
    return { error: "Enter a valid date and status.", success: null };
  }
  const [candidate] = await db.select({ id: profiles.userId }).from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(profiles.userId, candidateId), eq(users.parentUserId, manager.id), eq(users.role, "account"))).limit(1);
  if (!candidate) return { error: "Select one of your candidate accounts.", success: null };

  const updated = await db.update(jobs).set({
    candidateId, jobUrl: normalizeJobUrl(jobUrl), jobTitle, company,
    location: location || null, date, status: status as "todo" | "pending" | "applied" | "failed",
    failureReason: failureReason || null, updatedAt: new Date(),
  }).where(and(eq(jobs.id, id), eq(jobs.managerId, manager.id))).returning({ id: jobs.id });
  if (!updated.length) return { error: "Job was not found.", success: null };
  revalidatePath("/jobs");
  return { error: null, success: "Job updated." };
}

export async function deleteJobAction(
  _state: RecordActionState,
  formData: FormData,
): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  if (!uuid(id)) return { error: "Invalid job.", success: null };
  const deleted = await db.delete(jobs).where(and(eq(jobs.id, id), eq(jobs.managerId, manager.id))).returning({ id: jobs.id });
  if (!deleted.length) return { error: "Job was not found.", success: null };
  revalidatePath("/jobs");
  return { error: null, success: "Job deleted." };
}

function text(data: FormData, name: string, max: number): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
