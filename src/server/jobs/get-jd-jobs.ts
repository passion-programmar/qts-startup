import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getJobBusinessDate, normalizeJobUrl } from "@/server/jobs/job-values";

export type GetJdDuplicateKind = "applied" | "job_list";

export type GetJdDuplicate = {
  kind: GetJdDuplicateKind;
  jobStatus: string | null;
};

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
  country: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  salary: string | null;
  jobReason: string | null;
  managerId: string;
  candidateId: string;
  autoSavedByGetJd?: boolean;
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
  const duplicates = await findGetJdDuplicateDetails(
    managerId,
    job,
    [candidateId],
  );
  return duplicates.get(candidateId)?.kind ?? null;
}

export async function findGetJdDuplicates(
  managerId: string,
  job: GetJdJobIdentity,
  candidateIds: string[],
): Promise<Map<string, GetJdDuplicateKind>> {
  const details = await findGetJdDuplicateDetails(managerId, job, candidateIds);
  return new Map([...details].map(([candidateId, duplicate]) => [
    candidateId,
    duplicate.kind,
  ]));
}

export async function findGetJdDuplicateDetails(
  managerId: string,
  job: GetJdJobIdentity,
  candidateIds: string[],
): Promise<Map<string, GetJdDuplicate>> {
  if (candidateIds.length === 0) return new Map();

  const [jobRows, bidRows] = await Promise.all([
    db
      .select({ candidateId: jobs.candidateId, status: jobs.status })
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

  const duplicates = new Map<string, GetJdDuplicate>();
  for (const row of jobRows) {
    const current = duplicates.get(row.candidateId);
    if (!current || (current.kind === "job_list" && current.jobStatus === "todo")) {
      duplicates.set(row.candidateId, {
        kind: "job_list",
        jobStatus: row.status,
      });
    }
  }
  for (const row of bidRows) {
    duplicates.set(row.candidateId, { kind: "applied", jobStatus: null });
  }
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
      country: job.country,
      employmentType: job.employmentType,
      workplaceType: job.workplaceType,
      salary: job.salary,
      jobReason: job.jobReason,
      autoSavedByGetJd: job.autoSavedByGetJd ?? false,
      managerId: job.managerId,
      candidateId: job.candidateId,
      date: getJobBusinessDate(),
      status: "todo",
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });

  if (savedJob) return { status: "saved", jobId: savedJob.id };

  await updateExistingGetJdJobDetails(job);
  const duplicate = await findGetJdDuplicate(
    job.managerId,
    job,
    job.candidateId,
  );
  return { status: duplicate ?? "job_list" };
}

export async function updateExistingGetJdJobDetails(
  job: NewGetJdJob,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      description: sql`coalesce(nullif(btrim(${jobs.description}), ''), ${job.description.trim()})`,
      location: sql`coalesce(nullif(btrim(${jobs.location}), ''), ${job.location})`,
      country: sql`coalesce(nullif(btrim(${jobs.country}), ''), ${job.country})`,
      employmentType: sql`coalesce(nullif(btrim(${jobs.employmentType}), ''), ${job.employmentType})`,
      workplaceType: sql`coalesce(nullif(btrim(${jobs.workplaceType}), ''), ${job.workplaceType})`,
      salary: sql`coalesce(nullif(btrim(${jobs.salary}), ''), ${job.salary})`,
      jobReason: sql`coalesce(nullif(btrim(${jobs.jobReason}), ''), ${job.jobReason})`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(jobs.managerId, job.managerId),
      duplicateConditions(jobs, job),
      or(
        sql`nullif(btrim(${jobs.description}), '') is null`,
        sql`nullif(btrim(${jobs.location}), '') is null`,
        sql`nullif(btrim(${jobs.country}), '') is null`,
        sql`nullif(btrim(${jobs.employmentType}), '') is null`,
        sql`nullif(btrim(${jobs.workplaceType}), '') is null`,
        sql`nullif(btrim(${jobs.salary}), '') is null`,
        sql`nullif(btrim(${jobs.jobReason}), '') is null`,
      ),
    ));
}
