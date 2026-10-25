"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseGeminiApiLimits } from "@/server/gemini/gemini-api-limits";
import {
  managerPromptAssignments,
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
      tx`
        update manager_prompt_assignments
        set prompt_id = (
          select id
          from prompts
          where prompt_group_id = ${promptGroupId}::uuid
            and is_active = true
        )
        where prompt_id in (
          select id from prompts where prompt_group_id = ${promptGroupId}::uuid
        )
      `,
    ]);
    const inserted = transactionResults[transactionResults.length - 2];
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
  return {
    error: null,
    success: mode === "private"
      ? "Saved. Managers now see their assigned prompt."
      : "Saved. The Manager prompt tab is hidden.",
  };
}

export async function updateManagerGeminiMatchingAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can assign Gemini matching." };
  }
  const managerId = readText(formData, "managerId", 36);
  const enabledValue = formData.get("enabled");
  if (!isUuid(managerId) || (enabledValue !== "true" && enabledValue !== "false")) {
    return { ...emptyState, error: "Select a valid Manager and Gemini matching value." };
  }

  try {
    const [manager] = await db
      .update(users)
      .set({
        useGeminiMatching: enabledValue === "true",
        updatedAt: new Date(),
      })
      .where(and(
        eq(users.id, managerId),
        eq(users.role, "manager"),
        isNull(users.blockedAt),
      ))
      .returning({ id: users.id });
    if (!manager) {
      return { ...emptyState, error: "That active Manager was not found." };
    }
  } catch (error) {
    logPromptActionFailure("updating Gemini matching", error);
    return { ...emptyState, error: "The Manager's Gemini matching could not be updated." };
  }

  revalidatePath("/settings");
  return {
    error: null,
    success: enabledValue === "true"
      ? "Gemini matching was assigned. This Manager's Get JD now uses Gemini."
      : "Gemini matching was removed. This Manager's Get JD now uses general matching.",
  };
}

export async function updateGeminiTokenCountModeAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return { ...emptyState, error: "Only Super Admin can change token counting mode." };
  const mode = readText(formData, "geminiTokenCountMode", 16);
  if (mode !== "local" && mode !== "gemini") return { ...emptyState, error: "Choose a valid token counting mode." };
  try {
    await db.insert(settings).values({ key: "gemini_token_count_mode", value: mode, updatedByUserId: actor.id })
      .onConflictDoUpdate({ target: settings.key, set: { value: mode, updatedByUserId: actor.id, updatedAt: new Date() } });
  } catch (error) {
    logPromptActionFailure("updating Gemini token count mode", error);
    return { ...emptyState, error: "Token counting mode could not be updated." };
  }
  revalidatePath("/settings");
  revalidatePath("/settings/gemini-usage");
  return {
    error: null,
    success: mode === "gemini"
      ? "Gemini Count is on: each request is counted locally and with Google's CountTokens."
      : "Local Count is on: QTS estimates tokens locally and makes no CountTokens calls.",
  };
}

export async function saveGeminiApiLimitsAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can change Gemini API limits." };
  }

  const limits = parseGeminiApiLimits({
    requestsPerMinute: formData.get("requestsPerMinute"),
    requestsPerDay: formData.get("requestsPerDay"),
    inputTokensPerMinute: formData.get("inputTokensPerMinute"),
  });
  if (!limits) {
    return {
      ...emptyState,
      error: "Enter positive whole-number limits within the allowed ranges.",
    };
  }

  try {
    await db
      .insert(settings)
      .values({
        key: "gemini_api_limits",
        value: limits,
        updatedByUserId: actor.id,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: limits,
          updatedByUserId: actor.id,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logPromptActionFailure("updating Gemini API limits", error);
    return { ...emptyState, error: "Gemini API limits could not be saved." };
  }

  revalidatePath("/settings/gemini-usage");
  return { error: null, success: "Gemini API limits were updated." };
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
    if (isUuid(promptChoice)) {
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
    const removed = await db
      .delete(managerPromptAssignments)
      .where(eq(managerPromptAssignments.managerId, managerId))
      .returning({ managerId: managerPromptAssignments.managerId });
    if (removed.length === 0) {
      return { ...emptyState, error: "This Manager has no assigned prompt." };
    }
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

export async function updateManagerTextHighlightAccessAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can assign extension permissions." };
  }
  const managerId = readText(formData, "managerId", 36);
  const enabledValue = formData.get("enabled");
  if (!isUuid(managerId) || (enabledValue !== "true" && enabledValue !== "false")) {
    return { ...emptyState, error: "Select a valid Manager and permission value." };
  }

  try {
    const [manager] = await db
      .update(users)
      .set({
        canManageTextHighlights: enabledValue === "true",
        updatedAt: new Date(),
      })
      .where(and(
        eq(users.id, managerId),
        eq(users.role, "manager"),
        isNull(users.blockedAt),
      ))
      .returning({ id: users.id });
    if (!manager) {
      return { ...emptyState, error: "That active Manager was not found." };
    }
  } catch (error) {
    logPromptActionFailure("updating text highlight access", error);
    return {
      ...emptyState,
      error: "The Manager's text highlight permission could not be updated.",
    };
  }

  revalidatePath("/settings");
  return {
    error: null,
    success: enabledValue === "true"
      ? "Text highlight management was assigned to the Manager."
      : "Text highlight management was removed from the Manager.",
  };
}

export async function updateManagerPageExclusionAccessAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can assign extension permissions." };
  }
  const managerId = readText(formData, "managerId", 36);
  const enabledValue = formData.get("enabled");
  if (!isUuid(managerId) || (enabledValue !== "true" && enabledValue !== "false")) {
    return { ...emptyState, error: "Select a valid Manager and permission value." };
  }

  try {
    const [manager] = await db
      .update(users)
      .set({
        canManagePageExclusions: enabledValue === "true",
        updatedAt: new Date(),
      })
      .where(and(
        eq(users.id, managerId),
        eq(users.role, "manager"),
        isNull(users.blockedAt),
      ))
      .returning({ id: users.id });
    if (!manager) {
      return { ...emptyState, error: "That active Manager was not found." };
    }
  } catch (error) {
    logPromptActionFailure("updating page exclusion access", error);
    return {
      ...emptyState,
      error: "The Manager's page exclusion permission could not be updated.",
    };
  }

  revalidatePath("/settings");
  return {
    error: null,
    success: enabledValue === "true"
      ? "Page exclusion management was assigned to the Manager."
      : "Page exclusion management was removed from the Manager.",
  };
}

export async function updateManagerJobDetectionUrlAccessAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can assign extension permissions." };
  }
  const managerId = readText(formData, "managerId", 36);
  const enabledValue = formData.get("enabled");
  if (!isUuid(managerId) || (enabledValue !== "true" && enabledValue !== "false")) {
    return { ...emptyState, error: "Select a valid Manager and permission value." };
  }

  try {
    const [manager] = await db
      .update(users)
      .set({
        canManageJobDetectionUrlRules: enabledValue === "true",
        updatedAt: new Date(),
      })
      .where(and(
        eq(users.id, managerId),
        eq(users.role, "manager"),
        isNull(users.blockedAt),
      ))
      .returning({ id: users.id });
    if (!manager) {
      return { ...emptyState, error: "That active Manager was not found." };
    }
  } catch (error) {
    logPromptActionFailure("updating job-detection URL access", error);
    return {
      ...emptyState,
      error: "The Manager's job-detection URL permission could not be updated.",
    };
  }

  revalidatePath("/settings");
  return {
    error: null,
    success: enabledValue === "true"
      ? "Job-detection URL management was assigned to the Manager."
      : "Job-detection URL management was removed from the Manager.",
  };
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
