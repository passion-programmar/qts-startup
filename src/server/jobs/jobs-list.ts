import "server-only";

import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { applyAttempts, jobs, profiles, prompts } from "@/db/schema";
import { db } from "@/lib/db";
import { jobHasBid } from "@/server/jobs/job-bids";
import { effectiveJobDescription } from "@/server/jobs/job-description";
import { generationHeldSql } from "@/server/generation/generation-hold";
import { pdfTemplateLabels } from "@/server/pdf/pdf-templates";
import type { ApplyRun } from "@/server/apply/apply-values";
import {
  dateRange,
  likePattern,
  tabCounts,
  tabStages,
  type JobStage,
  type JobTab,
  type JobsQuery,
} from "@/server/jobs/jobs-list-query";

// The Jobs page reads one page of rows and the count for each tab: two reads, whatever the number of
// saved jobs. Each job's latest application comes from one pass over the Manager's applications.

export type ApplyAttemptSummary = {
  id: string;
  status: "claimed" | "waiting_review" | "waiting_confirmation" | "submitting" | "confirmed" | "not_confirmed"
    | "failed" | "released" | "skipped" | "cleared";
  reason: string | null;
  browser: string | null;
  returns: number;
};

function latestAttempts(managerId: string) {
  return db.$with("latest_attempt").as(
    db.selectDistinctOn([applyAttempts.jobId], {
      jobId: applyAttempts.jobId,
      attemptId: sql<string>`${applyAttempts.id}`.as("attempt_id"),
      attemptStatus: sql<ApplyAttemptSummary["status"]>`${applyAttempts.status}`.as("attempt_status"),
      attemptReason: sql<string | null>`${applyAttempts.resultReason}`.as("attempt_reason"),
      attemptBrowserId: sql<string | null>`${applyAttempts.browserId}`.as("attempt_browser_id"),
      // Times this job's Apply returned to the list, across all its applications.
      returns: sql<number>`(count(*) filter (where ${applyAttempts.status} = 'released') over (partition by ${applyAttempts.jobId}))::int`.as("returns"),
    })
      .from(applyAttempts)
      .where(eq(applyAttempts.managerId, managerId))
      .orderBy(applyAttempts.jobId, desc(applyAttempts.createdAt)),
  );
}

type Latest = ReturnType<typeof latestAttempts>;

/** Where a job stands; the order decides when several apply (an answer needed comes first). */
function stageSql(latest: Latest) {
  return sql<JobStage>`(case
    when ${latest.attemptStatus} in ('waiting_review', 'waiting_confirmation', 'submitting') then 'answer'
    when ${latest.attemptStatus} = 'claimed' then 'applying'
    when ${generationHeldSql()} or ${jobs.generationStatus} = 'queued' then 'generating'
    when ${jobs.status} = 'failed' or ${jobs.generationStatus} = 'failed'
      or (${jobs.status} <> 'applied' and (
        ${latest.attemptStatus} in ('failed', 'skipped', 'not_confirmed')
        or (${latest.attemptStatus} = 'released' and ${latest.returns} >= 2)
      )) then 'failed'
    when ${jobs.generationStatus} = 'completed' then 'ready'
    else 'not_started'
  end)`;
}

function filters(managerId: string, query: JobsQuery, today: string): SQL[] {
  const conditions: SQL[] = [
    eq(jobs.managerId, managerId),
    // A job that already has a bid lives on the Bids page.
    sql`not ${jobHasBid()}`,
  ];
  if (query.candidate !== "all") conditions.push(eq(jobs.candidateId, query.candidate));
  const range = dateRange(query.date, today);
  if (range) conditions.push(gte(jobs.date, range.from), lte(jobs.date, range.to));
  const words = query.q.trim();
  if (words) {
    const pattern = likePattern(words);
    const lowered = words.toLowerCase();
    const templateKeys = Object.entries(pdfTemplateLabels)
      .filter(([key, label]) => key.includes(lowered) || label.toLowerCase().includes(lowered))
      .map(([key]) => key);
    const byField: Record<Exclude<JobsQuery["field"], "all">, SQL | undefined> = {
      name: sql`concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}) ilike ${pattern}`,
      title: ilike(jobs.jobTitle, pattern),
      company: ilike(jobs.company, pattern),
      url: ilike(jobs.jobUrl, pattern),
      setup: or(
        sql`(${prompts.name} || ' · v' || ${prompts.version}) ilike ${pattern}`,
        ilike(jobs.pdfTemplate, pattern),
        templateKeys.length ? inArray(jobs.pdfTemplate, templateKeys) : undefined,
      ),
    };
    const match = query.field === "all" ? or(...Object.values(byField)) : byField[query.field];
    if (match) conditions.push(match);
  }
  return conditions;
}

