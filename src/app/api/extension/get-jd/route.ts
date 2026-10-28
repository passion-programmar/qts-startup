import {
  and,
  asc,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  categories,
  profiles,
  prompts,
  users,
} from "@/db/schema";
import { type ExtensionManager, getExtensionManager } from "@/lib/extension-auth";
import { withPageCheck } from "@/server/get-jd/get-jd-page-checks";
import { db } from "@/lib/db";
import {
  geminiModel,
  getGeminiApiKeys,
  getGeminiApiLimits,
  requestGeminiApi,
} from "@/lib/gemini-usage";
import { geminiJobEvaluationGenerationConfig } from "@/server/gemini/job-evaluation-config";
import { candidatesWithJdNotes } from "@/server/gemini/candidates-with-jd-notes";
import { buildGetJdEvaluationPrompt } from "@/server/gemini/build-get-jd-evaluation-prompt";
import { mapMatchingProfileIndexes } from "@/server/gemini/matching-profile-indexes";
import { getGeminiTokenCountMode } from "@/server/gemini/token-count-mode";
import { scheduleDailyCleanup } from "@/server/database/database-usage";
import {
  findExpiredApplication,
  findGetJdDuplicateDetails,
  findManagerJobPresence,
  getJdAccountState,
  insertGetJdJob,
  summarizeAccountStates,
  updateExistingGetJdJobDetails,
} from "@/server/jobs/get-jd-jobs";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";
import { getGetJdFailureMessage } from "@/server/gemini/get-jd-failure-message";
import {
  type GeminiTokenCounts,
  readGeminiErrorMessage,
  readGeminiText,
  withAvailableGeminiKey,
} from "@/server/gemini/gemini-keys";
import { normalizeCompanyName } from "@/server/jobs/job-key";
import { sourceSiteUrl } from "@/server/jobs/source-site";

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
  // The company of the candidate's most recent experience; a job there is never saved for them.
  currentEmployer: string | null;
};

/** Whether the candidate's most recent employer is the job's company. */
function worksAtCompany(candidate: CandidateProfileForEvaluation, company: string): boolean {
  const employer = normalizeCompanyName(candidate.currentEmployer ?? "");
  return Boolean(employer) && employer === normalizeCompanyName(company);
}

type GetJdClassification = {
  isJobPage: boolean;
  isRemote: boolean;
  job: {
    title: string;
    company: string;
    description: string;
    location: string;
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
  scheduleDailyCleanup();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { success: false, message: "Request body must be valid JSON." },
      400,
    );
  }

  // The first Chrome to open a job link asks Gemini; others opening it meanwhile get that verdict.
  // Try again and Send anyway (bypassPageCheck) ask Gemini again.
  const requestedUrl = readString(body, "pageUrl", maxPageUrlLength);
  const bypassPageCheck = typeof body === "object" && body !== null
    && (body as { bypassPageCheck?: unknown }).bypassPageCheck === true;
  if (!requestedUrl || !isHttpUrl(requestedUrl)) return evaluateGetJdPage(manager, body);
  return withPageCheck(manager.id, requestedUrl, bypassPageCheck, () => evaluateGetJdPage(manager, body));
}

