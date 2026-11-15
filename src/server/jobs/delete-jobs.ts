import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { jobHasBid } from "@/server/jobs/job-bids";

/** The most jobs one "Delete selected" may remove (a Jobs page shows at most 50). */
export const MAX_JOBS_PER_DELETE = 100;

/** How a "Delete selected" went: how many were deleted, and why the rest were kept. */
export type DeleteJobsResult = {
  deleted: number;
  /** Still making their résumé: Generation must be cancelled first. */
  generating: number;
  /** Their candidate applied (a bid exists); they belong to the Bids page. */
  applied: number;
  /** Not found among this Manager's jobs (already deleted, or changed meanwhile). */
  other: number;
};

/**
 * Deletes the chosen jobs of one Manager in one statement, with the same rules as deleting one job:
 * only the Manager's own jobs, none still making its résumé, none with a bid. The jobs that stay are
 * read once afterwards, only when some stayed, to say why.
 */
export async function deleteManagerJobs(managerId: string, ids: string[]): Promise<DeleteJobsResult> {
  if (ids.length === 0) return { deleted: 0, generating: 0, applied: 0, other: 0 };
  const appliedBid = jobHasBid();
  const deleted = await db.delete(jobs).where(and(
    inArray(jobs.id, ids),
    eq(jobs.managerId, managerId),
    ne(jobs.generationStatus, "processing"),
    sql`not ${appliedBid}`,
  )).returning({ id: jobs.id });
  if (deleted.length === ids.length) return { deleted: deleted.length, generating: 0, applied: 0, other: 0 };

  const gone = new Set(deleted.map((row) => row.id));
  const keptIds = ids.filter((id) => !gone.has(id));
  const kept = await db.select({ generationStatus: jobs.generationStatus, hasBid: sql<boolean>`${appliedBid}` })
    .from(jobs)
    .where(and(inArray(jobs.id, keptIds), eq(jobs.managerId, managerId)));
  const generating = kept.filter((row) => row.generationStatus === "processing").length;
  const applied = kept.filter((row) => row.generationStatus !== "processing" && row.hasBid).length;
  return { deleted: deleted.length, generating, applied, other: keptIds.length - generating - applied };
}

const jobsWord = (count: number) => `${count} ${count === 1 ? "job" : "jobs"}`;

/** One short message for the Jobs page: what was deleted, then why any jobs were kept. */
export function deleteJobsMessage(result: DeleteJobsResult): string {
  const parts = [result.deleted > 0 ? `Deleted ${jobsWord(result.deleted)}.` : "No jobs were deleted."];
  if (result.generating) parts.push(`Kept ${jobsWord(result.generating)} still making a résumé: cancel Generation first.`);
  if (result.applied) parts.push(`Kept ${jobsWord(result.applied)} with a bid: they belong to the Bids page.`);
  if (result.other) parts.push(`${jobsWord(result.other)} could not be found: refresh the page.`);
  return parts.join(" ");
}
