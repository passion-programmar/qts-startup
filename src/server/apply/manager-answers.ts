import "server-only";
import { and, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { managerApplyAnswers, profiles, users } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { canShareQuestion, parseCorrection, profileField } from "./manager-answer-values";
import { variantUpdate } from "./manager-answer-sql";
import { moveAnswerQuery } from "./manager-answer-editor";
export { variantUpdate } from "./manager-answer-sql";

export async function listManagerAnswers(managerId: string) {
  const rows = await db.select({ ...getTableColumns(managerApplyAnswers), version: sql<string>`extract(epoch from ${managerApplyAnswers.updatedAt})::text`, candidateName: sql<string | null>`nullif(concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}), '')` })
    .from(managerApplyAnswers).leftJoin(profiles, eq(profiles.userId, managerApplyAnswers.candidateId))
    .where(eq(managerApplyAnswers.managerId, managerId)).orderBy(desc(managerApplyAnswers.updatedAt));
  return rows.map((row) => ({ ...row, canReuse: row.scope === "application" && canShareQuestion(row.questionText, true) }));
}

export async function loadApplicationAnswers(managerId: string, candidateId: string, jobId: string, includeProfileFacts = false) {
  const local = await db.select({ ...getTableColumns(managerApplyAnswers), version: sql<string>`extract(epoch from ${managerApplyAnswers.updatedAt})::text` }).from(managerApplyAnswers).where(and(eq(managerApplyAnswers.managerId, managerId), or(
      eq(managerApplyAnswers.scope, "manager"),
      and(eq(managerApplyAnswers.candidateId, candidateId), isNull(managerApplyAnswers.jobId)),
      and(eq(managerApplyAnswers.candidateId, candidateId), eq(managerApplyAnswers.jobId, jobId)),
    ))).orderBy(desc(managerApplyAnswers.updatedAt));
  return [
    // Mapped contact facts are read from the current profile. A later profile edit must not be
    // overwritten by an older saved correction; the row remains visible in the Manager's library.
    ...local.filter((row) => row.scope === "application").map((row) => ({ ...row, note: null })),
    ...local.filter((row) => row.scope === "candidate" && (includeProfileFacts || !profileField(row.questionText))).map((row) => ({ ...row, note: null })),
    ...local.filter((row) => row.scope === "manager").map((row) => ({ ...row, note: null })),
  ];
}

export async function saveManagerCorrection(managerId: string, candidateId: string, jobId: string, raw: unknown) {
  const parsed = parseCorrection(raw);
  if (typeof parsed === "string") return { ok: false as const, reason: parsed };
  const { questionKey, questionText, answer, scope, kind, options } = parsed;
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
    globalOverride: false, variants: row.variants, canReuse: scope === "application" && canShareQuestion(questionText) };
}

export async function makeManagerReusable(managerId: string, answerId: string, version?: string, normalApply = false) {
  if (typeof version !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(version)) return { ok: false as const, reason: "Reload answers before sharing this answer." };
  const [row] = await db.select().from(managerApplyAnswers).where(and(eq(managerApplyAnswers.id, answerId), eq(managerApplyAnswers.managerId, managerId))).limit(1);
  if (!row) return { ok: false as const, reason: "Answer not found." };
  if (row.scope === "manager") return { ok: true as const };
  if (row.scope === "candidate" || !canShareQuestion(row.questionText, normalApply)) return { ok: false as const, reason: "Personal facts must stay specific to this candidate or application context." };
  // Move one row atomically. The unique index rejects an occupied shared destination.
  try {
    let changed;
    if (normalApply) {
      const query = new PgDialect().sqlToQuery(moveAnswerQuery(managerId, answerId, row.questionText, version, true));
      [changed] = await neonSql.transaction([neonSql.query(query.sql, query.params)], { isolationLevel: "Serializable" });
    } else changed = (await db.execute(moveAnswerQuery(managerId, answerId, row.questionText, version))).rows;
    if (!changed.length) return { ok: false as const, reason: "This answer changed or an equivalent shared answer exists. Reload before sharing; nothing was overwritten." };
    return { ok: true as const };
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false as const, reason: "A shared answer already exists. Review both answers; neither was changed." };
    if (["40001", "40P01", "55P03"].includes((error as {code?: string}).code || "")) return { ok: false as const, reason: "The answer is being changed. Reload Profile before sharing again; nothing was overwritten." };
    throw error;
  }
}
