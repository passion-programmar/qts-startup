import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { jobs, profiles } from "@/db/schema";
import { generationFree } from "@/server/generation/generation-hold";
import { hasEffectiveJobDescription } from "@/server/jobs/job-description";
import { jobHasBid } from "@/server/jobs/job-bids";

export const hasMatchingNote = () => sql`length(regexp_replace(coalesce(${profiles.jdMatching}, ''), ${"\\s"}, '', 'g')) > 0`;
export const hasEligibleExperienceCount = () => sql`exists (
  select 1 from experiences e
  where e.profile_user_id = ${profiles.userId}
  group by e.profile_user_id
  having count(*) >= 3
)`;

// The job-level half of Generation readiness; the account-level half is the matching note and experience.
export function readyGenerationJob(now = new Date()): SQL {
  return and(ne(jobs.generationStatus, "completed"), generationFree(now),
    isNull(jobs.resumeLocalPath), hasEffectiveJobDescription()) as SQL;
}

export function readyGeneration(now = new Date(), requireMatchingNote = true) {
  return and(readyGenerationJob(now),
    requireMatchingNote ? hasMatchingNote() : sql`true`,
    hasEligibleExperienceCount());
}

// Manual Apply: the job conditions of claim_apply_attempt (drizzle/0083) when not Auto Apply.
export function readyApply(): SQL {
  return and(sql`${jobs.resumeLocalPath} is not null`, eq(jobs.generationStatus, "completed"), ne(jobs.status, "applied"),
    sql`not ${jobHasBid()}`,
    sql`not exists (select 1 from apply_attempts x where x.job_id = ${jobs.id}
      and x.status in ('claimed', 'waiting_review', 'waiting_confirmation', 'submitting', 'confirmed', 'not_confirmed', 'failed', 'skipped'))`,
    sql`(select count(*) from apply_attempts r where r.job_id = ${jobs.id} and r.status = 'released') < 2`) as SQL;
}

// Auto Apply exposes every resumable job without a bid. Live claims remain visible in the picker
// so they can be shown disabled, while the locked claim function prevents concurrent processing.
export function readyAutoApply() {
  return and(sql`${jobs.resumeLocalPath} is not null`, sql`not ${jobHasBid()}`);
}
