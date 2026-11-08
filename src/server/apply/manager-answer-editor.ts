import { sql } from "drizzle-orm";
import { canShareQuestion, parseCorrection, profileField, type AnswerVariant } from "./manager-answer-values";
import { variantUpdate } from "./manager-answer-sql";
import { type Representation } from "../../../extension/shared/answer-representations.js";
import identity from "../../../extension/shared/answer-identity.js";
import semantics from "../../../extension/shared/semantic-fields.js";
import { identityEnabled, identityMetadata, semanticWriteGuard } from "./answer-identity";
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function moveAnswerQuery(managerId: string, answerId: string, question: string, version: string, normalApply = false) {
  return sql`update manager_apply_answers set scope = 'manager', context_key = 'manager',
    candidate_id = null, job_id = null, updated_at = clock_timestamp()
    where id = ${answerId}::uuid and manager_id = ${managerId}::uuid and scope = 'application'
      and question_text = ${question} and extract(epoch from updated_at)::text = ${version}
      and ${normalApply ? semanticWriteGuard(managerId, sql`'manager'`, question, answerId) : sql`true`}
    returning id`;
}

export type AnswerOwner = { managerId: string; browserId: string; authVersion: number };
export type AnswerEdit = { action: "save"; id: string | null; version: string | null; question: string; questionKey: string; answer: string; kind: string; options: string[]; policyContext?: string; representation?: Representation; variation?: AnswerVariant; scope: "manager" | "candidate" | "application"; profileField: ReturnType<typeof profileField> }
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
  if (raw.confirmVariation === true) {
    if (!identityEnabled()) return "Field-variation saving is disabled during rollback. Your existing answers are unchanged.";
    if (!id || typeof raw.fieldQuestion !== "string" || !identity.same(String(raw.question), raw.fieldQuestion)) return "Choose an existing answer with the same meaning and context before confirming a variation.";
    const variant = parseCorrection({ ...raw, question: raw.fieldQuestion }, { normalApply: true });
    if (typeof variant === "string") return variant;
    return { action: "save", id: id as string, version: version as string, question: String(raw.question), questionKey: "", answer: "", kind: variant.kind,
      options: variant.options, scope: variant.scope, profileField: null,
      variation: { kind: variant.kind, options: variant.options, answer: variant.answer, ...identityMetadata(raw.fieldQuestion), ...(variant.representation ? { representation: variant.representation } : {}) } };
  }
  const parsed = parseCorrection(raw, { normalApply: true });
  if (typeof parsed === "string") return parsed;
  // Applying never changes the candidate's profile (decision 2026-11-07): a question the profile
  // answers (name, email, phone, city, LinkedIn…) is not saved from the Apply panel.
  if (profileField(parsed.questionText, true)) return "This is a profile fact. Change it on the candidate's Profile page; applying never changes the profile.";
  // New unknown questions stay local. Sharing is an explicit, separate confirmation.
  if (raw.confirmShared === true && !canShareQuestion(parsed.questionText, true)) return "Personal or contextual answers cannot be shared.";
  // The panel's question list names the level the Manager chose: this job, this candidate, or all
  // candidates (2026-11-06). Identity facts are never saved for all candidates.
  const level = raw.level === "application" || raw.level === "candidate" || raw.level === "manager" ? raw.level : null;
  if (level === "manager" && !canShareQuestion(parsed.questionText, true)) return "This question is personal to each candidate. Save it for this candidate or this job.";
  const scope = level ?? (raw.confirmShared === true ? "manager" : parsed.scope);
  return { action: "save", id: id as string | null, version: version as string | null, question: parsed.questionText,
    questionKey: parsed.questionKey, answer: parsed.answer, kind: parsed.kind, options: parsed.options, policyContext: parsed.policyContext, representation: parsed.representation, scope, profileField: profileField(parsed.questionText, true) };
}

