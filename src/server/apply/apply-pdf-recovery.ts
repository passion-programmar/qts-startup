import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { applyAttempts, extensionBrowsers, generationRuns, jobs, profiles, users } from "@/db/schema";
import { jobHasBid } from "@/server/jobs/job-bids";

export type RecoveryOwner = { managerId: string; browserId: string; authVersion: number };
export type RecoveryContext = {
  attemptId: string; jobId: string; generationId: string; candidateName: string;
  title: string; company: string; resumePath: string; coverLetterPath: string | null;
};
export type RelinkInput = {
  attemptId: string; generationId: string; expectedResumePath: string;
  expectedCoverLetterPath: string | null; resumePath: string; coverLetterPath: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Exact relative names only: no decoding, trimming, suffix inference, or current-name matching. */
export function pdfParent(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500 || !value.startsWith("QTS_Resume/")
    || /[\\\u0000-\u001f\u007f:<>"|?*]/.test(value) || !/\.pdf$/i.test(value)) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))) return null;
  return parts.slice(0, -1).join("/");
}

export function parseRelinkInput(value: unknown): RelinkInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  // Do not accept document content, arbitrary extra metadata, or an incomplete old-path precondition.
  const keys = ["attemptId", "generationId", "expectedResumePath", "expectedCoverLetterPath", "resumePath", "coverLetterPath"];
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) return null;
  if (typeof input.attemptId !== "string" || !UUID.test(input.attemptId)
    || typeof input.generationId !== "string" || !UUID.test(input.generationId)) return null;
  if (input.expectedCoverLetterPath !== null && input.expectedCoverLetterPath !== "") return null;
  const parent = pdfParent(input.expectedResumePath);
  if (!parent || pdfParent(input.resumePath) !== parent || pdfParent(input.coverLetterPath) !== parent
    || input.resumePath === input.coverLetterPath) return null;
  return input as RelinkInput;
}

const manager = alias(users, "recovery_manager");
const candidate = alias(users, "recovery_candidate");

/** Also used inside the write transaction: a documents 404 is never write authorization. */
export function recoveryContextQuery(owner: RecoveryOwner, attemptId: string, lock = false) {
  return sql`
    select ${applyAttempts.id} as "attemptId", ${jobs.id} as "jobId", ${generationRuns.id} as "generationId",
      concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}) as "candidateName",
      ${jobs.jobTitle} as title, ${jobs.company} as company,
      ${jobs.resumeLocalPath} as "resumePath", ${jobs.coverLetterLocalPath} as "coverLetterPath"
    from ${applyAttempts}
    join ${jobs} on ${jobs.id} = ${applyAttempts.jobId}
    join ${users} as recovery_manager on ${manager.id} = ${jobs.managerId}
    join ${profiles} on ${profiles.userId} = ${jobs.candidateId} and ${profiles.userId} = ${applyAttempts.candidateId}
    join ${users} as recovery_candidate on ${candidate.id} = ${profiles.userId}
    join ${extensionBrowsers} on ${extensionBrowsers.id} = ${applyAttempts.browserId}
    join ${generationRuns} on ${generationRuns.id} = (
      select r.id from generation_runs r where r.job_id = ${jobs.id} and r.status = 'delivered'
      order by r.created_at desc, r.id desc limit 1
    )
    where ${applyAttempts.id} = ${attemptId} and ${applyAttempts.managerId} = ${owner.managerId}
      and ${jobs.managerId} = ${owner.managerId} and ${applyAttempts.browserId} = ${owner.browserId}
      and ${extensionBrowsers.managerId} = ${owner.managerId}
      and ${manager.role} = 'manager' and ${manager.blockedAt} is null
      and ${manager.authVersion} = ${owner.authVersion} and ${manager.canUseApply} = true
      and ${candidate.blockedAt} is null
      and ${applyAttempts.status} = 'waiting_review' and ${applyAttempts.leaseExpiresAt} > clock_timestamp()
      and ${applyAttempts.submitGrantedAt} is null and ${applyAttempts.finishedAt} is null
      and ${jobs.generationStatus} = 'completed' and ${jobs.status} <> 'applied'
      and (${jobs.generationLeaseExpiresAt} is null or ${jobs.generationLeaseExpiresAt} <= clock_timestamp())
      and ${generationRuns.managerId} = ${owner.managerId} and ${generationRuns.jobId} = ${jobs.id}
      and not ${jobHasBid()}
      and not exists (select 1 from generation_runs active_run where active_run.job_id = ${jobs.id}
        and active_run.status in ('pending', 'completed'))
    ${lock ? sql`for update of ${applyAttempts}, ${jobs}, ${manager}, ${profiles}, ${candidate}, ${extensionBrowsers}, ${generationRuns} nowait` : sql``}
  `;
}

/** Second statement in the SAME serializable transaction, after locking authorization rows. */
export function relinkUpdateQuery(owner: RecoveryOwner, input: RelinkInput) {
  return sql`
    with eligible as materialized (${recoveryContextQuery(owner, input.attemptId)}),
    changed as (
      update ${jobs} set resume_local_path = ${input.resumePath}, cover_letter_local_path = ${input.coverLetterPath}, updated_at = now()
      from eligible e where ${jobs.id} = e."jobId" and e."generationId" = ${input.generationId}
        and e."resumePath" = ${input.expectedResumePath}
        and e."coverLetterPath" is not distinct from ${input.expectedCoverLetterPath}::text
        and (${jobs.coverLetterLocalPath} is null or ${jobs.coverLetterLocalPath} = '')
      returning ${jobs.id}
    )
    select 'saved' as outcome from changed
    union all
    select 'unchanged' as outcome from eligible e
      where e."generationId" = ${input.generationId} and e."resumePath" = ${input.resumePath}
        and e."coverLetterPath" = ${input.coverLetterPath}
  `;
}
