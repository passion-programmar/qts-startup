"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { parseReusableAnswer } from "@/server/apply/apply-values";
import { describeWarning } from "@/server/apply/reusable-answer-values";
import { proposeReusableAnswer, withdrawReusableAnswerProposal } from "@/server/apply/reusable-answers";

export type ProposalState = {
  error: string | null;
  success: string | null;
  warnings?: string[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logProposalFailure(stage: string, error: unknown): void {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error ? error.name : "unknown";
  console.error(`Reusable answer proposal failed while ${stage} (code: ${code}).`);
}

/**
 * A Manager proposes a reusable answer for every candidate. It waits as a draft until Super Admin
 * approves it; Apply never uses it before then.
 */
export async function proposeReusableAnswerAction(
  _previousState: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { error: "Only Managers propose reusable answers here.", success: null };
  const parsed = parseReusableAnswer({
    question: formData.get("question"),
    answer: formData.get("answer"),
    note: formData.get("note"),
  });
  if (typeof parsed === "string") return { error: parsed, success: null };
  try {
    const outcome = await proposeReusableAnswer(actor.id, parsed);
    if (!outcome.ok) return { error: outcome.error, success: null };
    revalidatePath("/profile");
    revalidatePath("/settings");
    return {
      error: null,
      success: "Proposal sent. Super Admin reviews it before Apply uses it.",
      warnings: outcome.warnings.map(describeWarning),
    };
  } catch (error) {
    logProposalFailure("saving", error);
    return { error: "The proposal could not be saved. Please try again.", success: null };
  }
}

/** A Manager takes back a proposal still waiting for review. */
export async function withdrawReusableAnswerProposalAction(
  _previousState: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { error: "Only Managers propose reusable answers here.", success: null };
  const answerId = formData.get("answerId");
  if (typeof answerId !== "string" || !uuidPattern.test(answerId)) return { error: "Refresh the page and try again.", success: null };
  try {
    if (!(await withdrawReusableAnswerProposal(actor.id, answerId))) {
      return { error: "That proposal was already reviewed. Refresh the page.", success: null };
    }
  } catch (error) {
    logProposalFailure("withdrawing", error);
    return { error: "The proposal could not be withdrawn. Please try again.", success: null };
  }
  revalidatePath("/profile");
  revalidatePath("/settings");
  return { error: null, success: "Proposal withdrawn. Super Admin will not see it." };
}
