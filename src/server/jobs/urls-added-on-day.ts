import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { bids, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { ROMANIA_TIME_ZONE } from "@/lib/romania-time";
import { jobHasBid } from "@/server/jobs/job-bids";

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every job URL a Manager added on one day (Romania time), for Export today's URLs: the jobs dated that
 * day that are on the Jobs page (a job with a bid is on the Bids page instead), and the bids created
 * that day. Both read at once, newest first; the button keeps each URL once.
 */
export async function readUrlsAddedOnDay(managerId: string, day: string): Promise<{ url: string; date: string }[]> {
  if (!dayPattern.test(day)) return [];
  const [jobRows, bidRows] = await Promise.all([
    db.select({ url: jobs.jobUrl, at: jobs.createdAt })
      .from(jobs)
      .where(and(eq(jobs.managerId, managerId), eq(jobs.date, day), sql`not ${jobHasBid()}`)),
    db.select({ url: bids.jobUrl, at: bids.createdAt })
      .from(bids)
      .where(and(eq(bids.managerId, managerId), sql`(${bids.createdAt} at time zone ${ROMANIA_TIME_ZONE})::date = ${day}::date`)),
  ]);
  return [...jobRows, ...bidRows]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((row) => ({ url: row.url, date: day }));
}