// One locked attempt authorizes both reads and writes. Browser/candidate IDs never come from UI.
export function answerAttemptQuery(owner: AnswerOwner, attemptId: string, lock = false) {
  return sql`select a.candidate_id as "candidateId", a.job_id as "jobId",
    jsonb_build_object('firstName', p.first_name, 'lastName', p.last_name, 'email', p.candidate_email,
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

/**
 * [Use] in the Normal Apply panel (decision 2026-11-07): links a site's wording to an existing saved
 * answer, so that wording is answered by itself next time. Adds { questionText, kind, options, answer }
 * to the answer's variants (at most 40 kept); the answer itself never changes. Only an answer this
 * application may use: the Manager's own, this candidate's, or this job's. A wording already linked is
 * left as it is. Returns the query, or the reason the request is refused.
 */
export function linkWordingQuery(managerId: string, held: { candidateId: string; jobId: string }, input: unknown) {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const question = typeof raw.question === "string" ? raw.question.replace(/\s+/g, " ").trim() : "";
  if (!isUuid(raw.id)) return "Choose the saved answer to use.";
  if (!question || question.length > 300) return "The question must be 1 to 300 characters.";
  const kind = typeof raw.kind === "string" && /^[a-z-]{1,30}$/.test(raw.kind) ? raw.kind : "text";
  const options = Array.isArray(raw.options) ? raw.options.filter((option): option is string => typeof option === "string").map((option) => option.slice(0, 200)).slice(0, 100) : [];
  return sql`update manager_apply_answers
    set variants = (case when jsonb_array_length(variants) >= 40 then variants - 0 else variants end)
      || jsonb_build_array(jsonb_build_object('questionText', ${question}::text, 'kind', ${kind}::text, 'options', ${JSON.stringify(options)}::jsonb, 'answer', answer)),
      updated_at = clock_timestamp()
    where id = ${raw.id}::uuid and manager_id = ${managerId}::uuid
      and (scope = 'manager' or (scope = 'candidate' and candidate_id = ${held.candidateId}::uuid)
        or (scope = 'application' and candidate_id = ${held.candidateId}::uuid and job_id = ${held.jobId}::uuid))
      and lower(question_text) <> lower(${question}::text)
      and not exists (select 1 from jsonb_array_elements(variants) v where lower(v->>'questionText') = lower(${question}::text))
    returning id`;
}

export function editAnswerQuery(owner: AnswerOwner, attemptId: string, edit: AnswerEdit, knownRows: {questionText: string}[] = []) {
  const held = answerAttemptQuery(owner, attemptId, true);
  const allowed = sql`manager_id = ${owner.managerId}::uuid and (
    scope = 'manager' or (candidate_id = (select "candidateId" from held)
      and ((scope = 'candidate' and job_id is null) or (scope = 'application' and job_id = (select "jobId" from held)))))`;
  if (edit.action === "delete") return sql`with held as materialized (${held}), changed as (
    delete from manager_apply_answers where exists(select 1 from held) and ${allowed}
      and id = ${edit.id}::uuid and extract(epoch from updated_at)::text = ${edit.version} returning id
    ) select id from changed`;
  if (edit.variation) return sql`with held as materialized (${held}), changed as (
    update manager_apply_answers set variants = ${variantUpdate(edit.variation, edit.variation.answer, true, true)}, updated_at = clock_timestamp()
    where exists(select 1 from held) and ${allowed}
      and scope in (select jsonb_array_elements_text(${JSON.stringify(semantics.recognize(edit.question)?.definition?.allowedScopes || [])}::jsonb)) and id = ${edit.id}::uuid
      and question_text = ${edit.question} and extract(epoch from updated_at)::text = ${edit.version}
    returning id, scope) select id, scope from changed`;
  const nextVariant = { kind: edit.kind, options: edit.options, answer: edit.answer, ...identityMetadata(edit.question), ...(edit.policyContext ? { policyContext: edit.policyContext } : {}), ...(edit.representation ? { representation: edit.representation } : {}) };
  const context = sql`case when ${edit.scope} = 'manager' then 'manager' when ${edit.scope} = 'candidate' then 'candidate:' || "candidateId"::text else 'job:' || "jobId"::text || ':' || "candidateId"::text end`;
  const guard = semanticWriteGuard(owner.managerId, context, edit.question, null, knownRows);
  const variant = JSON.stringify([nextVariant]);
  const write = edit.id ? sql`update manager_apply_answers set answer = ${edit.answer},
    variants = ${variantUpdate(nextVariant)}, updated_at = clock_timestamp()
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
      ${edit.questionKey}, ${edit.question}, ${edit.answer}, ${variant}::jsonb from held where ${guard}
    on conflict (manager_id, context_key, question_key) do nothing returning id, candidate_id, scope`;
  const profile = edit.profileField ? sql`, profile_change as (
    update profiles set ${sql.identifier(edit.profileField === "firstName" ? "first_name" : edit.profileField === "lastName" ? "last_name" : edit.profileField === "candidateEmail" ? "candidate_email" : edit.profileField === "linkedinUrl" ? "linkedin_url" : edit.profileField)} = ${edit.answer}, updated_at = clock_timestamp()
    where user_id = (select "candidateId" from held)
      and exists(select 1 from changed where scope = 'candidate' and candidate_id = profiles.user_id) returning user_id
  )` : sql``;
  return sql`with held as materialized (${held}), changed as (${write}) ${profile} select id, scope from changed`;
}
