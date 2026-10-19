import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { categories, profiles, users, jobs } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { findGetJdDuplicate } from "@/lib/extension-get-jd";
import { db } from "@/lib/db";

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

  const job = readJob(body);
  const profileIds = readProfileIds(body);
  if (!job || !profileIds) {
    return jsonResponse(
      { success: false, message: "Valid job details and selected profile IDs are required." },
      400,
    );
  }

  try {
    const candidates = await db
      .select({
        id: profiles.userId,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        category: categories.name,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(categories, eq(categories.id, profiles.categoryId))
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

    const today = new Date().toISOString().slice(0, 10);
    const results: SaveProfileResult[] = [];
    for (const candidate of candidates) {
      const name = [candidate.firstName, candidate.lastName]
        .filter(Boolean)
        .join(" ") || "Candidate";
      const duplicate = await findGetJdDuplicate(manager.id, job, candidate.id);
      if (duplicate) {
        results.push({
          profileId: candidate.id,
          name,
          category: candidate.category,
          status: "already_exists",
          message: duplicate === "applied"
            ? "Already applied."
            : "Already present in the Job List.",
        });
        continue;
      }

      try {
        const [savedJob] = await db
          .insert(jobs)
          .values({
            jobUrl: job.jobUrl,
            jobTitle: job.jobTitle,
            company: job.company,
            location: job.location,
            managerId: manager.id,
            candidateId: candidate.id,
            date: today,
            status: "todo",
          })
          .returning({ id: jobs.id });
        if (!savedJob) {
          throw new Error("Job insert returned no row.");
        }
        results.push({
          profileId: candidate.id,
          name,
          category: candidate.category,
          status: "saved",
          message: "Added to the Job List.",
          jobId: savedJob.id,
        });
      } catch (error) {
        logSaveFailure(error);
        results.push({
          profileId: candidate.id,
          name,
          category: candidate.category,
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

function readJob(
  value: unknown,
): { jobUrl: string; jobTitle: string; company: string; location: string | null } | null {
  if (!isRecord(value) || !isRecord(value.job)) return null;
  const { job } = value;
  if (
    typeof job.jobUrl !== "string" ||
    typeof job.title !== "string" ||
    typeof job.company !== "string" ||
    typeof job.location !== "string" ||
    job.jobUrl.length > 2048 ||
    job.title.trim().length === 0 ||
    job.title.length > 500 ||
    job.company.trim().length === 0 ||
    job.company.length > 500 ||
    job.location.length > 500 ||
    !isHttpUrl(job.jobUrl)
  ) {
    return null;
  }
  return {
    jobUrl: normalizeUrl(job.jobUrl),
    jobTitle: job.title.trim(),
    company: job.company.trim(),
    location: job.location.trim() || null,
  };
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

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
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
