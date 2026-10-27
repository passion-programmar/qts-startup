import "server-only";

import { and, count, eq, isNull, ne, or, sql } from "drizzle-orm";
import { jobs, users } from "@/db/schema";
import { db } from "@/lib/db";
import { romaniaClock } from "@/lib/romania-time";

// The daily clean-up: the first Get JD start after 4:00 PM Romania time, in any of the Manager's
// Chromes, asks "Clear applied jobs?". Yes deletes every Applied job row of that Manager; their bids
// are independent records and stay. The question is claimed in one step, so it is asked once a day.

export const APPLIED_CLEANUP_HOUR = 16;

/**
 * Whether this Get JD start should ask, and how many Applied rows there are. Claims today's
 * question for the Manager, so other Chromes starting now or later today are not asked again.
 */
export async function claimAppliedCleanupQuestion(managerId: string, now: Date = new Date()): Promise<{ ask: boolean; appliedCount: number }> {
  const { day, hour } = romaniaClock(now);
  if (hour < APPLIED_CLEANUP_HOUR) return { ask: false, appliedCount: 0 };
  const claimed = await db
    .update(users)
    .set({ appliedCleanupAskedOn: day })
    .where(and(
      eq(users.id, managerId),
      or(isNull(users.appliedCleanupAskedOn), ne(users.appliedCleanupAskedOn, day)),
    ))
    .returning({ id: users.id });
  if (!claimed.length) return { ask: false, appliedCount: 0 };
  const [row] = await db
    .select({ appliedCount: count() })
    .from(jobs)
    .where(and(eq(jobs.managerId, managerId), eq(jobs.status, "applied")));
  const appliedCount = Number(row?.appliedCount ?? 0);
  return { ask: appliedCount > 0, appliedCount };
}

/** "Yes, clear": deletes the Manager's Applied job rows (their Apply history goes with them). */
export async function clearAppliedJobs(managerId: string): Promise<number> {
  const deleted = await db
    .delete(jobs)
    .where(and(
      eq(jobs.managerId, managerId),
      eq(jobs.status, "applied"),
      sql`${jobs.generationStatus} <> 'processing'`,
    ))
    .returning({ id: jobs.id });
  return deleted.length;
}
