"use server";

import { revalidatePath } from "next/cache";
import type { PromptActionState } from "@/app/settings/actions";
import { requireUser } from "@/lib/session";
import {
  archiveManagerPrompt,
  PromptVersionError,
  savePromptVersion,
} from "@/server/prompts/prompt-versions";

// A Manager's own ChatGPT document prompts. Generation rotates through them one by one.

const emptyState: PromptActionState = { error: null, success: null };

/** Creates a prompt, or saves a new version of one of the Manager's prompts. */
export async function saveManagerPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ...emptyState, error: "Only Managers have their own prompts." };

  const promptGroupId = readText(formData, "promptGroupId", 36);
  const name = readText(formData, "name", 120);
  const promptTemplate = readText(formData, "promptTemplate", 50000);
  if ((promptGroupId && !isUuid(promptGroupId)) || !name || !promptTemplate) {
    return { ...emptyState, error: "Enter a name and the prompt text (50,000 characters or fewer)." };
  }

  let version: number;
  try {
    ({ version } = await savePromptVersion({
      promptGroupId: promptGroupId || null,
      ownerManagerId: actor.id,
      provider: "openai",
      purpose: "document_generation",
      name,
      promptTemplate,
      makeDefault: false,
      actorId: actor.id,
    }));
  } catch (error) {
    if (error instanceof PromptVersionError) return { ...emptyState, error: error.message };
    console.error("Could not save a Manager prompt.", error instanceof Error ? error.name : "unknown");
    return { ...emptyState, error: "The prompt could not be saved. Please try again." };
  }

  revalidatePath("/prompts");
  revalidatePath("/settings");
  return {
    error: null,
    success: promptGroupId
      ? `Version ${version} saved and in use. Earlier versions are kept.`
      : "Prompt added to your rotation.",
  };
}

/** Deletes a prompt from the Manager's rotation. Its versions are archived, not erased. */
export async function deleteManagerPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") return { ...emptyState, error: "Only Managers have their own prompts." };
  const promptGroupId = readText(formData, "promptGroupId", 36);
  if (!isUuid(promptGroupId)) return { ...emptyState, error: "Select a valid prompt." };

  try {
    const archived = await archiveManagerPrompt({ promptGroupId, ownerManagerId: actor.id });
    if (!archived) return { ...emptyState, error: "That prompt was not found. Refresh and try again." };
  } catch (error) {
    console.error("Could not delete a Manager prompt.", error instanceof Error ? error.name : "unknown");
    return { ...emptyState, error: "The prompt could not be deleted. Please try again." };
  }

  revalidatePath("/prompts");
  revalidatePath("/settings");
  return { error: null, success: "Prompt deleted. Jobs and bids that used it still show it." };
}

function readText(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= maxLength ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
