import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { categories, profiles, subCategories, users } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  findGetJdDuplicate,
  insertGetJdJob,
} from "@/server/jobs/get-jd-jobs";
import { readExtensionSavedJob } from "@/server/jobs/get-jd-save-values";
import { isGetJdEvaluationAccepted } from "@/server/gemini/job-evaluation-config";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";

const maxProfilesPerSave = 100;

type SaveProfileResult = {
  profileId: string;
  name: string;
  category: string | null;
  status: "saved" | "already_exists" | "failed";
  message: string;
  jobId?: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse(
      { success: false, message: "Extension session is invalid or expired." },
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
  const profileIds = readProfileIds(body);
  if (!job || !profileIds) {
    return jsonResponse(
      { success: false, message: "Valid job details and selected profile IDs are required." },
      400,
    );
  }
  try {
    if (
      await getGetJdMatchingMode() === "gemini" &&
      !isGetJdEvaluationAccepted(readEvaluationDecision(body))
    ) {
      return jsonResponse(
        {
          success: false,
          message: "This job has not passed Gemini job validation and remote eligibility.",
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
          inArray(users.id, profileIds),
        ),
      );

    if (candidates.length !== profileIds.length) {
      return jsonResponse(
        { success: false, message: "One or more selected profiles are unavailable." },
        403,
      );
    }

    const results: SaveProfileResult[] = [];
    for (const candidate of candidates) {
      const name = [candidate.firstName, candidate.lastName]
        .filter(Boolean)
        .join(" ") || "Candidate";
      const duplicate = await findGetJdDuplicate(manager.id, job, candidate.id);
      if (duplicate) {
        if (duplicate === "job_list") {
          await insertGetJdJob({
            ...job,
            managerId: manager.id,
            candidateId: candidate.id,
          });
        }
        results.push({
          profileId: candidate.id,
          name,
          category: [candidate.category, candidate.subCategory].filter(Boolean).join(" / ") || null,
          status: "already_exists",
          message: duplicate === "applied"
            ? "Already applied."
            : "Already present in the Job List.",
        });
        continue;
      }

      try {
        const savedJob = await insertGetJdJob({
          ...job,
          managerId: manager.id,
          candidateId: candidate.id,
        });
        if (savedJob.status !== "saved") {
          results.push({
            profileId: candidate.id,
            name,
            category: [candidate.category, candidate.subCategory].filter(Boolean).join(" / ") || null,
            status: "already_exists",
            message: savedJob.status === "applied"
              ? "Already applied."
              : "Already present in the Job List.",
          });
          continue;
        }
        results.push({
          profileId: candidate.id,
          name,
          category: [candidate.category, candidate.subCategory].filter(Boolean).join(" / ") || null,
          status: "saved",
          message: "Added to the Job List.",
          jobId: savedJob.jobId,
        });
      } catch (error) {
        logSaveFailure(error);
        results.push({
          profileId: candidate.id,
          name,
          category: [candidate.category, candidate.subCategory].filter(Boolean).join(" / ") || null,
          status: "failed",
          message: "Could not add this profile to the Job List.",
        });
      }
    }

    return jsonResponse({
      success: true,
      results,
      savedCount: results.filter((result) => result.status === "saved").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      duplicateCount: results.filter((result) => result.status === "already_exists").length,
    });
  } catch (error) {
    logSaveFailure(error);
    return jsonResponse(
      { success: false, message: "QTS could not save the selected jobs. Try again." },
      500,
    );
  }
}

function readProfileIds(value: unknown): string[] | null {
  if (!isRecord(value) || !Array.isArray(value.profileIds)) return null;
  const profileIds = value.profileIds;
  if (
    profileIds.length === 0 ||
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
