import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { db } from "@/lib/db";

export type GetJdDuplicateKind = "applied" | "job_list";

export async function findGetJdDuplicate(
  managerId: string,
  job: { jobUrl: string; jobTitle: string; company: string },
  candidateId?: string,
): Promise<GetJdDuplicateKind | null> {
  const duplicateConditions = (table: typeof jobs | typeof bids) => {
    const sameUrl = sql`regexp_replace(split_part(btrim(${table.jobUrl}), '#', 1), '/+$', '') = ${normalizeUrlForComparison(job.jobUrl)}`;
    const sameTitleAndCompany = job.jobTitle.trim() && job.company.trim()
      ? and(
        sql`lower(btrim(${table.jobTitle})) = ${job.jobTitle.trim().toLowerCase()}`,
        sql`lower(btrim(${table.company})) = ${job.company.trim().toLowerCase()}`,
      )
      : undefined;
    return sameTitleAndCompany
      ? or(sameUrl, sameTitleAndCompany)
      : sameUrl;
  };

  const [bid] = await db
    .select({ id: bids.id })
    .from(bids)
    .where(
      and(
        eq(bids.managerId, managerId),
        ...(candidateId ? [eq(bids.candidateId, candidateId)] : []),
        duplicateConditions(bids),
      ),
    )
    .limit(1);
  if (bid) return "applied";

  const [existingJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.managerId, managerId),
        ...(candidateId ? [eq(jobs.candidateId, candidateId)] : []),
        duplicateConditions(jobs),
      ),
    )
    .limit(1);
  return existingJob ? "job_list" : null;
}

function normalizeUrlForComparison(value: string): string {
  const normalized = new URL(value);
  normalized.hash = "";
  normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/";
  return normalized.href;
}
