"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { managerApplyAnswers } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isUuid } from "@/server/apply/apply-route-auth";
import { addAlternative, deleteSiteForm, editSiteForm, removeAlternative } from "@/server/apply/answer-variant-forms";

/** Other forms and per-site forms of one of the Manager's own saved answers (Profile page). */
export async function manageAnswerForms(_state: { message: string }, form: FormData) {
  const actor = await requireUser();
  if (actor.role !== "manager") return { message: "Only Managers can change their answers here." };
  const id = form.get("id"), version = form.get("version"), action = form.get("action");
  if (!isUuid(id)) return { message: "Invalid answer ID." };
  if (typeof version !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(version)) return { message: "Reload Answers before changing this answer." };
  // Only the Manager's own row, and only the version the page showed: a newer change is never overwritten.
  const where = and(eq(managerApplyAnswers.id, id), eq(managerApplyAnswers.managerId, actor.id), sql`extract(epoch from ${managerApplyAnswers.updatedAt})::text = ${version}`);
  try {
    const [row] = await db.select({ answer: managerApplyAnswers.answer, variants: managerApplyAnswers.variants }).from(managerApplyAnswers).where(where).limit(1);
    if (!row) return { message: "This answer changed or was deleted. Reload Answers; nothing was overwritten." };
    const variants = row.variants ?? [];
    const result = action === "alternative-add" ? addAlternative(variants, form.get("text"), row.answer)
      : action === "alternative-remove" ? removeAlternative(variants, form.get("text"))
      : action === "site-edit" ? editSiteForm(variants, form.get("site"), form.get("kind"), form.get("text"))
      : action === "site-delete" ? deleteSiteForm(variants, form.get("site"), form.get("kind"))
      : { ok: false as const, reason: "Unknown action." };
    if (!result.ok) return { message: result.reason };
    const changed = await db.update(managerApplyAnswers).set({ variants: result.variants, updatedAt: sql`clock_timestamp()` }).where(where).returning({ id: managerApplyAnswers.id });
    if (!changed.length) return { message: "This answer changed or was deleted. Reload Answers; nothing was overwritten." };
    revalidatePath("/answers");
    return { message: action === "alternative-add" || action === "site-edit" ? "Saved." : "Removed." };
  } catch { return { message: "The change could not be confirmed. Reload Answers and review the saved answer before retrying." }; }
}
