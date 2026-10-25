"use server";

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bids, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { getCurrentUser, requireUser } from "@/lib/session";
import { computeJobKey, computeTitleCompanyKey } from "@/server/jobs/job-key";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";
import type { RecordActionState } from "@/app/record-action-state";
import { effectiveJobDescription } from "@/server/jobs/job-description";

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
  const description = text(formData, "description", 100_000);
  const location = text(formData, "location", 500);
  const country = text(formData, "country", 200);
  const employmentType = text(formData, "employmentType", 200);
  const workplaceType = text(formData, "workplaceType", 200);
  const salary = text(formData, "salary", 500);
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

  const [existingJob] = await db.select({ generationStatus: jobs.generationStatus, relationId: jobs.relationId }).from(jobs)
    .where(and(eq(jobs.id, id), eq(jobs.managerId, manager.id))).limit(1);
  if (!existingJob) return { error: "Job was not found.", success: null };
  if (existingJob.generationStatus === "processing") {
    return { error: "Cancel Generation before editing a job that is currently processing.", success: null };
  }

  const normalizedUrl = normalizeJobUrl(jobUrl);
  const jobKey = computeJobKey({ url: normalizedUrl, title: jobTitle, company });
  const titleCompanyKey = computeTitleCompanyKey(jobTitle, company) || null;
  // The same job by URL or title + company: shared keys, or the legacy match for rows not backfilled yet.
  const duplicate = await db.select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.managerId, manager.id),
    eq(jobs.candidateId, candidateId),
    ne(jobs.id, id),
    ...(existingJob.relationId
      ? [or(isNull(jobs.relationId), ne(jobs.relationId, existingJob.relationId))]
      : []),
    or(
      ...(jobKey ? [eq(jobs.jobKey, jobKey)] : []),
      ...(titleCompanyKey ? [eq(jobs.titleCompanyKey, titleCompanyKey)] : []),
      sql`regexp_replace(split_part(btrim(${jobs.jobUrl}), '#', 1), '/+$', '') = ${normalizedUrl}`,
      and(
        sql`lower(btrim(${jobs.jobTitle})) = ${jobTitle.trim().toLowerCase()}`,
        sql`lower(btrim(${jobs.company})) = ${company.trim().toLowerCase()}`,
      ),
    ),
  )).limit(1);
  if (duplicate.length) {
    return { error: "This candidate already has a job row with the same URL or title and company.", success: null };
  }

  // Job details are shared by every row of the job (all Managers); account fields stay on this row.
  const sharedDetails = {
    jobUrl: normalizedUrl, jobTitle, company, jobKey, titleCompanyKey,
    description: description || null,
    ...(description ? { pageText: null } : {}),
    location: location || null,
    country: country || null,
    employmentType: employmentType || null,
    workplaceType: workplaceType || null,
    salary: salary || null,
  };
  let updated: { id: string }[];
  try {
    const [ownRow] = await db.batch([
      db.update(jobs).set({
        ...sharedDetails,
        candidateId,
        autoSavedByGetJd: false,
        date, status: status as "todo" | "pending" | "applied" | "failed",
        failureReason: failureReason || null, updatedAt: new Date(),
      }).where(and(
        eq(jobs.id, id),
        eq(jobs.managerId, manager.id),
        ne(jobs.generationStatus, "processing"),
      )).returning({ id: jobs.id }),
      db.update(jobs).set({ ...sharedDetails, updatedAt: new Date() }).where(and(
        existingJob.relationId ? eq(jobs.relationId, existingJob.relationId) : sql`false`,
        ne(jobs.id, id),
      )),
    ]);
    updated = ownRow;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "This candidate already has a job row with the same URL or title and company.", success: null };
    }
    throw error;
  }
  if (!updated.length) return { error: "Job is unavailable or Generation started processing; refresh and try again.", success: null };
  revalidatePath("/jobs");
  return { error: null, success: "Job updated." };
}

