import { sql } from "drizzle-orm";
import { canShareQuestion, parseCorrection, profileField } from "./manager-answer-values";
import { variantUpdate } from "./manager-answer-sql";
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export type AnswerOwner = { managerId: string; browserId: string; authVersion: number };
export type AnswerEdit = { action: "save"; id: string | null; version: string | null; question: string; questionKey: string; answer: string; kind: string; options: string[]; scope: "manager" | "candidate" | "application"; profileField: ReturnType<typeof profileField> }
  | { action: "delete"; id: string; version: string };

export function parseAnswerEdit(input: unknown): AnswerEdit | string {
  if (!input || typeof input !== "object") return "Choose an answer to save or delete.";
  const raw = input as Record<string, unknown>;
  const id = raw.id == null ? null : raw.id;
  const version = raw.version == null ? null : raw.version;
  if ((id !== null && !isUuid(id)) || (id !== null && (typeof version !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(version)))
    || (id === null && version !== null)) return "Reload answers before changing this saved answer.";
  if (raw.action === "delete") return id && typeof version === "string" ? { action: "delete", id, version } : "Choose a saved answer to delete.";
  if (raw.action !== "save") return "Unknown answer action.";
  const parsed = parseCorrection(raw);
  if (typeof parsed === "string") return parsed;
  const scope = canShareQuestion(parsed.questionText) ? "manager" : parsed.scope;
  return { action: "save", id: id as string | null, version: version as string | null, question: parsed.questionText,
    questionKey: parsed.questionKey, answer: parsed.answer, kind: parsed.kind, options: parsed.options, scope, profileField: profileField(parsed.questionText) };
}

// One locked attempt authorizes both reads and writes. Browser/candidate IDs never come from UI.
export function answerAttemptQuery(owner: AnswerOwner, attemptId: string, lock = false) {
  return sql`select a.candidate_id as "candidateId", a.job_id as "jobId",
    jsonb_build_object('firstName', p.first_name, 'lastName', p.last_name, 'email', coalesce(p.candidate_email, u.email),
      'phone', p.phone, 'city', p.city, 'linkedinUrl', p.linkedin_url) as profile
    from apply_attempts a join users u on u.id = a.candidate_id
    join profiles p on p.user_id = u.id
    join users m on m.id = a.manager_id
    join jobs j on j.id = a.job_id and j.manager_id = m.id and j.candidate_id = u.id
    join extension_browsers b on b.id = a.browser_id and b.manager_id = m.id
    where a.id = ${attemptId}::uuid and a.manager_id = ${owner.managerId}::uuid
      and a.browser_id = ${owner.browserId}::uuid and u.parent_user_id = ${owner.managerId}::uuid
      and m.role = 'manager' and m.blocked_at is null and m.can_use_apply = true and m.auth_version = ${owner.authVersion}
      and u.blocked_at is null and a.status in ('claimed', 'waiting_review') and a.lease_expires_at > clock_timestamp()
    ${lock ? sql`for update of a, u, m, j, b nowait` : sql``}`;
}

export function editAnswerQuery(owner: AnswerOwner, attemptId: string, edit: AnswerEdit) {
  const held = answerAttemptQuery(owner, attemptId, true);
  const allowed = sql`manager_id = ${owner.managerId}::uuid and (
    scope = 'manager' or (candidate_id = (select "candidateId" from held)
      and ((scope = 'candidate' and job_id is null) or (scope = 'application' and job_id = (select "jobId" from held)))))`;
  if (edit.action === "delete") return sql`with held as materialized (${held}), changed as (
    delete from manager_apply_answers where exists(select 1 from held) and ${allowed}
      and id = ${edit.id}::uuid and extract(epoch from updated_at)::text = ${edit.version} returning id
    ) select id from changed`;
  const variant = JSON.stringify([{ kind: edit.kind, options: edit.options, answer: edit.answer }]);
  const write = edit.id ? sql`update manager_apply_answers set answer = ${edit.answer},
    variants = ${variantUpdate({ kind: edit.kind, options: edit.options, answer: edit.answer })}, updated_at = clock_timestamp()
    where exists(select 1 from held) and ${allowed} and id = ${edit.id}::uuid
      and question_text = ${edit.question} and extract(epoch from updated_at)::text = ${edit.version}
    returning id, candidate_id, scope` : sql`insert into manager_apply_answers
      (manager_id, candidate_id, job_id, scope, context_key, question_key, question_text, answer, variants)
    select ${owner.managerId}::uuid,
      case when ${edit.scope} = 'manager' then null else "candidateId" end,
      case when ${edit.scope} = 'application' then "jobId" else null end,
      ${edit.scope}, case when ${edit.scope} = 'manager' then 'manager'
        when ${edit.scope} = 'candidate' then 'candidate:' || "candidateId"::text
        else 'job:' || "jobId"::text || ':' || "candidateId"::text end,
      ${edit.questionKey}, ${edit.question}, ${edit.answer}, ${variant}::jsonb from held
    on conflict (manager_id, context_key, question_key) do nothing returning id, candidate_id, scope`;
  const profile = edit.profileField ? sql`, profile_change as (
    update profiles set ${sql.identifier(edit.profileField === "firstName" ? "first_name" : edit.profileField === "lastName" ? "last_name" : edit.profileField === "candidateEmail" ? "candidate_email" : edit.profileField === "linkedinUrl" ? "linkedin_url" : edit.profileField)} = ${edit.answer}, updated_at = clock_timestamp()
    where user_id = (select "candidateId" from held)
      and exists(select 1 from changed where scope = 'candidate' and candidate_id = profiles.user_id) returning user_id
  )` : sql``;
  return sql`with held as materialized (${held}), changed as (${write}) ${profile} select id, scope from changed`;
}
