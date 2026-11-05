"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { managerApplyAnswers, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { neonSql } from "@/lib/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { identityMetadata, semanticWriteGuard } from "@/server/apply/answer-identity";
import { requireUser } from "@/lib/session";
import { isUuid } from "@/server/apply/apply-route-auth";
import { makeManagerReusable } from "@/server/apply/manager-answers";
import { canShareQuestion, correctionKey, mergeVariants, parseCorrection, profileField } from "@/server/apply/manager-answer-values";

export async function manageAnswer(_state: { message: string }, form: FormData) {
  const actor = await requireUser();
  if (actor.role !== "manager") return { message: "Only Managers can change their answers here." };
  const id = form.get("id"), action = form.get("action"), version = form.get("version");
  if (id && !isUuid(id)) return { message: "Invalid answer ID." };
  if (id && (typeof version !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(version))) return { message: "Reload Profile before changing this answer." };
  const where = isUuid(id) ? and(eq(managerApplyAnswers.id, id), eq(managerApplyAnswers.managerId, actor.id), sql`extract(epoch from ${managerApplyAnswers.updatedAt})::text = ${version}`) : undefined;
  try {
    if (action === "move" && isUuid(id)) {
      const result = await makeManagerReusable(actor.id, id, String(version), true);
      if (!result.ok) return { message: result.reason };
    } else if (action === "delete" && where) {
      const removed = await db.delete(managerApplyAnswers).where(where).returning({ id: managerApplyAnswers.id });
      if (!removed.length) return { message: "This answer changed or was deleted. Reload Profile; nothing was overwritten." };
    } else if (typeof action === "string" && /^variation-delete:\d+$/.test(action) && where) {
      const index = Number(action.split(':')[1]);
      const removed = await db.execute(sql`update ${managerApplyAnswers} set variants = ${managerApplyAnswers.variants} - ${index}, updated_at = clock_timestamp()
        where ${where} and ${index} >= 0 and ${index} < jsonb_array_length(${managerApplyAnswers.variants}) returning id`);
      if (!removed.rows.length) return { message: "This variation changed or was removed. Reload Profile; nothing was overwritten." };
    } else {
      const parsed = parseCorrection({ question: form.get("question"), answer: form.get("answer"), kind: "text" }, { normalApply: true });
      if (typeof parsed === "string") return { message: parsed };
      const [current] = where ? await db.select().from(managerApplyAnswers).where(where).limit(1) : [];
      if (id && !current) return { message: "This answer changed or was deleted. Reload Profile; nothing was overwritten." };
      if ((!current || current.scope === "manager") && !canShareQuestion(parsed.questionText, true)) return { message: "Save personal facts from that candidate's application or profile." };
      const variants = mergeVariants(current?.variants ?? [], { kind: "text", options: [], answer: parsed.answer, ...identityMetadata(parsed.questionText) });
      if (where) {
        const update = sql`update ${managerApplyAnswers} set question_key = ${correctionKey(parsed.questionText)}, question_text = ${parsed.questionText},
          answer = ${parsed.answer}, variants = ${JSON.stringify(variants)}::jsonb, updated_at = clock_timestamp()
          where ${where} returning id, candidate_id, scope`;
        const field = profileField(parsed.questionText, true);
        const columns = { city: "city", firstName: "first_name", lastName: "last_name", candidateEmail: "candidate_email", phone: "phone", linkedinUrl: "linkedin_url" };
        const profile = field && current?.candidateId ? sql`, profile_change as (
          update ${profiles} set ${sql.identifier(columns[field])} = ${parsed.answer}, updated_at = clock_timestamp()
          where ${profiles.userId} = ${current.candidateId}::uuid
            and exists(select 1 from changed where scope = 'candidate' and candidate_id = ${profiles.userId})
            and exists(select 1 from ${users} where ${users.id} = ${current.candidateId}::uuid and ${users.parentUserId} = ${actor.id}::uuid)
          returning ${profiles.userId})` : sql``;
        const changed = await db.execute(sql`with changed as (${update}) ${profile} select id from changed`);
        if (!changed.rows.length) return { message: "This answer changed or was deleted. Reload Profile; nothing was overwritten." };
      }
      else {
        const knownRows = await db.select({ questionText: managerApplyAnswers.questionText }).from(managerApplyAnswers).where(eq(managerApplyAnswers.managerId, actor.id));
        const guard = semanticWriteGuard(actor.id, sql`'manager'`, parsed.questionText, null, knownRows);
        const query = new PgDialect().sqlToQuery(sql`insert into manager_apply_answers(manager_id,scope,context_key,question_key,question_text,answer,variants)
          select ${actor.id}::uuid,'manager','manager',${parsed.questionKey},${parsed.questionText},${parsed.answer},${JSON.stringify(variants)}::jsonb
          where ${guard} on conflict do nothing returning id`);
        const [created] = await neonSql.transaction([neonSql.query(query.sql, query.params)], { isolationLevel: "Serializable" });
        if (!created.length) return { message: "An equivalent question already has a saved answer. Reload Profile and edit that answer." };
      }
    }
    revalidatePath("/profile");
    return { message: "Saved. Available for future matching autofill; no approval needed." };
  } catch { return { message: "The change could not be confirmed. Reload Profile and review the saved answer before retrying." }; }
}
