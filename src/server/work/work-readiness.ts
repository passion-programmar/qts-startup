import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { applyAttempts, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { matchesManagerCustomUrl } from "@/server/work/custom-urls";
import { readyApply, readyAutoApply, readyGenerationJob } from "@/server/work/work-eligibility";

export type ReadyKind = "apply" | "auto_apply" | "generation";

export function isReadyKind(value: unknown): value is ReadyKind {
  return value === "apply" || value === "auto_apply" || value === "generation";
}

/**
 * How many of this Manager's jobs a Chrome could take now for one mode, asked with the Chrome's
 * heartbeat so the heavier claim runs only when there is work (2026-11-27). It counts a little more
 * than a claim would find (each Chrome's own skips are not applied), never less: a 0 is safe to trust.
 * scoped: the Chrome works on chosen jobs or a chosen candidate, which may include a Custom URL job
 * that an unscoped claim skips, so those are counted too.
 * key: a fingerprint of which jobs are ready (the same set gives the same key, in any order). After
 * a claim that found nothing (the only ready job is one this Chrome skips), the Chrome claims again
 * only when the key changes, instead of on every check.
 */
export function readyWorkCount(managerId: string, kind: ReadyKind, scoped: boolean, now = new Date()) {
  const customUrlSkipped = scoped ? sql`true` : sql`not ${matchesManagerCustomUrl(managerId, jobs.jobUrl)}`;
  // Auto Apply: a job another Chrome holds right now cannot be taken; one whose hold ran out can.
  const heldNow = sql`exists (
    select 1 from ${applyAttempts} held
    where held.job_id = ${jobs.id}
      and held.status in ('claimed', 'waiting_review')
      and held.lease_expires_at > now()
  )`;
  const condition = kind === "generation"
    ? readyGenerationJob(now)
    : kind === "apply"
      ? and(readyApply(), customUrlSkipped)
      : and(readyAutoApply(), sql`not ${heldNow}`, customUrlSkipped);
  return db.select({
    count: sql<number>`count(*)::int`,
    key: sql<string>`coalesce(sum(hashtextextended(${jobs.id}::text, 0)), 0)::text`,
  })
    .from(jobs)
    .where(and(eq(jobs.managerId, managerId), condition));
}
