import { and, eq, ne, or, sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { db } from "@/lib/db";

// Apply status lives on jobs.status and bids: a row is "applied" exactly when its
// account has a bid for the job, the bid made from this row or one with the same
// URL or title + company.

const normalizedUrl = (url: typeof jobs.jobUrl | typeof bids.jobUrl | string) =>
  sql`regexp_replace(split_part(btrim(${url}), '#', 1), '/+$', '')`;

export function jobHasBid() {
  return sql<boolean>`exists (
    select 1 from ${bids}
     where ${bids.sourceJobId} = ${jobs.id}
        or (${bids.managerId} = ${jobs.managerId}
            and ${bids.candidateId} = ${jobs.candidateId}
            and (${normalizedUrl(bids.jobUrl)} = ${normalizedUrl(jobs.jobUrl)}
                 or ${bids.titleCompanyKey} = ${jobs.titleCompanyKey}))
  )`;
}

/** The latest delivered Generation run of a jobs row, for the bid made from it. */
export function deliveredGenerationRunId(jobId: string) {
  return sql<string | null>`(
    select r.id from generation_runs r
     where r.job_id = ${jobId} and r.status = 'delivered'
     order by r.created_at desc limit 1
  )`;
}

/** Rows of this account that have a bid become Applied. For a db.batch, after the bid write. */
export function markRowsWithBidApplied(managerId: string, candidateId: string) {
  return db.update(jobs).set({ status: "applied", updatedAt: new Date() }).where(and(
    eq(jobs.managerId, managerId),
    eq(jobs.candidateId, candidateId),
    ne(jobs.status, "applied"),
    jobHasBid(),
  ));
}

/** Rows a removed or moved bid covered go back to To do when no bid is left. For a db.batch, after the bid write. */
export function resetRowsWithoutBid(
  managerId: string,
  bid: { candidateId: string; sourceJobId: string; jobUrl: string; titleCompanyKey: string | null },
) {
  return db.update(jobs).set({ status: "todo", updatedAt: new Date() }).where(and(
    eq(jobs.managerId, managerId),
    eq(jobs.candidateId, bid.candidateId),
    eq(jobs.status, "applied"),
    or(
      eq(jobs.id, bid.sourceJobId),
      sql`${normalizedUrl(jobs.jobUrl)} = ${normalizedUrl(bid.jobUrl)}`,
      ...(bid.titleCompanyKey ? [eq(jobs.titleCompanyKey, bid.titleCompanyKey)] : []),
    ),
    sql`not ${jobHasBid()}`,
  ));
}
