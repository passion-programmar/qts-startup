"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { isUuid } from "@/server/apply/apply-route-auth";
import { dismissUnanswered } from "@/server/apply/unanswered-questions";

/** Removes a question from the Manager's "Needs answer" list (it returns if Apply meets it again). */
export async function dismissUnansweredQuestion(_state: { message: string }, form: FormData) {
  const actor = await requireUser();
  if (actor.role !== "manager") return { message: "Only Managers can change this list." };
  const id = form.get("id");
  if (!isUuid(id)) return { message: "Invalid question." };
  const removed = await dismissUnanswered(actor.id, id);
  revalidatePath("/profile");
  return { message: removed ? "Removed from the list." : "Already removed. Reload Profile." };
}
