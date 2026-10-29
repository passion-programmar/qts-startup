import { and, count, eq, sql } from "drizzle-orm";
import { bids, settings } from "@/db/schema";
import { db } from "@/lib/db";
import { getJobRecordDate, getJobRecordTimeZone } from "@/server/jobs/job-record-time-zone";

// Today's counts for the extension panel (URL · JOB · APPLY). Job rows are deleted after an
// application and by the daily clean-up, so the added ones are counted as they are saved: one
// settings row per Manager, { day, urls, jobs }, replaced on the first save of a new day.
// Applications are counted from the bids, which stay.

export function dailyJobCountsKey(managerId: string): string {
  return `daily_job_counts:${managerId}`;
}

/**
 * The counting statement for insertGetJdJob's transaction, run before its insert with the same
 * same-job parameters ($1-$5) and then $6 candidate, $7 Manager, $8 settings key, $9 record date.
 * A row the insert will add counts as a job; a job none of the Manager's candidates has yet
 * counts as a new URL too.
 */
export function dailyJobCountSql(sameJobSql: string): string {
  return `WITH flags AS (
      SELECT
        NOT EXISTS (SELECT 1 FROM jobs WHERE candidate_id = $6 AND ${sameJobSql}) AS adds_row,
        NOT EXISTS (SELECT 1 FROM jobs WHERE manager_id = $7 AND ${sameJobSql}) AS new_url
    )
    INSERT INTO settings (key, value)
    SELECT $8::text, jsonb_build_object('day', $9::text, 'urls', CASE WHEN new_url THEN 1 ELSE 0 END, 'jobs', 1)
      FROM flags WHERE adds_row
    ON CONFLICT (key) DO UPDATE SET
      value = CASE WHEN settings.value->>'day' = $9::text
        THEN jsonb_build_object(
          'day', $9::text,
          'urls', coalesce((settings.value->>'urls')::int, 0) + (EXCLUDED.value->>'urls')::int,
          'jobs', coalesce((settings.value->>'jobs')::int, 0) + 1)
        ELSE EXCLUDED.value END,
      updated_at = now()`;
}

export type DailyJobCounts = { day: string; urls: number; jobs: number; applied: number };

export async function readDailyJobCounts(managerId: string): Promise<DailyJobCounts> {
  const [day, timeZone] = await Promise.all([getJobRecordDate(), getJobRecordTimeZone()]);
  const [[saved], [applied]] = await Promise.all([
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, dailyJobCountsKey(managerId))).limit(1),
    db.select({ total: count() }).from(bids).where(and(
      eq(bids.managerId, managerId),
      sql`(${bids.appliedAt} AT TIME ZONE ${timeZone})::date = ${day}::date`,
    )),
  ]);
  const value = saved?.value as { day?: unknown; urls?: unknown; jobs?: unknown } | undefined;
  const today = value?.day === day;
  return {
    day,
    urls: today ? Number(value?.urls) || 0 : 0,
    jobs: today ? Number(value?.jobs) || 0 : 0,
    applied: Number(applied?.total) || 0,
  };
}
