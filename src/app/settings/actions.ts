"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  managerPromptAssignments,
  managerPromptOverrides,
  prompts,
  settings,
  users,
} from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { requireUser } from "@/lib/session";

export type PromptActionState = {
  error: string | null;
  success: string | null;
};

const emptyState: PromptActionState = { error: null, success: null };

const promptPurposes = [
  "document_generation",
  "job_description_evaluation",
  "application_answer",
] as const;

type PromptPurpose = (typeof promptPurposes)[number];
type PromptProvider = "openai" | "gemini";

export async function saveGlobalPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can manage global prompts." };
  }

  const provider = readText(formData, "provider", 16);
  const purpose = readText(formData, "purpose", 40);
  const name = readText(formData, "name", 120);
  const promptTemplate = readText(formData, "promptTemplate", 50000);
  const requestedGroupId = readText(formData, "promptGroupId", 36);
  const makeDefault = formData.get("makeDefault") === "on";
  if (
    !isPromptProvider(provider) ||
    !isPromptPurpose(purpose) ||
    !isValidProviderPurpose(provider, purpose) ||
    !name ||
    !promptTemplate ||
    (requestedGroupId && !isUuid(requestedGroupId))
  ) {
    return { ...emptyState, error: "Enter a valid provider, purpose, name, and prompt." };
  }

  try {
    const existingGroup = requestedGroupId
      ? await db
          .select({
            promptGroupId: prompts.promptGroupId,
            isDefault: prompts.isDefault,
          })
          .from(prompts)
          .where(
            and(
              eq(prompts.promptGroupId, requestedGroupId),
              eq(prompts.provider, provider),
              eq(prompts.purpose, purpose),
              eq(prompts.isActive, true),
            ),
          )
          .limit(1)
      : [];
    if (requestedGroupId && existingGroup.length === 0) {
      return {
        ...emptyState,
        error: "That active prompt was not found. Refresh and try again.",
      };
    }
    const promptGroupId = requestedGroupId || randomUUID();
    const isDefault = makeDefault || existingGroup[0]?.isDefault === true;

    const transactionResults = await neonSql.transaction((tx) => [
      tx`select pg_advisory_xact_lock(hashtext(${provider}), hashtext(${purpose}))`,
      ...(makeDefault
        ? [
            tx`
              update prompts set is_default = false, updated_at = now()
              where provider = ${provider}::prompt_provider
                and purpose = ${purpose}::prompt_purpose
                and is_default
            `,
          ]
        : []),
      tx`
        update prompts
        set is_active = false, is_default = false, updated_at = now()
        where prompt_group_id = ${promptGroupId}::uuid
          and is_active
      `,
      tx`
        insert into prompts (
          prompt_group_id, provider, purpose, name, prompt_template, version,
          is_active, is_default, created_by_user_id
        )
        select
          ${promptGroupId}::uuid,
          ${provider}::prompt_provider,
          ${purpose}::prompt_purpose,
          ${name},
          ${promptTemplate},
          coalesce(max(version), 0) + 1,
          true,
          ${isDefault},
          ${actor.id}::uuid
        from prompts
        where prompt_group_id = ${promptGroupId}::uuid
        returning id, version
      `,
    ]);
    const inserted = transactionResults[transactionResults.length - 1];
    if (!inserted || inserted.length !== 1) {
      return { ...emptyState, error: "The prompt revision could not be saved." };
    }
  } catch (error) {
    logPromptActionFailure("saving a global prompt", error);
    return {
      ...emptyState,
      error: "The prompt could not be saved. Please try again.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/prompts");
  return { error: null, success: "A new active prompt version was saved." };
}