async function evaluateGetJdPage(manager: ExtensionManager, body: unknown): Promise<NextResponse> {
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
    // 7 days after its first application (any account), a job is rejected for everyone: no Gemini.
    const expiredByUrl = await findExpiredApplication(manager.id, { jobUrl: pageUrl, jobTitle: "", company: "" });
    if (expiredByUrl) return expiredApplicationResponse(expiredByUrl);
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

    // A key Gemini answers "unavailable" is paused for 5 minutes and another key is asked.
    const modelResult = await withAvailableGeminiKey(
      apiKeys,
      [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig,
      await getGeminiTokenCountMode(),
      await getGeminiApiLimits(),
      ({ apiKey, tokenCounts }) => requestGeminiJson(apiKey, promptText, tokenCounts),
    );
    if (modelResult === null) {
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
    // Where the Manager found the job: the page it was opened from, its link's source tag, or its own site.
    const sourceSite = sourceSiteUrl({ openerUrl: readString(body, "openerUrl", maxPageUrlLength) || null, jobUrl: pageUrl });
    const jobIdentity = {
      jobUrl: pageUrl,
      jobTitle: classification.job.title,
      company: classification.job.company,
    };
    // The same job under another address (LinkedIn and the company's page) is known only now.
    const expiredByTitle = await findExpiredApplication(manager.id, jobIdentity);
    if (expiredByTitle) return expiredApplicationResponse(expiredByTitle);
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
      if (worksAtCompany(candidate, classification.job.company)) continue;
      const jobToSave = {
        jobUrl: classification.job.jobUrl,
        jobTitle: classification.job.title,
        company: classification.job.company,
        description: classification.job.description,
        location: classification.job.location,
        employmentType: classification.job.employmentType,
        workplaceType: classification.job.workplaceType,
        salary: classification.job.salary,
        jobReason: classification.job.reason,
        pageText,
        managerId: manager.id,
        candidateId: candidate.id,
        autoSavedByGetJd: true,
        sourceSiteUrl: sourceSite,
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
      // A candidate working at this company now is shown greyed out and can't be ticked.
      const worksHere = !autoSaved && duplicate === null && worksAtCompany(candidate, classification.job.company);
      return {
        id: candidate.id,
        name: candidate.name,
        category: candidate.category,
        recommended: matchingProfileIds.has(candidate.id) && !worksHere,
        autoSaved,
        autoSaveJobId: autoSavedJobs.get(candidate.id) ?? null,
        autoSaveFailed: autoSaveFailedProfileIds.has(candidate.id),
        // An account that has the job (saved earlier or just auto-saved) is not "available" to add again.
        available: !autoSaved && duplicate === null && !worksHere,
        state: autoSaved ? "has_job" : worksHere ? "works_here" : getJdAccountState(duplicate),
        worksAt: worksHere ? candidate.currentEmployer : null,
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
      jdMatching: profiles.jdMatching,
      // The current job first, else the one that ended last.
      currentEmployer: sql<string | null>`(
        select e.company_name from experiences e
         where e.profile_user_id = ${profiles.userId}
         order by e.is_current desc, e.end_date desc nulls first, e.start_date desc nulls last
         limit 1
      )`,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
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
      category: row.category || null,
      jdMatching: row.jdMatching,
      currentEmployer: row.currentEmployer,
    })),
  };
}

async function requestGeminiJson(
  apiKey: string,
  prompt: string,
  tokenCounts: GeminiTokenCounts,
): Promise<unknown> {
  // One request with this key; a 5xx sends the request to another key (withAvailableGeminiKey).
  const response = await requestGeminiApi(
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
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    },
    tokenCounts,
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

/** Get JD's answer for a job first applied to more than 7 days ago: nothing is evaluated or saved. */
function expiredApplicationResponse(first: { candidateName: string; appliedAt: Date }): NextResponse {
  const days = Math.floor((Date.now() - first.appliedAt.getTime()) / 86_400_000);
  const message = `First applied ${days} days ago (${first.candidateName}) — skipped.`;
  return jsonResponse({
    success: true,
    skippedEvaluation: true,
    expiredApplication: { candidateName: first.candidateName, appliedAt: first.appliedAt.toISOString() },
    classification: { isJobPage: true, isRemote: true, matchingProfileIds: [] },
    profiles: [],
    autoSavedProfileIds: [],
    autoSavedJobs: [],
    autoSaveFailureCount: 0,
    allCandidatesAssigned: true,
    exists: true,
    inJobs: false,
    inBids: true,
    toastKind: "applied",
    toastMessage: message,
    message,
  });
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
