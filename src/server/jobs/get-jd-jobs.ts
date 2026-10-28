import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { bids, jobs, profiles } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { generationHeldSql } from "@/server/generation/generation-hold";
import { jobHasBid } from "@/server/jobs/job-bids";
import { computeJobKey, computeTitleCompanyKey } from "@/server/jobs/job-key";
import { getJobRecordDate } from "@/server/jobs/job-record-time-zone";
import { normalizeJobUrl } from "@/server/jobs/job-values";
import { normalizeEmploymentType, normalizeWorkplaceType } from "@/server/apply/apply-values";

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
  employmentType: string | null;
  workplaceType: string | null;
  salary: string | null;
  jobReason: string | null;
  managerId: string;
  candidateId: string;
  autoSavedByGetJd?: boolean;
  // The main site the job was found on (src/server/jobs/source-site.ts).
  sourceSiteUrl?: string | null;
};

/**
 * Gemini's employment type and work arrangement in fixed words ("FULL_TIME" → "Full-time",
 * "TELECOMMUTE" → "Remote"), so Jobs, Bids and Apply read them the same way. Unknown wording stays.
 */
function withCleanWorkFields(job: NewGetJdJob): NewGetJdJob {
  const keep = (value: string | null) => value?.trim() || null;
  return {
    ...job,
    employmentType: normalizeEmploymentType(job.employmentType) ?? keep(job.employmentType),
    workplaceType: normalizeWorkplaceType(job.workplaceType) ?? keep(job.workplaceType),
  };
}

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

