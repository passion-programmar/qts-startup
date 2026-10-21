import "server-only";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getJobBusinessDate, normalizeJobUrl } from "@/server/jobs/job-values";

export type GetJdDuplicateKind = "applied" | "job_list";

export type GetJdJobIdentity = {
  jobUrl: string;
  jobTitle: string;
  company: string;
};

export type ManagerJobPresence = {
  inJobs: boolean;
  inBids: boolean;
};

type NewGetJdJob = GetJdJobIdentity & {
  description: string;
  location: string | null;
  managerId: string;
  candidateId: string;
};

function duplicateConditions(
  table: typeof jobs | typeof bids,
  job: GetJdJobIdentity,
) {
  const sameUrl = normalizedUrlCondition(table, job.jobUrl);
  const sameTitleAndCompany = and(
    sql`lower(btrim(${table.jobTitle})) = ${job.jobTitle.trim().toLowerCase()}`,
    sql`lower(btrim(${table.company})) = ${job.company.trim().toLowerCase()}`,
  );
  return or(sameUrl, sameTitleAndCompany);
}

function normalizedUrlCondition(
  table: typeof jobs | typeof bids,
  jobUrl: string,
) {
  return sql`regexp_replace(split_part(btrim(${table.jobUrl}), '#', 1), '/+$', '') = ${normalizeJobUrl(jobUrl)}`;
}

export async function findManagerJobPresence(
  managerId: string,
  job: GetJdJobIdentity,
): Promise<ManagerJobPresence> {
  const [jobRows, bidRows] = await Promise.all([
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.managerId, managerId), normalizedUrlCondition(jobs, job.jobUrl)))
      .limit(1),
    db
      .select({ id: bids.id })
      .from(bids)
      .where(and(eq(bids.managerId, managerId), normalizedUrlCondition(bids, job.jobUrl)))
      .limit(1),
  ]);

  return {
    inJobs: jobRows.length > 0,
    inBids: bidRows.length > 0,
  };
}

export async function findGetJdDuplicate(
  managerId: string,
  job: GetJdJobIdentity,
  candidateId: string,
): Promise<GetJdDuplicateKind | null> {
  const duplicates = await findGetJdDuplicates(
    managerId,
    job,
    [candidateId],
  );
  return duplicates.get(candidateId) ?? null;
}

export async function findGetJdDuplicates(
  managerId: string,
  job: GetJdJobIdentity,
  candidateIds: string[],
): Promise<Map<string, GetJdDuplicateKind>> {
  if (candidateIds.length === 0) return new Map();

  const [jobRows, bidRows] = await Promise.all([
    db
      .select({ candidateId: jobs.candidateId })
      .from(jobs)
      .where(
        and(
          eq(jobs.managerId, managerId),
          inArray(jobs.candidateId, candidateIds),
          duplicateConditions(jobs, job),
        ),
      ),
    db
      .select({ candidateId: bids.candidateId })
      .from(bids)
      .where(
        and(
          eq(bids.managerId, managerId),
          inArray(bids.candidateId, candidateIds),
          duplicateConditions(bids, job),
        ),
      ),
  ]);

  const duplicates = new Map<string, GetJdDuplicateKind>();
  for (const row of jobRows) duplicates.set(row.candidateId, "job_list");
  for (const row of bidRows) duplicates.set(row.candidateId, "applied");
  return duplicates;
}

export async function insertGetJdJob(
  job: NewGetJdJob,
): Promise<{ status: "saved"; jobId: string } | { status: GetJdDuplicateKind }> {
  const [savedJob] = await db
    .insert(jobs)
    .values({
      jobUrl: normalizeJobUrl(job.jobUrl),
      jobTitle: job.jobTitle.trim(),
      company: job.company.trim(),
      description: job.description,
      location: job.location,
      managerId: job.managerId,
      candidateId: job.candidateId,
      date: getJobBusinessDate(),
      status: "todo",
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });

  if (savedJob) return { status: "saved", jobId: savedJob.id };

  const duplicate = await findGetJdDuplicate(
    job.managerId,
    job,
    job.candidateId,
  );
  if (duplicate === "job_list" && job.description.trim()) {
    await db
      .update(jobs)
      .set({ description: job.description.trim() })
      .where(and(
        eq(jobs.managerId, job.managerId),
        eq(jobs.candidateId, job.candidateId),
        duplicateConditions(jobs, job),
        or(isNull(jobs.description), eq(jobs.description, "")),
      ));
  }
  return { status: duplicate ?? "job_list" };
}