export async function updatePromptModeAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can change prompt mode." };
  }

  const mode = readText(formData, "promptMode", 16);
  if (mode !== "global" && mode !== "private") {
    return { ...emptyState, error: "Choose a valid prompt mode." };
  }

  try {
    await db
      .insert(settings)
      .values({
        key: "prompt_mode",
        value: mode,
        updatedByUserId: actor.id,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: mode,
          updatedByUserId: actor.id,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logPromptActionFailure("updating prompt mode", error);
    return {
      ...emptyState,
      error: "Prompt mode could not be updated. Please try again.",
    };
  }

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/prompts");
  return { error: null, success: `Prompt mode changed to ${mode}.` };
}

export async function assignPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can assign prompts." };
  }

  const managerId = readText(formData, "managerId", 36);
  const promptChoice = readText(formData, "promptChoice", 40);
  if (!isUuid(managerId)) {
    return { ...emptyState, error: "Select a valid Manager." };
  }

  try {
    const [manager] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, managerId),
          eq(users.role, "manager"),
          isNull(users.blockedAt),
        ),
      )
      .limit(1);
    if (!manager) return { ...emptyState, error: "That active Manager was not found." };

    let promptId: string | undefined;
    if (promptChoice === "random") {
      const [randomPrompt] = await db
        .select({ id: prompts.id })
        .from(prompts)
        .where(
          and(
            eq(prompts.provider, "openai"),
            eq(prompts.purpose, "document_generation"),
            eq(prompts.isActive, true),
          ),
        )
        .orderBy(sql`random()`)
        .limit(1);
      promptId = randomPrompt?.id;
    } else if (isUuid(promptChoice)) {
      const [selectedPrompt] = await db
        .select({ id: prompts.id })
        .from(prompts)
        .where(
          and(
            eq(prompts.id, promptChoice),
            eq(prompts.provider, "openai"),
            eq(prompts.purpose, "document_generation"),
            eq(prompts.isActive, true),
          ),
        )
        .limit(1);
      promptId = selectedPrompt?.id;
    }

    if (!promptId) {
      return {
        ...emptyState,
        error: "Select an active ChatGPT prompt to assign.",
      };
    }

    await db
      .insert(managerPromptAssignments)
      .values({
        managerId,
        promptId,
        assignedByUserId: actor.id,
      })
      .onConflictDoUpdate({
        target: managerPromptAssignments.managerId,
        set: {
          promptId,
          assignedByUserId: actor.id,
          assignedAt: new Date(),
        },
      });
  } catch (error) {
    logPromptActionFailure("assigning a prompt", error);
    return {
      ...emptyState,
      error: "The prompt could not be assigned. Please try again.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/prompts");
  return { error: null, success: "The ChatGPT prompt was assigned to the Manager." };
}

export async function unassignPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can unassign prompts." };
  }

  const managerId = readText(formData, "managerId", 36);
  if (!isUuid(managerId)) {
    return { ...emptyState, error: "Select a valid Manager." };
  }

  try {
    await db
      .delete(managerPromptAssignments)
      .where(eq(managerPromptAssignments.managerId, managerId));
  } catch (error) {
    logPromptActionFailure("unassigning a prompt", error);
    return {
      ...emptyState,
      error: "The prompt assignment could not be removed. Please try again.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/prompts");
  return {
    error: null,
    success: "The assignment was removed. The Manager's normal prompt will be used.",
  };
}

export async function saveManagerPromptAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "manager") {
    return { ...emptyState, error: "Only Managers can update a private prompt." };
  }

  const promptTemplate = readText(formData, "promptTemplate", 50000);
  if (!promptTemplate) {
    return { ...emptyState, error: "Enter a prompt before saving." };
  }

  try {
    const [modeSetting] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "prompt_mode"))
      .limit(1);
    if (modeSetting?.value !== "private") {
      return {
        ...emptyState,
        error: "Private prompt editing is currently disabled by Super Admin.",
      };
    }

    const [globalPrompt] = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(
          eq(prompts.provider, "openai"),
          eq(prompts.purpose, "document_generation"),
          eq(prompts.isActive, true),
          eq(prompts.isDefault, true),
        ),
      )
      .limit(1);
    if (!globalPrompt) {
      throw new Error("No active global ChatGPT prompt exists.");
    }

    await db
      .insert(managerPromptOverrides)
      .values({
        managerId: actor.id,
        promptTemplate,
        basedOnPromptId: globalPrompt.id,
      })
      .onConflictDoUpdate({
        target: managerPromptOverrides.managerId,
        set: {
          promptTemplate,
          basedOnPromptId: globalPrompt.id,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logPromptActionFailure("saving a Manager prompt", error);
    return {
      ...emptyState,
      error: "Your private prompt could not be saved. Please try again.",
    };
  }

  revalidatePath("/prompts");
  return { error: null, success: "Your private ChatGPT prompt was saved." };
}

function readText(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  return typeof value === "string" && value.length <= maxLength
    ? value.trim()
    : "";
}

function isPromptProvider(value: string): value is PromptProvider {
  return value === "openai" || value === "gemini";
}

function isPromptPurpose(value: string): value is PromptPurpose {
  return promptPurposes.includes(value as PromptPurpose);
}

function isValidProviderPurpose(
  provider: PromptProvider,
  purpose: PromptPurpose,
): boolean {
  return (
    (provider === "openai" && purpose === "document_generation") ||
    (provider === "gemini" &&
      (purpose === "job_description_evaluation" ||
        purpose === "application_answer"))
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function logPromptActionFailure(stage: string, error: unknown): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`Prompt action failed while ${stage} (code: ${code}).`);
}
