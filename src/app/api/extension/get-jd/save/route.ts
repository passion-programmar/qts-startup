import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { categories, profiles, subCategories, users } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  findGetJdDuplicateDetails,
  insertGetJdJob,
  removeGetJdJobAccount,
} from "@/server/jobs/get-jd-jobs";
import { readExtensionSavedJob } from "@/server/jobs/get-jd-save-values";
import { isGetJdEvaluationAccepted } from "@/server/gemini/job-evaluation-config";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";

const maxProfilesPerSave = 100;

type SaveProfileResult = {
  profileId: string;
  name: string;
  category: string | null;
  status: "saved" | "already_exists" | "removed" | "locked" | "failed";
  message: string;
  jobId?: string;
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

  const job = readExtensionSavedJob(body);
  const profileIds = readProfileIds(body, "profileIds");
  // Explicit removals (accounts unchecked in the panel); never inferred from what is missing.
  const removeProfileIds = readProfileIds(body, "removeProfileIds");
  if (
    !job || !profileIds || !removeProfileIds ||
    profileIds.length + removeProfileIds.length === 0 ||
    profileIds.some((id) => removeProfileIds.includes(id))
  ) {
    return jsonResponse(
      { success: false, message: "The job details or candidate selection are invalid. Run Get JD on the page again." },
      400,
    );
  }
  try {
    if (
      profileIds.length > 0 &&
      await getGetJdMatchingMode(manager.id) === "gemini" &&
      !isGetJdEvaluationAccepted(readEvaluationDecision(body))
    ) {
      return jsonResponse(
        {
          success: false,
          message: "This page was not confirmed as a remote job, so it cannot be saved.",
        },
        409,
      );
    }

    const candidates = await db
      .select({
        id: profiles.userId,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        category: categories.name,
        subCategory: subCategories.name,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(subCategories, eq(subCategories.id, profiles.subCategoryId))
      .leftJoin(categories, eq(categories.id, subCategories.categoryId))
      .where(
        and(
          eq(users.parentUserId, manager.id),
          eq(users.role, "account"),
          isNull(users.blockedAt),
          inArray(users.id, [...profileIds, ...removeProfileIds]),
        ),
      );

    if (candidates.length !== profileIds.length + removeProfileIds.length) {
      return jsonResponse(
        { success: false, message: "One or more selected candidates are no longer available. Run Get JD again to refresh the list." },
        403,
      );
    }

    const results: SaveProfileResult[] = [];
    const describe = (candidate: (typeof candidates)[number]) => ({
      profileId: candidate.id,
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate",
      category: [candidate.category, candidate.subCategory].filter(Boolean).join(" / ") || null,
    });

    // Removals first, account by account; applied accounts and running Generation are kept.
    if (removeProfileIds.length > 0) {
      const existing = await findGetJdDuplicateDetails(manager.id, job, removeProfileIds);
      for (const candidate of candidates.filter((entry) => removeProfileIds.includes(entry.id))) {
        const rowId = existing.get(candidate.id)?.rowId ?? null;
        try {
          const removed = rowId ? await removeGetJdJobAccount(manager.id, rowId) : false;
          results.push({
            ...describe(candidate),
            status: removed ? "removed" : rowId ? "locked" : "removed",
            message: removed || !rowId
              ? "Removed from this job."
              : "Kept: this candidate applied or Generation is running.",
          });
        } catch (error) {
          logSaveFailure(error);
          results.push({ ...describe(candidate), status: "failed", message: "Could not remove this candidate from the job." });
        }
      }
    }

    // Additions, one by one: the first account creates the job's relation_id, later ones reuse it.
    for (const candidate of candidates.filter((entry) => profileIds.includes(entry.id))) {
      try {
        const savedJob = await insertGetJdJob({
          ...job,
          managerId: manager.id,
          candidateId: candidate.id,
        });
        results.push(savedJob.status === "saved"
          ? { ...describe(candidate), status: "saved", message: "Saved to Jobs.", jobId: savedJob.jobId }
          : {
            ...describe(candidate),
            status: "already_exists",
            message: savedJob.status === "applied" ? "Already applied (in Bids)." : "Already in Jobs.",
          });
      } catch (error) {
        logSaveFailure(error);
        results.push({ ...describe(candidate), status: "failed", message: "Could not save this candidate to Jobs." });
      }
    }

    return jsonResponse({
      success: true,
      results,
      savedCount: results.filter((result) => result.status === "saved").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      duplicateCount: results.filter((result) => result.status === "already_exists").length,
      removedCount: results.filter((result) => result.status === "removed").length,
      lockedCount: results.filter((result) => result.status === "locked").length,
    });
  } catch (error) {
    logSaveFailure(error);
    return jsonResponse(
      { success: false, message: "QTS could not save the selected jobs. Try again." },
      500,
    );
  }
}

function readProfileIds(value: unknown, field: "profileIds" | "removeProfileIds"): string[] | null {
  if (!isRecord(value)) return null;
  if (value[field] === undefined) return [];
  if (!Array.isArray(value[field])) return null;
  const profileIds = value[field];
  if (
    profileIds.length > maxProfilesPerSave ||
    !profileIds.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) ||
    new Set(profileIds).size !== profileIds.length
  ) {
    return null;
  }
  return profileIds;
}

function readEvaluationDecision(
  value: unknown,
): { isJobPage: boolean; isRemote: boolean } {
  if (!isRecord(value) || !isRecord(value.evaluation)) {
    return { isJobPage: false, isRemote: false };
  }
  return {
    isJobPage: value.evaluation.isJobPage === true,
    isRemote: value.evaluation.isRemote === true,
  };
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

function logSaveFailure(error: unknown): void {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`Get JD save failed (code: ${code}).`);
}
