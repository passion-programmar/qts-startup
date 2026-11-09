import {
  and,
  asc,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  profiles,
  prompts,
  users,
} from "@/db/schema";
import { type ExtensionManager, getExtensionManager } from "@/lib/extension-auth";
import { withPageCheck } from "@/server/get-jd/get-jd-page-checks";
import { db } from "@/lib/db";
import { AiJobError, aiRequestBudgetMs } from "@/server/gemini/ai-job";
import { runAiRequest } from "@/server/gemini/ai-request";
import { geminiJobEvaluationGenerationConfig, groqJobEvaluationJsonHint } from "@/server/gemini/job-evaluation-config";
import { type CareerTimelineEntry, candidatesWithCareerTimeline } from "@/server/gemini/candidates-with-career-timeline";
import { buildGetJdEvaluationPrompt } from "@/server/gemini/build-get-jd-evaluation-prompt";
import { mapMatchingProfileIndexes } from "@/server/gemini/matching-profile-indexes";
import { scheduleDailyCleanup } from "@/server/database/database-usage";
import {
  getJdAccountState,
  insertGetJdJob,
  summarizeAccountStates,
} from "@/server/jobs/get-jd-jobs";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";
import { getGetJdFailureMessage } from "@/server/gemini/get-jd-failure-message";
import { normalizeCompanyName } from "@/server/jobs/job-key";
import { getPrecheckTickets } from "@/server/get-jd/precheck-ticket";
import type { GetJdIdentity } from "@/server/get-jd/global-precheck";
import type { GetJdDuplicate } from "@/server/jobs/get-jd-account-states";
import { sourceSiteUrl } from "@/server/jobs/source-site";

// The AI tries can take up to 55 s in total (see ai-job.ts). Without this, a Vercel project
// with Fluid compute turned off would stop the function after 10 s.
export const maxDuration = 60;

const maxPageUrlLength = 2048;
const maxPageTitleLength = 500;
const maxPageTextLength = 100_000;
const maxManagerAccounts = 100;
const maxGeminiResponseBytes = 1_000_000;
const invalidPageReason = "The page does not show one clear, active job posting.";

const generationConfig = geminiJobEvaluationGenerationConfig;

type CandidateProfileForEvaluation = {
  id: string;
  name: string;
  category: string | null;
  // The profile's job titles and months, newest first. Companies and descriptions stay out.
  employmentTimeline: CareerTimelineEntry[];
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
  const deadlineAt = Date.now() + aiRequestBudgetMs;
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

  const requestedUrl = readString(body, "pageUrl", maxPageUrlLength);
  if (!requestedUrl || !isHttpUrl(requestedUrl)) return jsonResponse({ success: false, message: "A valid job URL is required." }, 400);
  const token = readString(body, "precheckToken", 10000);
  const identity = await getPrecheckTickets().verify(token, manager.id, requestedUrl);
  if (!identity) return jsonResponse({ success: false, message: "The Jobs/Bids precheck is missing or expired. Refresh the job page to retry." }, 409);
  // The existing in-progress claim/replay avoids repeated Gemini calls. It does not query Jobs/Bids.
  return withPageCheck(manager.id, requestedUrl, false, () => evaluateGetJdPage(manager, body, identity, deadlineAt));
}

/** What the extension needs to know to wait and retry by itself, or to show the reason. */
function aiFailureResponse(error: AiJobError): NextResponse {
  logGetJdFailure(error.code);
  const body = { success: false, message: error.message, diagnosticCode: error.code };
  switch (error.code) {
    case "ai_busy":
      return jsonResponse({ ...body, autoRetry: { kind: "soon" } }, 503);
    case "ai_quota_used_up":
      return jsonResponse({ ...body, autoRetry: { kind: "at", at: error.retryAt } }, 429);
    case "ai_too_large":
      return jsonResponse(body, 413);
    case "ai_bad_request":
      return jsonResponse(body, 422);
    case "ai_not_configured":
      return jsonResponse(body, 503);
  }
}

async function evaluateGetJdPage(manager: ExtensionManager, body: unknown, identity: GetJdIdentity, deadlineAt: number): Promise<NextResponse> {
  const pageUrl = readString(body, "pageUrl", maxPageUrlLength);
  const pageTitle = readString(body, "pageTitle", maxPageTitleLength);
  const pageText = readString(body, "originalDescription", maxPageTextLength);
  if (!pageUrl || !isHttpUrl(pageUrl) || !pageTitle || !pageText) {
    return jsonResponse(
      { success: false, message: "A valid job URL, title, and complete original job description (at most 100,000 characters) are required. Nothing was truncated or saved." },
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
    const candidatesForEvaluation = candidatesWithCareerTimeline(candidateProfiles);

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

    const candidateContext = candidatesForEvaluation.map((candidate, index) => ({
      candidateIndex: index,
      candidateName: candidate.name,
      employmentTimeline: candidate.employmentTimeline,
    }));
    const promptText = buildGetJdEvaluationPrompt({
      savedPrompt: prompt.promptTemplate,
      pageUrl,
      pageTitle,
      pageText,
      candidates: candidateContext,
    });

    // Key rotation, model switching and pauses are all in runAiRequest. A reply that doesn't pass
    // this check counts as unusable, so the next model is asked.
    const classification = await runAiRequest({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig,
      jsonHint: groqJobEvaluationJsonHint,
      deadlineAt,
      parse: (text) => {
        if (!text || Buffer.byteLength(text, "utf8") > maxGeminiResponseBytes) throw new Error("Empty or too large.");
        return validateClassification(JSON.parse(text) as unknown, pageUrl, candidatesForEvaluation);
      },
    });
    classification.job.description = pageText;
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
    // No post-Gemini duplicate precheck. Save-time locks/indexes remain in insertGetJdJob.
    const duplicateDetails = new Map<string, GetJdDuplicate>();
    classification.job.description = pageText;
    classification.job.title = identity.jobTitle || classification.job.title;
    classification.job.company = identity.company || classification.job.company;
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
    const presence = { inJobs: autoSavedProfileIds.size > 0 || duplicateDetails.size > 0,
      inBids: [...duplicateDetails.values()].some((entry) => entry.kind === "applied") };
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
    if (error instanceof AiJobError) return aiFailureResponse(error);
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
      category: profiles.managerCategory,
      employmentTimeline: sql<CareerTimelineEntry[]>`coalesce((
        select json_agg(json_build_object(
            'jobTitle', btrim(e.job_title),
            'start', to_char(e.start_date, 'YYYY-MM'),
            'end', to_char(e.end_date, 'YYYY-MM'),
            'isCurrent', e.is_current
          ) order by e.is_current desc, e.end_date desc nulls first, e.start_date desc nulls last, e.sort_order asc)
          from experiences e
         where e.profile_user_id = ${profiles.userId} and btrim(e.job_title) <> ''
      ), '[]'::json)`,
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
      employmentTimeline: row.employmentTimeline,
      currentEmployer: row.currentEmployer,
    })),
  };
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
  // The saved prompt only asks for a reason when the page is a job, so an invalid page may have none.
  const reason = reasonValue.trim() || (value.isJobPage ? "" : invalidPageReason);
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
      description: "", // The caller supplies the unchanged locally extracted original JD.
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
