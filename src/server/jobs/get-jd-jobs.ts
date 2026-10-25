import "server-only";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { computeJobKey, computeTitleCompanyKey } from "@/server/jobs/job-key";
import { getJobBusinessDate, normalizeJobUrl } from "@/server/jobs/job-values";

// Shared-jobs model (docs/get-jd-redesign.md): one row per account on a job; rows
// of the same job share relation_id. Two pages are the same job when job_key or
// title_company_key matches. Rows not yet backfilled (job_key IS NULL) still
// match by the legacy normalized URL or title + company, so duplicates are caught
// before and after the backfill.

import type { GetJdDuplicate, GetJdDuplicateKind } from "@/server/jobs/get-jd-account-states";

export {
  getJdAccountState,
  summarizeAccountStates,
  type GetJdAccountState,
  type GetJdDuplicate,
  type GetJdDuplicateKind,
} from "@/server/jobs/get-jd-account-states";

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
  /** Plain page innerText; stored only when the job has no description. */
  pageText?: string | null;
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

type JobIdentityKeys = {
  jobKey: string | null;
  titleCompanyKey: string | null;
  legacyUrl: string;
  title: string;
  company: string;
};

function identityKeys(job: GetJdJobIdentity): JobIdentityKeys {
  const title = job.jobTitle.trim();
  const company = job.company.trim();
  return {
    jobKey: computeJobKey({ url: job.jobUrl, title, company }),
    titleCompanyKey: computeTitleCompanyKey(title, company) || null,
    legacyUrl: normalizeJobUrl(job.jobUrl),
    title,
    company,
  };
}

function sameJobCondition(table: typeof jobs | typeof bids, keys: JobIdentityKeys) {
  const legacy = and(
    isNull(table.jobKey),
    or(
      sql`regexp_replace(split_part(btrim(${table.jobUrl}), '#', 1), '/+$', '') = ${keys.legacyUrl}`,
      and(
        sql`lower(btrim(${table.jobTitle})) = ${keys.title.toLowerCase()}`,
        sql`lower(btrim(${table.company})) = ${keys.company.toLowerCase()}`,
      ),
    ),
  );
  return or(
    ...(keys.jobKey ? [eq(table.jobKey, keys.jobKey)] : []),
    ...(keys.titleCompanyKey ? [eq(table.titleCompanyKey, keys.titleCompanyKey)] : []),
    legacy,
  );
}

// The same rule in raw SQL for the locked insert ($1 job_key, $2 title_company_key,
// $3 legacy URL, $4 title, $5 company).
const SAME_JOB_SQL = `(job_key = $1 OR title_company_key = $2 OR (job_key IS NULL AND (
  regexp_replace(split_part(btrim(job_url), '#', 1), '/+$', '') = $3
  OR (lower(btrim(job_title)) = lower($4) AND lower(btrim(company)) = lower($5)))))`;

export async function findManagerJobPresence(
  managerId: string,
  job: GetJdJobIdentity,
): Promise<ManagerJobPresence> {
  const keys = identityKeys(job);
  const [jobRows, bidRows] = await Promise.all([
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.managerId, managerId), sameJobCondition(jobs, keys)))
      .limit(1),
    db
      .select({ id: bids.id })
      .from(bids)
      .where(and(eq(bids.managerId, managerId), sameJobCondition(bids, keys)))
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

/** Per account of this Manager: "applied" (a bid, or row status applied) or "job_list" (has the job). */
export async function findGetJdDuplicateDetails(
  managerId: string,
  job: GetJdJobIdentity,
  candidateIds: string[],
): Promise<Map<string, GetJdDuplicate>> {
  if (candidateIds.length === 0) return new Map();
  const keys = identityKeys(job);

  const [jobRows, bidRows] = await Promise.all([
    db
      .select({
        id: jobs.id,
        candidateId: jobs.candidateId,
        status: jobs.status,
        generationStatus: jobs.generationStatus,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.managerId, managerId),
          inArray(jobs.candidateId, candidateIds),
          sameJobCondition(jobs, keys),
        ),
      ),
    db
      .select({ candidateId: bids.candidateId })
      .from(bids)
      .where(
        and(
          eq(bids.managerId, managerId),
          inArray(bids.candidateId, candidateIds),
          sameJobCondition(bids, keys),
        ),
      ),
  ]);

  const duplicates = new Map<string, GetJdDuplicate>();
  for (const row of jobRows) {
    const current = duplicates.get(row.candidateId);
    if (current?.kind === "applied") continue;
    duplicates.set(row.candidateId, {
      kind: row.status === "applied" ? "applied" : "job_list",
      jobStatus: row.status,
      rowId: row.id,
      generationStatus: row.generationStatus,
    });
  }
  for (const row of bidRows) {
    const current = duplicates.get(row.candidateId);
    duplicates.set(row.candidateId, {
      kind: "applied",
      jobStatus: current?.jobStatus ?? null,
      rowId: current?.rowId ?? null,
      generationStatus: current?.generationStatus ?? null,
    });
  }
  return duplicates;
}

