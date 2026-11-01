"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { managerApplyAnswers, reusableAnswers } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isUuid } from "@/server/apply/apply-route-auth";
import { canShareQuestion, correctionKey } from "@/server/apply/manager-answer-values";
import { saveApprovedReusableAnswer } from "@/server/apply/reusable-answers";

export async function publishManagerAnswer(_state: { message: string }, form: FormData) {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return { message: "Only Super Admin can publish global answers." };
  const id = form.get("id");
  if (!isUuid(id)) return { message: "Invalid answer ID." };
  try {
    const [row] = await db.select().from(managerApplyAnswers).where(and(eq(managerApplyAnswers.id, id), eq(managerApplyAnswers.scope, "manager"))).limit(1);
    if (!row || !canShareQuestion(row.questionText)) return { message: "Only shared Manager answers can be published globally." };
    const globals = await db.select().from(reusableAnswers);
    const current = globals.find((entry) => correctionKey(entry.questionText) === row.questionKey);
    const result = await saveApprovedReusableAnswer(actor.id, current?.id ?? null, {
      questionKey: current?.questionKey ?? row.questionKey, questionText: row.questionText, answer: row.answer, note: null,
    });
    if (!result.ok) return { message: result.error };
    revalidatePath("/settings"); revalidatePath("/profile");
    return { message: "Published globally. Future autofill uses this answer for all Managers. The Manager's saved answer is retained." };
  } catch { return { message: "Could not publish this answer. Please retry." }; }
}
