import { and, isNull, ne, sql } from "drizzle-orm";
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

export function readyGeneration(now = new Date(), requireMatchingNote = true) {
  return and(ne(jobs.generationStatus, "completed"), generationFree(now),
    isNull(jobs.resumeLocalPath), hasEffectiveJobDescription(),
    requireMatchingNote ? hasMatchingNote() : sql`true`,
    hasEligibleExperienceCount());
}

// Auto Apply exposes every resumable job without a bid. Live claims remain visible in the picker
// so they can be shown disabled, while the locked claim function prevents concurrent processing.
export function readyAutoApply() {
  return and(sql`${jobs.resumeLocalPath} is not null`, sql`not ${jobHasBid()}`);
}