/**
 * Adds one account to a job. Saves of the same job are serialized by advisory
 * locks on both keys (taken in sorted order, so two saves can never deadlock);
 * the first account creates the job's relation_id and later ones reuse it.
 * Shared details come from the job's existing rows, filling only empty fields,
 * and a description always replaces page_text.
 */
export async function insertGetJdJob(
  job: NewGetJdJob,
): Promise<{ status: "saved"; jobId: string } | { status: GetJdDuplicateKind }> {
  const keys = identityKeys(job);
  const description = job.description.trim() || null;
  const pageText = description ? null : job.pageText?.trim() || null;
  const lockKeys = [...new Set([keys.jobKey, keys.titleCompanyKey].filter((key): key is string => Boolean(key)))].sort();
  const sameJobParams = [keys.jobKey, keys.titleCompanyKey, keys.legacyUrl, keys.title, keys.company];

  const results = await neonSql.transaction([
    ...lockKeys.map((key) => neonSql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key])),
    neonSql.query(
      `WITH base AS (
         SELECT relation_id, description, page_text, location, country, employment_type, workplace_type, salary
           FROM jobs WHERE ${SAME_JOB_SQL}
          ORDER BY (relation_id IS NULL), created_at
          LIMIT 1
       ), merged AS (
         SELECT
           coalesce((SELECT relation_id FROM base), gen_random_uuid()) AS relation_id,
           coalesce(nullif(btrim((SELECT description FROM base)), ''), $9::text) AS description,
           coalesce(nullif((SELECT page_text FROM base), ''), $10::text) AS page_text,
           coalesce(nullif(btrim((SELECT location FROM base)), ''), $11::text) AS location,
           coalesce(nullif(btrim((SELECT country FROM base)), ''), $12::text) AS country,
           coalesce(nullif(btrim((SELECT employment_type FROM base)), ''), $13::text) AS employment_type,
           coalesce(nullif(btrim((SELECT workplace_type FROM base)), ''), $14::text) AS workplace_type,
           coalesce(nullif(btrim((SELECT salary FROM base)), ''), $15::text) AS salary
       )
       INSERT INTO jobs (
         relation_id, job_key, title_company_key, job_url, job_title, company,
         description, page_text, location, country, employment_type, workplace_type, salary,
         job_reason, auto_saved_by_get_jd, manager_id, candidate_id, date, status
       )
       SELECT
         m.relation_id, $1::text, $2::text, $8::text, $4::text, $5::text,
         m.description, CASE WHEN m.description IS NULL THEN m.page_text END,
         m.location, m.country, m.employment_type, m.workplace_type, m.salary,
         $16::text, $17::boolean, $7::uuid, $6::uuid, $18::date, 'todo'
         FROM merged m
        WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE candidate_id = $6 AND ${SAME_JOB_SQL})
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        ...sameJobParams,
        job.candidateId,
        job.managerId,
        keys.legacyUrl,
        description,
        pageText,
        job.location,
        job.country,
        job.employmentType,
        job.workplaceType,
        job.salary,
        job.jobReason,
        job.autoSavedByGetJd ?? false,
        getJobBusinessDate(),
      ],
    ),
    // Fill empty shared details on the job's other rows; a new description clears page_text.
    neonSql.query(
      `UPDATE jobs SET
         description = coalesce(nullif(btrim(description), ''), $6::text),
         page_text = CASE
           WHEN coalesce(nullif(btrim(description), ''), $6::text) IS NOT NULL THEN NULL
           ELSE coalesce(nullif(page_text, ''), $7::text)
         END,
         location = coalesce(nullif(btrim(location), ''), $8::text),
         country = coalesce(nullif(btrim(country), ''), $9::text),
         employment_type = coalesce(nullif(btrim(employment_type), ''), $10::text),
         workplace_type = coalesce(nullif(btrim(workplace_type), ''), $11::text),
         salary = coalesce(nullif(btrim(salary), ''), $12::text),
         updated_at = now()
       WHERE ${SAME_JOB_SQL}
         AND (
           (nullif(btrim(description), '') IS NULL AND ($6::text IS NOT NULL OR (page_text IS NULL AND $7::text IS NOT NULL)))
           OR (page_text IS NOT NULL AND nullif(btrim(description), '') IS NOT NULL)
           OR (nullif(btrim(location), '') IS NULL AND $8::text IS NOT NULL)
           OR (nullif(btrim(country), '') IS NULL AND $9::text IS NOT NULL)
           OR (nullif(btrim(employment_type), '') IS NULL AND $10::text IS NOT NULL)
           OR (nullif(btrim(workplace_type), '') IS NULL AND $11::text IS NOT NULL)
           OR (nullif(btrim(salary), '') IS NULL AND $12::text IS NOT NULL)
         )`,
      [
        ...sameJobParams,
        description,
        pageText,
        job.location,
        job.country,
        job.employmentType,
        job.workplaceType,
        job.salary,
      ],
    ),
  ]);

  const [inserted] = results[lockKeys.length] as { id: string }[];
  if (inserted) return { status: "saved", jobId: inserted.id };
  const duplicate = await findGetJdDuplicate(job.managerId, job, job.candidateId);
  return { status: duplicate ?? "job_list" };
}

/** Fills empty shared details from a later save; kept for callers that skip the insert. */
export async function updateExistingGetJdJobDetails(
  job: NewGetJdJob,
): Promise<void> {
  const keys = identityKeys(job);
  const description = job.description.trim() || null;
  await db
    .update(jobs)
    .set({
      description: sql`coalesce(nullif(btrim(${jobs.description}), ''), ${description})`,
      pageText: sql`case when coalesce(nullif(btrim(${jobs.description}), ''), ${description}) is not null then null else ${jobs.pageText} end`,
      location: sql`coalesce(nullif(btrim(${jobs.location}), ''), ${job.location})`,
      country: sql`coalesce(nullif(btrim(${jobs.country}), ''), ${job.country})`,
      employmentType: sql`coalesce(nullif(btrim(${jobs.employmentType}), ''), ${job.employmentType})`,
      workplaceType: sql`coalesce(nullif(btrim(${jobs.workplaceType}), ''), ${job.workplaceType})`,
      salary: sql`coalesce(nullif(btrim(${jobs.salary}), ''), ${job.salary})`,
      updatedAt: new Date(),
    })
    .where(and(
      sameJobCondition(jobs, keys),
      or(
        sql`nullif(btrim(${jobs.description}), '') is null`,
        sql`${jobs.pageText} is not null`,
        sql`nullif(btrim(${jobs.location}), '') is null`,
        sql`nullif(btrim(${jobs.country}), '') is null`,
        sql`nullif(btrim(${jobs.employmentType}), '') is null`,
        sql`nullif(btrim(${jobs.workplaceType}), '') is null`,
        sql`nullif(btrim(${jobs.salary}), '') is null`,
      ),
    ));
}

/**
 * Removes one account's row from a job (unchecking it in Get JD). Refused when
 * the account applied (a bid exists or the status is applied) or its Generation
 * is running, so a click can never remove work in progress.
 */
export async function removeGetJdJobAccount(
  managerId: string,
  rowId: string,
  options: { autoSavedOnly?: boolean } = {},
): Promise<boolean> {
  const deleted = await db
    .delete(jobs)
    .where(and(
      eq(jobs.id, rowId),
      eq(jobs.managerId, managerId),
      sql`${jobs.status} <> 'applied'`,
      sql`${jobs.generationStatus} <> 'processing'`,
      ...(options.autoSavedOnly ? [eq(jobs.autoSavedByGetJd, true)] : []),
      sql`not exists (
        select 1 from ${bids}
         where ${bids.sourceJobId} = ${jobs.id}
            or (${bids.managerId} = ${jobs.managerId}
                and ${bids.candidateId} = ${jobs.candidateId}
                and (${bids.jobKey} = ${jobs.jobKey} or ${bids.titleCompanyKey} = ${jobs.titleCompanyKey}))
      )`,
    ))
    .returning({ id: jobs.id });
  return deleted.length > 0;
}