function sameJobCondition(table: typeof jobs, keys: JobIdentityKeys) {
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

// A bid is the same job by its URL or its title + company (bids keep no job_key).
function sameBidCondition(keys: JobIdentityKeys) {
  return or(
    sql`regexp_replace(split_part(btrim(${bids.jobUrl}), '#', 1), '/+$', '') = ${keys.legacyUrl}`,
    ...(keys.titleCompanyKey ? [eq(bids.titleCompanyKey, keys.titleCompanyKey)] : []),
    and(
      isNull(bids.titleCompanyKey),
      sql`lower(btrim(${bids.jobTitle})) = ${keys.title.toLowerCase()}`,
      sql`lower(btrim(${bids.company})) = ${keys.company.toLowerCase()}`,
    ),
  );
}

/**
 * Days a job stays open for the Manager's other candidates after its first application. Once they
 * have passed, Get JD rejects the job for everyone: no Gemini, no save.
 */
export const REUSE_AFTER_APPLY_DAYS = 7;

/**
 * The first application to this job by any of the Manager's candidates, when it is older than
 * 7 days, matched by its address (and, once Gemini has read them, its title and company); else null.
 */
export async function findExpiredApplication(
  managerId: string,
  job: GetJdJobIdentity,
): Promise<{ candidateName: string; appliedAt: Date } | null> {
  const keys = identityKeys(job);
  const [first] = await db
    .select({ appliedAt: bids.appliedAt, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(bids)
    .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
    .where(and(eq(bids.managerId, managerId), sameBidCondition(keys)))
    .orderBy(asc(bids.appliedAt))
    .limit(1);
  if (!first) return null;
  if (Date.now() - first.appliedAt.getTime() < REUSE_AFTER_APPLY_DAYS * 86_400_000) return null;
  return { candidateName: [first.firstName, first.lastName].filter(Boolean).join(" ") || "a candidate", appliedAt: first.appliedAt };
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
      .where(and(eq(bids.managerId, managerId), sameBidCondition(keys)))
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
        // "processing" while a Chrome holds the job (Generation records nothing else until it is done).
        generationStatus: sql<string>`case when ${generationHeldSql()} then 'processing' else ${jobs.generationStatus} end`,
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
          sameBidCondition(keys),
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
  newJob: NewGetJdJob,
): Promise<{ status: "saved"; jobId: string } | { status: GetJdDuplicateKind }> {
  const job = withCleanWorkFields(newJob);
  const keys = identityKeys(job);
  const description = job.description.trim() || null;
  const pageText = description ? null : job.pageText?.trim() || null;
  const lockKeys = [...new Set([keys.jobKey, keys.titleCompanyKey].filter((key): key is string => Boolean(key)))].sort();
  const sameJobParams = [keys.jobKey, keys.titleCompanyKey, keys.legacyUrl, keys.title, keys.company];
  const recordDate = await getJobRecordDate();

  const results = await neonSql.transaction([
    ...lockKeys.map((key) => neonSql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key])),
    neonSql.query(
      `WITH base AS (
         SELECT relation_id, description, page_text, location, employment_type, workplace_type, salary
           FROM jobs WHERE ${SAME_JOB_SQL}
          ORDER BY (relation_id IS NULL), created_at
          LIMIT 1
       ), merged AS (
         SELECT
           coalesce((SELECT relation_id FROM base), gen_random_uuid()) AS relation_id,
           coalesce(nullif(btrim((SELECT description FROM base)), ''), $9::text) AS description,
           coalesce(nullif((SELECT page_text FROM base), ''), $10::text) AS page_text,
           coalesce(nullif(btrim((SELECT location FROM base)), ''), $11::text) AS location,
           coalesce(nullif(btrim((SELECT employment_type FROM base)), ''), $12::text) AS employment_type,
           coalesce(nullif(btrim((SELECT workplace_type FROM base)), ''), $13::text) AS workplace_type,
           coalesce(nullif(btrim((SELECT salary FROM base)), ''), $14::text) AS salary
       )
       INSERT INTO jobs (
         relation_id, job_key, title_company_key, job_url, job_title, company,
         description, page_text, location, employment_type, workplace_type, salary,
         job_reason, auto_saved_by_get_jd, manager_id, candidate_id, date, status, source_site_url
       )
       SELECT
         m.relation_id, $1::text, $2::text, $8::text, $4::text, $5::text,
         m.description, CASE WHEN m.description IS NULL THEN m.page_text END,
         m.location, m.employment_type, m.workplace_type, m.salary,
         $15::text, $16::boolean, $7::uuid, $6::uuid, $17::date, 'todo', $18::text
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
        job.employmentType,
        job.workplaceType,
        job.salary,
        job.jobReason,
        job.autoSavedByGetJd ?? false,
        recordDate,
        job.sourceSiteUrl ?? null,
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
         employment_type = coalesce(nullif(btrim(employment_type), ''), $9::text),
         workplace_type = coalesce(nullif(btrim(workplace_type), ''), $10::text),
         salary = coalesce(nullif(btrim(salary), ''), $11::text),
         updated_at = now()
       WHERE ${SAME_JOB_SQL}
         AND (
           (nullif(btrim(description), '') IS NULL AND ($6::text IS NOT NULL OR (page_text IS NULL AND $7::text IS NOT NULL)))
           OR (page_text IS NOT NULL AND nullif(btrim(description), '') IS NOT NULL)
           OR (nullif(btrim(location), '') IS NULL AND $8::text IS NOT NULL)
           OR (nullif(btrim(employment_type), '') IS NULL AND $9::text IS NOT NULL)
           OR (nullif(btrim(workplace_type), '') IS NULL AND $10::text IS NOT NULL)
           OR (nullif(btrim(salary), '') IS NULL AND $11::text IS NOT NULL)
         )`,
      [
        ...sameJobParams,
        description,
        pageText,
        job.location,
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
  newJob: NewGetJdJob,
): Promise<void> {
  const job = withCleanWorkFields(newJob);
  const keys = identityKeys(job);
  const description = job.description.trim() || null;
  await db
    .update(jobs)
    .set({
      description: sql`coalesce(nullif(btrim(${jobs.description}), ''), ${description})`,
      pageText: sql`case when coalesce(nullif(btrim(${jobs.description}), ''), ${description}) is not null then null else ${jobs.pageText} end`,
      location: sql`coalesce(nullif(btrim(${jobs.location}), ''), ${job.location})`,
      sourceSiteUrl: sql`coalesce(nullif(btrim(${jobs.sourceSiteUrl}), ''), ${job.sourceSiteUrl ?? null})`,
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
      sql`not ${generationHeldSql()}`,
      ...(options.autoSavedOnly ? [eq(jobs.autoSavedByGetJd, true)] : []),
      sql`not ${jobHasBid()}`,
    ))
    .returning({ id: jobs.id });
  return deleted.length > 0;
}
