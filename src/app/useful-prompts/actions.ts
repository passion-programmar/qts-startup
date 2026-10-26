"use server";

import { revalidatePath } from "next/cache";
import type { PromptActionState } from "@/app/settings/actions";
import { requireUser } from "@/lib/session";
import { parseUsefulPrompt } from "@/server/useful-prompts/useful-prompt-values";
import {
  deleteUsefulPrompt,
  restoreUsefulPromptVersion,
  saveUsefulPrompt,
  UsefulPromptError,
} from "@/server/useful-prompts/useful-prompts";

// A Manager's useful prompts: a private library kept for special cases, every version saved.

const emptyState: PromptActionState = { error: null, success: null };

/** Adds a prompt, or saves a new version of one. */
export async function saveUsefulPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ...emptyState, error: "Only Managers keep useful prompts." };
  const promptKey = readText(formData, "promptKey");
  if (promptKey && !isUuid(promptKey)) return { ...emptyState, error: "Refresh the page and try again." };
  const parsed = parseUsefulPrompt({ title: formData.get("title"), content: formData.get("content") });
  if (typeof parsed === "string") return { ...emptyState, error: parsed };

  try {
    const version = await saveUsefulPrompt({ managerId: actor.id, promptKey: promptKey || null, ...parsed });
    revalidatePath("/useful-prompts");
    return { error: null, success: promptKey ? `Version ${version} saved. Earlier versions are in the history.` : "Prompt added." };
  } catch (error) {
    if (error instanceof UsefulPromptError) return { ...emptyState, error: error.message };
    console.error("Could not save a useful prompt.", error instanceof Error ? error.name : "unknown");
    return { ...emptyState, error: "The prompt could not be saved. Please try again." };
  }
}

/** Saves an earlier version again as the newest one. */
export async function restoreUsefulPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ...emptyState, error: "Only Managers keep useful prompts." };
  const versionId = readText(formData, "versionId");
  if (!isUuid(versionId)) return { ...emptyState, error: "Refresh the page and try again." };

  try {
    const version = await restoreUsefulPromptVersion(actor.id, versionId);
    revalidatePath("/useful-prompts");
    return { error: null, success: `Restored as version ${version}.` };
  } catch (error) {
    if (error instanceof UsefulPromptError) return { ...emptyState, error: error.message };
    console.error("Could not restore a useful prompt.", error instanceof Error ? error.name : "unknown");
    return { ...emptyState, error: "The version could not be restored. Please try again." };
  }
}

/** Deletes a prompt and its history. */
export async function deleteUsefulPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ...emptyState, error: "Only Managers keep useful prompts." };
  const promptKey = readText(formData, "promptKey");
  if (!isUuid(promptKey)) return { ...emptyState, error: "Refresh the page and try again." };

  try {
    const deleted = await deleteUsefulPrompt(actor.id, promptKey);
    if (!deleted) return { ...emptyState, error: "That prompt was not found. Refresh and try again." };
  } catch (error) {
    console.error("Could not delete a useful prompt.", error instanceof Error ? error.name : "unknown");
    return { ...emptyState, error: "The prompt could not be deleted. Please try again." };
  }
  revalidatePath("/useful-prompts");
  return { error: null, success: "Prompt deleted." };
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= 36 ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
