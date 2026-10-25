import {
  and,
  asc,
  eq,
  isNull,
} from "drizzle-orm";
import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import {
  categories,
  profiles,
  prompts,
  subCategories,
  users,
} from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  acquireGeminiKey,
  geminiModel,
  getGeminiApiKeys,
  getGeminiApiLimits,
  releaseGeminiKey,
  recordGeminiApiCall,
  requestGeminiApi,
  reserveGeminiGeneration,
} from "@/lib/gemini-usage";
import { estimateGeminiInputTokens } from "@/server/gemini/gemini-request";
import { geminiJobEvaluationGenerationConfig } from "@/server/gemini/job-evaluation-config";
import { candidatesWithJdNotes } from "@/server/gemini/candidates-with-jd-notes";
import { buildGetJdEvaluationPrompt } from "@/server/gemini/build-get-jd-evaluation-prompt";
import { mapMatchingProfileIndexes } from "@/server/gemini/matching-profile-indexes";
import { getGeminiTokenCountMode, type GeminiTokenCountMode } from "@/server/gemini/token-count-mode";
import {
  findGetJdDuplicateDetails,
  findManagerJobPresence,
  getJdAccountState,
  insertGetJdJob,
  summarizeAccountStates,
  updateExistingGetJdJobDetails,
} from "@/server/jobs/get-jd-jobs";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";
import { getGetJdFailureMessage } from "@/server/gemini/get-jd-failure-message";
import { withGeminiRetry } from "@/server/gemini/gemini-retry";

const maxPageUrlLength = 2048;
const maxPageTitleLength = 500;
const maxJobTextLength = 30000;
const maxPageTextLength = 100_000;
const maxManagerAccounts = 100;
const maxGeminiResponseBytes = 1_000_000;

const generationConfig = geminiJobEvaluationGenerationConfig;

type CandidateProfileForEvaluation = {
  id: string;
  name: string;
  category: string | null;
  jdMatching: string | null;
};

