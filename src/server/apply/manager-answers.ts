import "server-only";
import { and, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { managerApplyAnswers, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { loadApprovedReusableAnswers } from "./reusable-answers";
import { answerMeaning, type AnswerVariant, canShareQuestion, correctionKey, parseCorrection, profileField } from "./manager-answer-values";

// Merge against the row locked by ON CONFLICT, not an earlier read: two application tabs can save
// wording variants concurrently. A different answer meaning clears the previous variants.
export function variantUpdate(next: AnswerVariant) {
  const normalized = sql`lower(regexp_replace(btrim(${managerApplyAnswers.answer}), '\\s+', ' ', 'g'))`;
  const meaning = sql`case when ${normalized} in ('linkedin', 'linkedin job post', 'linkedin job posting', 'linkedin job board') then 'linkedin job post' else ${normalized} end`;
  return sql<AnswerVariant[]>`(
    select coalesce(jsonb_agg(kept.value order by kept.ord), '[]'::jsonb)
    from (
      select saved.value, saved.ord
      from jsonb_array_elements(case when ${meaning} = ${answerMeaning(next.answer)} then ${managerApplyAnswers.variants} else '[]'::jsonb end)
        with ordinality as saved(value, ord)
      where not (saved.value->>'kind' = ${next.kind}
        and saved.value->'options' @> ${JSON.stringify(next.options)}::jsonb
        and ${JSON.stringify(next.options)}::jsonb @> saved.value->'options')
      order by saved.ord desc limit 29
    ) as kept
  ) || ${JSON.stringify([next])}::jsonb`;
}

export async function listManagerAnswers(managerId: string) {
  const rows = await db.select({ ...getTableColumns(managerApplyAnswers), candidateName: sql<string | null>`nullif(concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}), '')` })
    .from(managerApplyAnswers).leftJoin(profiles, eq(profiles.userId, managerApplyAnswers.candidateId))
    .where(eq(managerApplyAnswers.managerId, managerId)).orderBy(desc(managerApplyAnswers.updatedAt));
  return rows.map((row) => ({ ...row, canReuse: row.scope === "application" && canShareQuestion(row.questionText) }));
}

export async function loadApplicationAnswers(managerId: string, candidateId: string, jobId: string) {
  const [globals, local] = await Promise.all([
    loadApprovedReusableAnswers(),
    db.select().from(managerApplyAnswers).where(and(eq(managerApplyAnswers.managerId, managerId), or(
      eq(managerApplyAnswers.scope, "manager"),
      and(eq(managerApplyAnswers.candidateId, candidateId), isNull(managerApplyAnswers.jobId)),
      and(eq(managerApplyAnswers.candidateId, candidateId), eq(managerApplyAnswers.jobId, jobId)),
    ))).orderBy(desc(managerApplyAnswers.updatedAt)),
  ]);
  return [
    // Mapped contact facts are read from the current profile. A later profile edit must not be
    // overwritten by an older saved correction; the row remains visible in the Manager's library.
    ...local.filter((row) => row.scope === "application" || (row.scope === "candidate" && !profileField(row.questionText))).map((row) => ({ ...row, note: null })),
    ...globals.map((row) => ({ ...row, questionKey: correctionKey(row.questionText), scope: "everyone" as const })),
    ...local.filter((row) => row.scope === "manager").map((row) => ({ ...row, note: null })),
  ];
}

export async function saveManagerCorrection(managerId: string, candidateId: string, jobId: string, raw: unknown) {
  const parsed = parseCorrection(raw);
  if (typeof parsed === "string") return { ok: false as const, reason: parsed };
  const { questionKey, questionText, answer, scope: suggestedScope, kind, options } = parsed;
  const global = suggestedScope === "manager" && (await loadApprovedReusableAnswers()).some((row) => correctionKey(row.questionText) === questionKey);
  const scope = global ? "application" : suggestedScope;
  const contextKey = scope === "manager" ? "manager" : scope === "candidate" ? `candidate:${candidateId}` : `job:${jobId}:${candidateId}`;
  const variants = [{ kind, options, answer }];
  const write = db.insert(managerApplyAnswers).values({
    managerId, candidateId: scope === "manager" ? null : candidateId, jobId: scope === "application" ? jobId : null,
    contextKey, scope, questionKey, questionText, answer, variants,
  }).onConflictDoUpdate({
    target: [managerApplyAnswers.managerId, managerApplyAnswers.contextKey, managerApplyAnswers.questionKey],
    set: { answer, questionText, variants: variantUpdate(variants[0]), updatedAt: new Date() },
  }).returning();
  const field = profileField(questionText);
  // Owner is checked again on the profile update; never accept candidate IDs from the extension.
  const [row] = field
    ? await db.batch([write, db.update(profiles).set({ [field]: answer, updatedAt: new Date() }).where(and(eq(profiles.userId, candidateId), sql`exists (select 1 from ${users} where ${users.id} = ${candidateId} and ${users.parentUserId} = ${managerId})`))]).then(([rows]) => rows)
    : await write;
  return { ok: true as const, id: row.id, question: questionText, answer, scope, profileField: field,
    globalOverride: Boolean(global), variants: row.variants, canReuse: scope === "application" && !global && canShareQuestion(questionText) };
}

export async function makeManagerReusable(managerId: string, answerId: string) {
  const [row] = await db.select().from(managerApplyAnswers).where(and(eq(managerApplyAnswers.id, answerId), eq(managerApplyAnswers.managerId, managerId))).limit(1);
  if (!row) return { ok: false as const, reason: "Answer not found." };
  if (row.scope === "manager") return { ok: true as const };
  if (row.scope === "candidate" || !canShareQuestion(row.questionText)) return { ok: false as const, reason: "Personal facts must stay specific to this candidate or application context." };
  await db.batch([
    db.insert(managerApplyAnswers).values({ managerId, scope: "manager", contextKey: "manager", questionKey: row.questionKey, questionText: row.questionText, answer: row.answer, variants: row.variants })
      .onConflictDoUpdate({ target: [managerApplyAnswers.managerId, managerApplyAnswers.contextKey, managerApplyAnswers.questionKey], set: { answer: row.answer, variants: row.variants, updatedAt: new Date() } }),
    db.delete(managerApplyAnswers).where(and(eq(managerApplyAnswers.id, row.id), eq(managerApplyAnswers.managerId, managerId))),
  ]);
  return { ok: true as const };
}