export async function setJobGenerationQueueAction(
  _state: RecordActionState,
  formData: FormData,
): Promise<RecordActionState> {
  const manager = await requireUser();
  if (manager.role !== "manager") {
    return { error: "Manager access is required.", success: null };
  }
  const id = text(formData, "id", 36);
  const intent = text(formData, "intent", 20);
  if (!uuid(id) || !["queue", "cancel", "reset"].includes(intent)) {
    return { error: "Invalid Generation queue action.", success: null };
  }

  const [job] = await db
    .select({
      generationStatus: jobs.generationStatus,
      generationAttemptCount: jobs.generationAttemptCount,
      description: effectiveJobDescription(),
      resumeLocalPath: jobs.resumeLocalPath,
      jdMatching: profiles.jdMatching,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .where(and(eq(jobs.id, id), eq(jobs.managerId, manager.id)))
    .limit(1);
  if (!job) return { error: "Job was not found.", success: null };

  if (intent === "reset") {
    if (job.generationStatus !== "failed" || job.generationAttemptCount < 2) {
      return { error: "Reset is available only after both Generation attempts fail.", success: null };
    }
    const [reset] = await db.update(jobs).set({
      generationStatus: "not_queued",
      generationAttemptCount: 0,
      generationError: null,
      generationLeaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(jobs.id, id),
      eq(jobs.managerId, manager.id),
      eq(jobs.generationStatus, "failed"),
      sql`${jobs.generationAttemptCount} >= 2`,
    )).returning({ id: jobs.id });
    if (!reset) return { error: "Generation state changed; refresh and try again.", success: null };
  } else if (intent === "queue") {
    if (job.generationStatus === "processing") {
      return { error: "This job is already being processed.", success: null };
    }
    if (job.generationStatus === "completed") {
      return { error: "This job has already completed Generation.", success: null };
    }
    if (job.generationAttemptCount >= 2) {
      return { error: "Both Generation attempts failed. Use Reset Generation before retrying.", success: null };
    }
    if (!job.description?.trim() || !job.jdMatching?.trim() || job.resumeLocalPath !== null) {
      return {
        error: "Generation needs a saved job description and the candidate's JD-matching notes, and the job must not already have a resume.",
        success: null,
      };
    }
    const [queued] = await db.update(jobs).set({
      generationStatus: "queued",
      generationError: null,
      generationLeaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(jobs.id, id),
      eq(jobs.managerId, manager.id),
      ne(jobs.generationStatus, "processing"),
    )).returning({ id: jobs.id });
    if (!queued) {
      return { error: "This job is already being processed.", success: null };
    }
  } else {
    if (!["queued", "processing"].includes(job.generationStatus)) {
      return { error: "Only queued or processing Generation jobs can be cancelled.", success: null };
    }
    const processing = job.generationStatus === "processing";
    const [cancelled] = await db.update(jobs).set({
      generationStatus: "cancelled",
      ...(processing
        ? { generationAttemptCount: sql`greatest(${jobs.generationAttemptCount} - 1, 0)` }
        : {}),
      generationError: null,
      generationLeaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(jobs.id, id),
      eq(jobs.managerId, manager.id),
      eq(jobs.generationStatus, job.generationStatus),
    )).returning({ id: jobs.id });
    if (!cancelled) {
      return { error: "Generation state changed; refresh and try again.", success: null };
    }
  }
  revalidatePath("/jobs");
  return { error: null, success: intent === "reset"
    ? "Generation failure state reset. The job can be queued again."
    : intent === "queue" ? "Generation queued." : "Generation cancelled. Queue it again to retry." };
}

export async function deleteJobAction(
  _state: RecordActionState,
  formData: FormData,
): Promise<RecordActionState> {
  let manager: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    manager = await getCurrentUser();
  } catch (error) {
    console.error("Could not verify the session before deleting a manager job.", error);
    return {
      error: "Your session could not be verified. Refresh the page and try again.",
      success: null,
    };
  }
  if (!manager) return { error: "Your session has expired. Sign in again.", success: null };
  if (manager.role !== "manager") return { error: "Manager access is required.", success: null };
  const id = text(formData, "id", 36);
  if (!uuid(id)) return { error: "Invalid job.", success: null };
  // A row whose account applied (a bid exists) keeps its job; delete the bid on the Bids page first.
  const appliedBid = sql`exists (
    select 1 from ${bids}
     where ${bids.sourceJobId} = ${jobs.id}
        or (${bids.managerId} = ${jobs.managerId}
            and ${bids.candidateId} = ${jobs.candidateId}
            and (${bids.jobKey} = ${jobs.jobKey} or ${bids.titleCompanyKey} = ${jobs.titleCompanyKey}))
  )`;
  try {
    const deleted = await db.delete(jobs).where(and(
      eq(jobs.id, id),
      eq(jobs.managerId, manager.id),
      ne(jobs.generationStatus, "processing"),
      sql`not ${appliedBid}`,
    )).returning({ id: jobs.id });
    if (!deleted.length) {
      const [job] = await db.select({
        generationStatus: jobs.generationStatus,
        hasBid: sql<boolean>`${appliedBid}`,
      }).from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.managerId, manager.id))).limit(1);
      if (!job) return { error: "Job was not found. Refresh the page and try again.", success: null };
      if (job.generationStatus === "processing") {
        return { error: "Cancel Generation before deleting a job that is currently processing.", success: null };
      }
      if (job.hasBid) {
        return { error: "This candidate applied to this job. Delete the bid on the Bids page first.", success: null };
      }
      return { error: "The job could not be deleted. Refresh the page and try again.", success: null };
    }
  } catch (error) {
    console.error("Could not delete manager job.", error);
    if (isForeignKeyViolation(error)) {
      return {
        error: "This job is linked to another record and cannot be deleted. Remove the linked record first.",
        success: null,
      };
    }
    return {
      error: "The job could not be deleted because of a server or database error. Please try again.",
      success: null,
    };
  }
  try {
    revalidatePath("/jobs");
  } catch (error) {
    console.error("Job was deleted, but the Jobs page could not be refreshed.", error);
    return {
      error: null,
      success: "Job deleted. Refresh the page if it is still visible.",
    };
  }
  return { error: null, success: "Job deleted." };
}

function text(data: FormData, name: string, max: number): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505";
}
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23503";
}
function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