type GetJdClassification = {
  isJobPage: boolean;
  isRemote: boolean;
  job: {
    title: string;
    company: string;
    description: string;
    location: string;
    country: string;
    employmentType: string;
    workplaceType: string;
    salary: string;
    jobUrl: string;
    reason: string;
  };
  matchingProfileIds: string[];
};

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      401,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { success: false, message: "Request body must be valid JSON." },
      400,
    );
  }

  const pageUrl = readString(body, "pageUrl", maxPageUrlLength);
  const pageTitle = readString(body, "pageTitle", maxPageTitleLength);
  const pageText = readString(body, "pageText", maxPageTextLength);
  if (!pageUrl || !isHttpUrl(pageUrl) || !pageTitle || !pageText) {
    return jsonResponse(
      { success: false, message: "A valid page URL, title, and visible page text are required." },
      400,
    );
  }

  try {
    if (await getGetJdMatchingMode(manager.id) !== "gemini") {
      return jsonResponse({ success: false, message: "Gemini matching is not assigned to your account. Ask your Super Admin." }, 409);
    }
    const profileResult = await loadManagerCandidateProfiles(manager.id);
    if (profileResult.tooMany) {
      return jsonResponse(
        { success: false, message: "You have too many active candidates to evaluate at once." },
        413,
      );
    }
    if (profileResult.profiles.length === 0) {
      return jsonResponse(
        {
          success: false,
          message: "Add an active candidate before evaluating jobs.",
        },
        409,
      );
    }
    const candidateProfiles = profileResult.profiles;
    // Accounts that already have this job (by URL) are not sent to Gemini; only
    // available accounts are evaluated, and Gemini is skipped when none remain.
    const urlDuplicates = await findGetJdDuplicateDetails(
      manager.id,
      { jobUrl: pageUrl, jobTitle: "", company: "" },
      candidateProfiles.map((profile) => profile.id),
    );
    const availableProfiles = candidateProfiles.filter((profile) => !urlDuplicates.has(profile.id));
    if (availableProfiles.length === 0) {
      const presence = await findManagerJobPresence(manager.id, { jobUrl: pageUrl, jobTitle: "", company: "" });
      return jsonResponse({
        success: true,
        skippedEvaluation: true,
        classification: { isJobPage: true, isRemote: true, matchingProfileIds: [] },
        profiles: candidateProfiles.map((candidate) => {
          const duplicate = urlDuplicates.get(candidate.id) ?? null;
          return {
            id: candidate.id,
            name: candidate.name,
            category: candidate.category,
            recommended: false,
            autoSaved: false,
            autoSaveJobId: null,
            autoSaveFailed: false,
            available: false,
            state: getJdAccountState(duplicate),
            rowId: duplicate?.rowId ?? null,
            duplicateKind: duplicate?.kind ?? null,
            jobStatus: duplicate?.jobStatus ?? null,
          };
        }),
        autoSavedProfileIds: [],
        autoSavedJobs: [],
        autoSaveFailureCount: 0,
        allCandidatesAssigned: true,
        exists: true,
        ...presence,
        summary: summarizeAccountStates(candidateProfiles.map((candidate) => getJdAccountState(urlDuplicates.get(candidate.id)))),
        toastKind: presence.inBids ? "applied" : "added",
        toastMessage: "All candidates already have this job.",
        message: "All candidates already have this job.",
      });
    }
    const candidatesForEvaluation = candidatesWithJdNotes(availableProfiles);

    const [prompt] = await db
      .select({ promptTemplate: prompts.promptTemplate })
      .from(prompts)
      .where(
        and(
          eq(prompts.provider, "gemini"),
          eq(prompts.purpose, "job_description_evaluation"),
          eq(prompts.isActive, true),
          eq(prompts.isDefault, true),
        ),
      )
      .limit(1);
    if (!prompt) {
      return jsonResponse(
        { success: false, message: "The Super Admin has not configured a default Gemini job-evaluation prompt." },
        503,
      );
    }

    const apiKeys = getGeminiApiKeys();
    if (apiKeys.length === 0) {
      return jsonResponse(
        {
          success: false,
          message:
            "Gemini matching is unavailable right now. Ask your Super Admin to check the Gemini setup.",
        },
        503,
      );
    }

    const candidateContext = candidatesForEvaluation.map((candidate, index) => ({
      candidateIndex: index,
      candidateName: candidate.name,
      jdMatching: candidate.jdMatching,
    }));
    const promptText = buildGetJdEvaluationPrompt({
      savedPrompt: prompt.promptTemplate,
      pageUrl,
      pageTitle,
      pageText,
      candidates: candidateContext,
    });

    const selectedKey = await selectAvailableGeminiApiKey(
      apiKeys,
      promptText,
      generationConfig,
      await getGeminiTokenCountMode(),
      await getGeminiApiLimits(),
    );
    if (!selectedKey) {
      return jsonResponse(
        {
          success: false,
          message:
            "QTS is temporarily unable to process this request because all configured Gemini keys are busy or at their QTS usage limits. Try again shortly.",
          diagnosticCode: "gemini_local_capacity_unavailable",
        },
        503,
      );
    }
    const { apiKey, leaseId } = selectedKey;
    let modelResult: unknown;
    try {
      modelResult = await requestGeminiJson(apiKey, promptText);
    } finally {
      await releaseGeminiKey(apiKey, leaseId);
    }
    const classification = validateClassification(
      modelResult,
      pageUrl,
      candidatesForEvaluation,
    );
    if (!classification.isJobPage) {
      return jsonResponse({
        success: true,
        classification,
        profiles: [],
        message: `Not a valid job page: ${classification.job.reason}`,
      });
    }
    if (!classification.isRemote) {
      return jsonResponse({
        success: true,
        classification,
        profiles: [],
        message: `Not eligible: ${classification.job.reason}`,
      });
    }
    const jobIdentity = {
      jobUrl: pageUrl,
      jobTitle: classification.job.title,
      company: classification.job.company,
    };
    let [duplicateDetails, presence] = await Promise.all([
      findGetJdDuplicateDetails(manager.id, jobIdentity, candidateProfiles.map((profile) => profile.id)),
      findManagerJobPresence(manager.id, jobIdentity),
    ]);
    const matchingProfileIds = new Set(classification.matchingProfileIds);
    const autoSavedProfileIds = new Set<string>();
    const autoSavedJobs = new Map<string, string>();
    const autoSaveFailedProfileIds = new Set<string>();
    for (const candidate of candidateProfiles) {
      if (!matchingProfileIds.has(candidate.id)) continue;
      const jobToSave = {
        jobUrl: classification.job.jobUrl,
        jobTitle: classification.job.title,
        company: classification.job.company,
        description: classification.job.description,
        location: classification.job.location,
        country: classification.job.country,
        employmentType: classification.job.employmentType,
        workplaceType: classification.job.workplaceType,
        salary: classification.job.salary,
        jobReason: classification.job.reason,
        pageText,
        managerId: manager.id,
        candidateId: candidate.id,
        autoSavedByGetJd: true,
      };
      if (duplicateDetails.has(candidate.id)) {
        try {
          await updateExistingGetJdJobDetails(jobToSave);
        } catch (error) {
          autoSaveFailedProfileIds.add(candidate.id);
          logGetJdFailure(`get_jd_auto_save_${getGetJdFailureCode(error)}`);
        }
        continue;
      }
      try {
        const result = await insertGetJdJob(jobToSave);
        if (result.status === "saved") {
          autoSavedProfileIds.add(candidate.id);
          autoSavedJobs.set(candidate.id, result.jobId);
        } else {
          duplicateDetails.set(candidate.id, {
            kind: result.status,
            jobStatus: null,
            rowId: null,
            generationStatus: null,
          });
        }
      } catch (error) {
        autoSaveFailedProfileIds.add(candidate.id);
        logGetJdFailure(`get_jd_auto_save_${getGetJdFailureCode(error)}`);
      }
    }
    if (autoSavedProfileIds.size > 0 || duplicateDetails.size > 0) {
      [duplicateDetails, presence] = await Promise.all([
        findGetJdDuplicateDetails(manager.id, jobIdentity, candidateProfiles.map((profile) => profile.id)),
        findManagerJobPresence(manager.id, jobIdentity),
      ]);
    }
    const profilesWithStatus = candidateProfiles.map((candidate) => {
      const duplicate = duplicateDetails.get(candidate.id) ?? null;
      const autoSaved = autoSavedProfileIds.has(candidate.id);
      return {
        id: candidate.id,
        name: candidate.name,
        category: candidate.category,
        recommended: matchingProfileIds.has(candidate.id),
        autoSaved,
        autoSaveJobId: autoSavedJobs.get(candidate.id) ?? null,
        autoSaveFailed: autoSaveFailedProfileIds.has(candidate.id),
        // An account that has the job (saved earlier or just auto-saved) is not "available" to add again.
        available: !autoSaved && duplicate === null,
        state: autoSaved ? "has_job" : getJdAccountState(duplicate),
        rowId: autoSavedJobs.get(candidate.id) ?? duplicate?.rowId ?? null,
        duplicateKind: duplicate?.kind ?? null,
        jobStatus: duplicate?.jobStatus ?? null,
      };
    });
    const allCandidatesAssigned = profilesWithStatus.every((profile) => !profile.available);
    const summary = summarizeAccountStates(profilesWithStatus.map((profile) => profile.state));
    const toastKind = presence.inBids ? "applied" : presence.inJobs ? "added" : "new";
    return jsonResponse({
      success: true,
      classification,
      jobDescription: classification.job.description,
      profiles: profilesWithStatus,
      autoSavedProfileIds: [...autoSavedProfileIds],
      autoSavedJobs: [...autoSavedJobs].map(([profileId, jobId]) => ({ profileId, jobId })),
      autoSaveFailureCount: autoSaveFailedProfileIds.size,
      allCandidatesAssigned,
      exists: presence.inJobs || presence.inBids,
      ...presence,
      toastKind,
      summary,
      toastMessage: toastKind === "new" && autoSavedProfileIds.size === 0 ? "New job — not in your Jobs or Bids yet." : summary.text,
      message: autoSavedProfileIds.size > 0
        ? `Gemini matched and automatically saved this job for ${autoSavedProfileIds.size} account${autoSavedProfileIds.size === 1 ? "" : "s"}.${autoSaveFailedProfileIds.size > 0 ? ` Automatic saving failed for ${autoSaveFailedProfileIds.size} matching account${autoSaveFailedProfileIds.size === 1 ? "" : "s"}; they remain selected so you can retry.` : " Review checked and unchecked candidates and save any additional accounts."}`
        : autoSaveFailedProfileIds.size > 0
          ? "Gemini found matching accounts, but automatic saving failed for some. They remain selected so you can retry with Save."
          : allCandidatesAssigned
            ? "This job already exists for every active candidate."
            : "Review Gemini's checked and unchecked candidate matches, then save.",
    });
  } catch (error) {
    const diagnosticCode = getGetJdFailureCode(error);
    logGetJdFailure(diagnosticCode, getGetJdProviderMessage(error));
    const status = /^gemini_(?:count_tokens_)?http_429$/.test(diagnosticCode)
      ? 429
      : 502;
    return jsonResponse(
      {
        success: false,
        message: getGetJdFailureMessage(diagnosticCode),
        diagnosticCode,
      },
      status,
    );
  }
}

