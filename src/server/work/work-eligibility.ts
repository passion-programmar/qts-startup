import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { jobs, profiles } from "@/db/schema";
import { generationFree } from "@/server/generation/generation-hold";
import { hasEffectiveJobDescription } from "@/server/jobs/job-description";
import { jobHasBid } from "@/server/jobs/job-bids";

export const hasMatchingNote = () => sql`length(regexp_replace(coalesce(${profiles.jdMatching}, ''), ${"\\s"}, '', 'g')) > 0`;

export function readyGeneration(now = new Date()) {
  return and(ne(jobs.generationStatus, "completed"), generationFree(now),
    isNull(jobs.resumeLocalPath), hasEffectiveJobDescription(), hasMatchingNote());
}

// Mirrors claim_apply_attempt eligibility; claiming still uses that existing locked function.
export function readyAutoApply() {
  return and(eq(jobs.generationStatus, "completed"), sql`${jobs.resumeLocalPath} is not null`,
    ne(jobs.status, "applied"), sql`not ${jobHasBid()}`,
    sql`not exists (select 1 from apply_attempts a where a.job_id = ${jobs.id}
      and (a.status in ('waiting_confirmation', 'submitting', 'confirmed', 'not_confirmed', 'failed', 'skipped')
        or (a.status in ('claimed', 'waiting_review') and a.lease_expires_at > now())))`,
    sql`(select count(*) from apply_attempts a where a.job_id = ${jobs.id} and a.status = 'released') < 2`);
}
