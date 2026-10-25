"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseGeminiApiLimits } from "@/server/gemini/gemini-api-limits";
import {
  isJobRecordTimeZone,
  jobRecordTimeZoneOptions,
  jobRecordTimeZoneSettingKey,
} from "@/server/jobs/job-record-time-zones";
import {
  activatePromptVersion,
  PromptVersionError,
  savePromptVersion,
} from "@/server/prompts/prompt-versions";
import { settings, users } from "@/db/schema";
import { db } from "@/lib/db";
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

// Super Admin's library prompts: the default ChatGPT prompt Managers without their own prompts
// use, and the Gemini prompts. Each save adds a version; earlier versions are kept.
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
  const promptGroupId = readText(formData, "promptGroupId", 36);
  if (
    !isPromptProvider(provider) ||
    !isPromptPurpose(purpose) ||
    !isValidProviderPurpose(provider, purpose) ||
    !name ||
    !promptTemplate ||
    (promptGroupId && !isUuid(promptGroupId))
  ) {
    return { ...emptyState, error: "Enter a valid provider, purpose, name, and prompt." };
  }

  try {
    await savePromptVersion({
      promptGroupId: promptGroupId || null,
      ownerManagerId: null,
      provider,
      purpose,
      name,
      promptTemplate,
      makeDefault: formData.get("makeDefault") === "on",
      actorId: actor.id,
    });
  } catch (error) {
    if (error instanceof PromptVersionError) return { ...emptyState, error: error.message };
    logPromptActionFailure("saving a global prompt", error);
    return { ...emptyState, error: "The prompt could not be saved. Please try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/prompts");
  return { error: null, success: "A new version was saved and is now in use. Earlier versions are kept." };
}

// Puts an earlier version of a ChatGPT document prompt back in use; nothing is deleted.
export async function activatePromptVersionAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin" && actor.role !== "manager") {
    return { ...emptyState, error: "You cannot change prompt versions." };
  }
  const promptId = readText(formData, "promptId", 36);
  if (!isUuid(promptId)) return { ...emptyState, error: "Select a valid version." };

  let version: number;
  try {
    // Super Admin switches library prompts; a Manager switches only their own.
    ({ version } = await activatePromptVersion({
      promptId,
      ownerManagerId: actor.role === "manager" ? actor.id : null,
    }));
  } catch (error) {
    if (error instanceof PromptVersionError) return { ...emptyState, error: error.message };
    logPromptActionFailure("activating a prompt version", error);
    return { ...emptyState, error: "The version could not be put in use. Please try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/prompts");
  return { error: null, success: `Version ${version} is now in use from the next Generation.` };
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

export async function updateJobRecordTimeZoneAction(
  _previousState: PromptActionState,
  formData: FormData,
): Promise<PromptActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return { ...emptyState, error: "Only Super Admin can change the job record time zone." };
  const timeZone = readText(formData, "jobRecordTimeZone", 64);
  if (!isJobRecordTimeZone(timeZone)) return { ...emptyState, error: "Choose a time zone from the list." };
  try {
    await db.insert(settings).values({ key: jobRecordTimeZoneSettingKey, value: timeZone, updatedByUserId: actor.id })
      .onConflictDoUpdate({ target: settings.key, set: { value: timeZone, updatedByUserId: actor.id, updatedAt: new Date() } });
  } catch (error) {
    logPromptActionFailure("updating the job record time zone", error);
    return { ...emptyState, error: "The job record time zone could not be updated." };
  }
  revalidatePath("/settings");
  const label = jobRecordTimeZoneOptions.find((option) => option.value === timeZone)?.label ?? timeZone;
  return { error: null, success: `New job records are dated in ${label} time (${timeZone}).` };
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