async function selectAvailableGeminiApiKey(
  apiKeys: string[],
  prompt: string,
  config: typeof generationConfig,
  tokenCountMode: GeminiTokenCountMode,
  limits: Awaited<ReturnType<typeof getGeminiApiLimits>>,
): Promise<{ apiKey: string; leaseId: string } | null> {
  const shuffledKeys = [...apiKeys];
  for (let index = shuffledKeys.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffledKeys[index], shuffledKeys[swapIndex]] = [
      shuffledKeys[swapIndex],
      shuffledKeys[index],
    ];
  }

  for (const apiKey of shuffledKeys) {
    const leaseId = await acquireGeminiKey(apiKey, limits);
    if (!leaseId) continue;
    try {
      const inputTokens = tokenCountMode === "gemini"
        ? await requestGeminiTokenCount(apiKey, prompt)
        : estimateGeminiInputTokens(prompt, config);
      if (await reserveGeminiGeneration(apiKey, leaseId, inputTokens, limits)) {
        return { apiKey, leaseId };
      }
    } catch (error) {
      await releaseGeminiKey(apiKey, leaseId);
      throw error;
    }
    await releaseGeminiKey(apiKey, leaseId);
  }
  return null;
}

async function requestGeminiTokenCount(apiKey: string, prompt: string): Promise<number> {
  await recordGeminiApiCall(apiKey, "count_tokens");
  const response = await requestGeminiApi(
    apiKey,
    "count_tokens",
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:countTokens`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        generateContentRequest: {
          model: `models/${geminiModel}`,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw getJdError(
      `gemini_count_tokens_http_${response.status}`,
      "Gemini CountTokens failed.",
      readGeminiErrorMessage(response.body, apiKey),
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(response.body) as unknown;
  } catch {
    throw getJdError(
      "gemini_count_tokens_invalid_response",
      "Gemini CountTokens returned invalid JSON.",
    );
  }
  if (!isRecord(data) || typeof data.totalTokens !== "number" || !Number.isSafeInteger(data.totalTokens) || data.totalTokens < 0) {
    throw getJdError("gemini_count_tokens_invalid_response", "Gemini CountTokens returned invalid data.");
  }
  return data.totalTokens;
}

async function loadManagerCandidateProfiles(
  managerId: string,
): Promise<{
  profiles: CandidateProfileForEvaluation[];
  tooMany: boolean;
}> {
  const rows = await db
    .select({
      id: profiles.userId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      category: categories.name,
      subCategory: subCategories.name,
      jdMatching: profiles.jdMatching,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(subCategories, eq(subCategories.id, profiles.subCategoryId))
    .leftJoin(categories, eq(categories.id, subCategories.categoryId))
    .where(
      and(
        eq(users.parentUserId, managerId),
        eq(users.role, "account"),
        isNull(users.blockedAt),
      ),
    )
    .orderBy(asc(profiles.firstName), asc(profiles.lastName))
    .limit(maxManagerAccounts + 1);

  if (rows.length > maxManagerAccounts) return { profiles: [], tooMany: true };
  return {
    tooMany: false,
    profiles: rows.map((row) => ({
      id: row.id,
      name: ([row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate")
        .slice(0, 300),
      category: [row.category, row.subCategory].filter(Boolean).join(" / ") || null,
      jdMatching: row.jdMatching,
    })),
  };
}

async function requestGeminiJson(
  apiKey: string,
  prompt: string,
): Promise<unknown> {
  // One 45-second budget covers the first attempt and a possible retry.
  const signal = AbortSignal.timeout(45_000);
  const response = await withGeminiRetry(
    () => requestGeminiApi(
      apiKey,
      "generate_content",
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal,
        cache: "no-store",
      },
    ),
    // The retry is another request against the key's per-minute limit; its tokens were reserved with the first.
    { beforeRetry: () => recordGeminiApiCall(apiKey, "generate_content") },
  );

  if (!response.ok) {
    throw getJdError(
      `gemini_http_${response.status}`,
      `Gemini API returned HTTP ${response.status}.`,
      readGeminiErrorMessage(response.body, apiKey),
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(response.body) as unknown;
  } catch {
    throw getJdError(
      "gemini_invalid_http_response",
      "Gemini returned an invalid HTTP response.",
    );
  }
  const text = readGeminiText(data);
  if (!text || Buffer.byteLength(text, "utf8") > maxGeminiResponseBytes) {
    throw getJdError(
      "gemini_empty_response",
      "Gemini response was empty or too large.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw getJdError("gemini_invalid_json", "Gemini returned invalid JSON.");
  }
}

function readGeminiText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.candidates)) return "";
  const candidate = value.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content)) return "";
  if (!Array.isArray(candidate.content.parts)) return "";
  return candidate.content.parts
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function validateClassification(
  value: unknown,
  pageUrl: string,
  candidates: CandidateProfileForEvaluation[],
): GetJdClassification {
  if (
    !isRecord(value) ||
    typeof value.isJobPage !== "boolean" ||
    typeof value.isRemote !== "boolean" ||
    !isRecord(value.job) ||
    !Array.isArray(value.matchingProfileIndexes)
  ) {
    throw getJdError(
      "gemini_invalid_classification_schema",
      "Gemini response did not match the classification schema.",
    );
  }
  const job = value.job;
  const stringFields = [
    "title",
    "company",
    "description",
    "location",
    "country",
    "employmentType",
    "workplaceType",
    "salary",
    "jobUrl",
  ] as const;
  for (const field of stringFields) {
    if (typeof job[field] !== "string") {
      throw getJdError(
        "gemini_invalid_job_field",
        "Gemini response contained an invalid job field.",
      );
    }
  }
  const reasonValue = job.reason;
  if (typeof reasonValue !== "string") {
    throw getJdError(
      "gemini_invalid_job_field",
      "Gemini response contained an invalid job field.",
    );
  }
  const reason = reasonValue.trim();
  if (!reason || reason.length > 1200) {
    throw getJdError(
      "gemini_invalid_job_field",
      "Gemini response contained an invalid job field.",
    );
  }
  const matchingProfileIds = mapMatchingProfileIndexes(
    value.matchingProfileIndexes,
    candidates.map((candidate) => candidate.id),
  );
  if (!matchingProfileIds) {
    throw getJdError(
      "gemini_invalid_profile_indexes",
      "Gemini response contained invalid candidate indexes.",
    );
  }

  return {
    isJobPage: value.isJobPage,
    isRemote: value.isRemote,
    job: {
      title: String(job.title).slice(0, 500),
      company: String(job.company).slice(0, 500),
      description: String(job.description).slice(0, maxJobTextLength),
      location: String(job.location).slice(0, 500),
      country: String(job.country).slice(0, 200),
      employmentType: String(job.employmentType).slice(0, 300),
      workplaceType: String(job.workplaceType).slice(0, 100),
      salary: String(job.salary).slice(0, 500),
      jobUrl: pageUrl,
      reason,
    },
    matchingProfileIds,
  };
}

function readString(
  value: unknown,
  key: string,
  maxLength: number,
): string {
  if (!isRecord(value) || typeof value[key] !== "string") return "";
  const result = value[key].trim();
  return result.length > 0 && result.length <= maxLength ? result : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getJdError(
  code: string,
  message: string,
  providerMessage?: string,
): Error {
  return Object.assign(new Error(message), { code, providerMessage });
}

function readGeminiErrorMessage(
  responseBody: string,
  apiKey: string,
): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(responseBody) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const message = body.error.message;
  if (typeof message !== "string") return undefined;
  const safeMessage = message
    .replaceAll(apiKey, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return safeMessage || undefined;
}

function getGetJdProviderMessage(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "providerMessage" in error &&
    typeof error.providerMessage === "string"
  ) {
    return error.providerMessage;
  }
  return undefined;
}

function getGetJdFailureCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "gemini_timeout";
  }
  if (error instanceof TypeError) {
    return "gemini_network_error";
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown";
}

function logGetJdFailure(code: string, providerMessage?: string): void {
  console.error(
    `Get JD classification failed (code: ${code}).${providerMessage ? ` Provider: ${providerMessage}` : ""}`,
  );
}