export async function readJobsPage(managerId: string, query: JobsQuery, today: string) {
  const latest = latestAttempts(managerId);
  const stage = stageSql(latest);
  const where = filters(managerId, query, today);
  const stages = tabStages[query.tab as JobTab];
  const pageWhere = stages ? [...where, inArray(stage, stages)] : where;

  const readRows = (page: number) => db.with(latest).select({
    id: jobs.id,
    title: jobs.jobTitle,
    company: jobs.company,
    description: effectiveJobDescription(),
    location: jobs.location,
    employmentType: jobs.employmentType,
    workplaceType: jobs.workplaceType,
    salary: jobs.salary,
    jobReason: jobs.jobReason,
    url: jobs.jobUrl,
    date: jobs.date,
    status: jobs.status,
    failureReason: jobs.failureReason,
    resumeLocalPath: jobs.resumeLocalPath,
    googleDrivePath: jobs.googleDrivePath,
    createdAt: jobs.createdAt,
    applyRuns: sql<ApplyRun[] | null>`${jobs.applyAnswers}`,
    generationStatus: sql<string>`case
      when ${generationHeldSql()} then 'processing'
      when ${jobs.generationStatus} = 'processing' then 'ready'
      else ${jobs.generationStatus}::text
    end`,
    generationError: jobs.generationError,
    candidateId: jobs.candidateId,
    firstName: profiles.firstName,
    lastName: profiles.lastName,
    promptName: prompts.name,
    promptVersion: prompts.version,
    pdfTemplate: jobs.pdfTemplate,
    stage,
    // Where this row runs when several Chromes work, and how its latest application went.
    generationBrowserName: sql<string | null>`(
      select b.name from extension_browsers b where b.id = ${jobs.generationBrowserId}
    )`,
    attemptId: latest.attemptId,
    attemptStatus: latest.attemptStatus,
    attemptReason: latest.attemptReason,
    attemptReturns: latest.returns,
    attemptBrowserName: sql<string | null>`(
      select b.name from extension_browsers b where b.id = ${latest.attemptBrowserId}
    )`,
  })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .leftJoin(prompts, eq(prompts.id, jobs.promptId))
    .leftJoin(latest, eq(latest.jobId, jobs.id))
    .where(and(...pageWhere))
    .orderBy(desc(jobs.date), desc(jobs.createdAt), desc(jobs.id))
    .limit(query.size)
    .offset((page - 1) * query.size);

  const [stageRows, firstRows] = await Promise.all([
    db.with(latest).select({ stage, count: sql<number>`count(*)::int` })
      .from(jobs)
      .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
      .leftJoin(prompts, eq(prompts.id, jobs.promptId))
      .leftJoin(latest, eq(latest.jobId, jobs.id))
      .where(and(...where))
      .groupBy(sql`1`),
    readRows(query.page),
  ]);
  const counts = tabCounts(Object.fromEntries(stageRows.map((row) => [row.stage, row.count])));
  const total = counts[query.tab];
  const pageCount = Math.max(1, Math.ceil(total / query.size));
  // A page past the end (rows were removed since the link was made) shows the last page instead.
  const page = Math.min(query.page, pageCount);
  const rows = page === query.page ? firstRows : await readRows(page);

  return {
    counts,
    total,
    page,
    rows: rows.map((row) => ({
      ...row,
      applyAttempt: row.attemptId && row.attemptStatus
        ? {
          id: row.attemptId,
          status: row.attemptStatus,
          reason: row.attemptReason,
          browser: row.attemptBrowserName,
          returns: row.attemptReturns ?? 0,
        } satisfies ApplyAttemptSummary
        : null,
    })),
  };
}
