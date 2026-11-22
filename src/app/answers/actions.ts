"use server";

import { and, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { managerApplyAnswers } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { identityMetadata, semanticWriteGuard } from "@/server/apply/answer-identity";
import { addAlternative, unwrapVariant } from "@/server/apply/answer-variant-forms";
import { isUuid } from "@/server/apply/apply-route-auth";
import { canShareQuestion, correctionKey, mergeVariants, parseCorrection, type AnswerVariant } from "@/server/apply/manager-answer-values";

// The Answers page: one question with all its answers, saved or deleted in one go. The first answer
// is the main one (text boxes get it); the others are tried when it does not fit a box's choices.
// Every answer is for all the Manager's candidates and every job.

export type AnswerResult = { ok: true } | { ok: false; message: string };

const MAX_ANSWERS = 20;
const VERSION = /^\d{1,12}(?:\.\d{1,6})?$/;
const CHANGED = "This question was changed or deleted meanwhile. Reload the page; nothing was overwritten.";

const isAlternative = (entry: AnswerVariant) => {
  const real = unwrapVariant(entry);
  return real.kind === "alternative" && !(typeof real.site === "string" && real.site);
};

function cleanAnswers(values: unknown): string[] | string {
  if (!Array.isArray(values)) return "Write at least one answer.";
  const seen = new Set<string>();
  const answers = values.map((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""))
    .filter((value) => value && !seen.has(value.toLowerCase()) && seen.add(value.toLowerCase()));
  if (!answers.length) return "Write at least one answer.";
  if (answers.length > MAX_ANSWERS) return `At most ${MAX_ANSWERS} answers per question.`;
  return answers;
}

/** Adds a question with its answers, or saves an edited one (id + version: only the version the page showed). */
export async function saveAnswerAction(input: { id?: string; version?: string; question: string; answers: string[] }): Promise<AnswerResult> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ok: false, message: "Only Managers keep answers here." };
  const answers = cleanAnswers(input?.answers);
  if (typeof answers === "string") return { ok: false, message: answers };
  const parsed = parseCorrection({ question: input?.question, answer: answers[0], kind: "text" }, { normalApply: true });
  if (typeof parsed === "string") return { ok: false, message: parsed };
  if (!canShareQuestion(parsed.questionText, true)) {
    // Which kind of question it is, so the message says what to do.
    const companySpecific = /\b(?:this|that|our)\s+(?:company|employer|product|service|team)\b|\bwhy (?:do you want|are you interested|would you like)\b/i.test(parsed.questionText);
    return { ok: false, message: companySpecific
      ? "This question is about one company, so it cannot be one answer for every job. Leave it to Ask AI or answer it on that job."
      : "This is a fact about each candidate (name, contact, location, nationality, diversity…): it comes from the candidate's profile, not from Answers." };
  }
  const editing = input.id !== undefined;
  if (editing && (!isUuid(input.id) || typeof input.version !== "string" || !VERSION.test(input.version))) return { ok: false, message: CHANGED };
  try {
    const where = editing
      ? and(eq(managerApplyAnswers.id, input.id as string), eq(managerApplyAnswers.managerId, actor.id), sql`extract(epoch from ${managerApplyAnswers.updatedAt})::text = ${input.version}`)
      : undefined;
    const [current] = where ? await db.select({ variants: managerApplyAnswers.variants }).from(managerApplyAnswers).where(where).limit(1) : [];
    if (editing && !current) return { ok: false, message: CHANGED };
    // Site forms and question wordings the panel saved stay; the other answers are this list.
    let variants = mergeVariants((current?.variants ?? []).filter((entry) => !isAlternative(entry)),
      { kind: "text", options: [], answer: parsed.answer, ...identityMetadata(parsed.questionText) });
    for (const other of answers.slice(1)) {
      const added = addAlternative(variants, other, parsed.answer);
      if (added.ok) variants = added.variants;
      else if (!/already saved/.test(added.reason)) return { ok: false, message: added.reason };
    }
    if (where) {
      const changed = await db.update(managerApplyAnswers)
        .set({ questionKey: correctionKey(parsed.questionText), questionText: parsed.questionText, answer: parsed.answer, variants, updatedAt: sql`clock_timestamp()` })
        .where(where).returning({ id: managerApplyAnswers.id });
      if (!changed.length) return { ok: false, message: CHANGED };
    } else {
      const knownRows = await db.select({ questionText: managerApplyAnswers.questionText }).from(managerApplyAnswers).where(eq(managerApplyAnswers.managerId, actor.id));
      const guard = semanticWriteGuard(actor.id, sql`'manager'`, parsed.questionText, null, knownRows);
      const query = new PgDialect().sqlToQuery(sql`insert into manager_apply_answers(manager_id,scope,context_key,question_key,question_text,answer,variants)
        select ${actor.id}::uuid,'manager','manager',${parsed.questionKey},${parsed.questionText},${parsed.answer},${JSON.stringify(variants)}::jsonb
        where ${guard} on conflict do nothing returning id`);
      const [created] = await neonSql.transaction([neonSql.query(query.sql, query.params)], { isolationLevel: "Serializable" });
      if (!created.length) return { ok: false, message: "This question (or one meaning the same) is already in the list: add the answers there." };
    }
    revalidatePath("/answers");
    return { ok: true };
  } catch {
    return { ok: false, message: "The answer could not be saved. Reload the page and try again." };
  }
}

/** Deletes a question with all its answers (only the version the page showed). */
export async function deleteAnswerAction(input: { id: string; version: string }): Promise<AnswerResult> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ok: false, message: "Only Managers keep answers here." };
  if (!isUuid(input?.id) || typeof input?.version !== "string" || !VERSION.test(input.version)) return { ok: false, message: CHANGED };
  try {
    const removed = await db.delete(managerApplyAnswers).where(and(eq(managerApplyAnswers.id, input.id), eq(managerApplyAnswers.managerId, actor.id),
      sql`extract(epoch from ${managerApplyAnswers.updatedAt})::text = ${input.version}`)).returning({ id: managerApplyAnswers.id });
    if (!removed.length) return { ok: false, message: CHANGED };
    revalidatePath("/answers");
    return { ok: true };
  } catch {
    return { ok: false, message: "The question could not be deleted. Reload the page and try again." };
  }
}
