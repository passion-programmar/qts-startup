"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { managerApplyAnswers, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isUuid } from "@/server/apply/apply-route-auth";
import { makeManagerReusable } from "@/server/apply/manager-answers";
import { canShareQuestion, correctionKey, mergeVariants, parseCorrection, profileField } from "@/server/apply/manager-answer-values";

export async function manageAnswer(_state: { message: string }, form: FormData) {
  const actor = await requireUser();
  if (actor.role !== "manager") return { message: "Only Managers can change their answers here." };
  const id = form.get("id"), action = form.get("action");
  if (id && !isUuid(id)) return { message: "Invalid answer ID." };
  const where = isUuid(id) ? and(eq(managerApplyAnswers.id, id), eq(managerApplyAnswers.managerId, actor.id)) : undefined;
  try {
    if (action === "move" && isUuid(id)) {
      const result = await makeManagerReusable(actor.id, id);
      if (!result.ok) return { message: result.reason };
    } else if (action === "delete" && where) {
      await db.delete(managerApplyAnswers).where(where);
    } else {
      const parsed = parseCorrection({ question: form.get("question"), answer: form.get("answer"), kind: "text" });
      if (typeof parsed === "string") return { message: parsed };
      const [current] = where ? await db.select().from(managerApplyAnswers).where(where).limit(1) : [];
      if (id && !current) return { message: "Answer not found." };
      if ((!current || current.scope === "manager") && !canShareQuestion(parsed.questionText)) return { message: "Save personal facts from that candidate's application or profile." };
      const variants = mergeVariants(current?.variants ?? [], { kind: "text", options: [], answer: parsed.answer });
      if (where) {
        const update = db.update(managerApplyAnswers).set({ questionKey: correctionKey(parsed.questionText), questionText: parsed.questionText, answer: parsed.answer, variants, updatedAt: new Date() }).where(where);
        const field = profileField(parsed.questionText);
        if (field && current?.candidateId) await db.batch([update,
          db.update(profiles).set({ [field]: parsed.answer, updatedAt: new Date() }).where(and(eq(profiles.userId, current.candidateId), sql`exists (select 1 from ${users} where ${users.id} = ${current.candidateId} and ${users.parentUserId} = ${actor.id})`)),
        ]);
        else await update;
      }
      else await db.insert(managerApplyAnswers).values({ managerId: actor.id, scope: "manager", contextKey: "manager", questionKey: parsed.questionKey, questionText: parsed.questionText, answer: parsed.answer, variants })
        .onConflictDoUpdate({ target: [managerApplyAnswers.managerId, managerApplyAnswers.contextKey, managerApplyAnswers.questionKey], set: { answer: parsed.answer, variants, updatedAt: new Date() } });
    }
    revalidatePath("/profile");
    return { message: "Saved. Available for future matching autofill; no approval needed." };
  } catch { return { message: "Could not save this change. Please retry." }; }
}
