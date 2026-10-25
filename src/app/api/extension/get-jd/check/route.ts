import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { categories, profiles, users } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";
import {
  findGetJdDuplicateDetails,
  getJdAccountState,
  summarizeAccountStates,
  findManagerJobPresence,
} from "@/server/jobs/get-jd-jobs";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";

const maxManagerAccounts = 100;

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

  const job = readJob(body);
  if (!job) {
    return jsonResponse(
      { success: false, message: "Valid extracted job details are required." },
      400,
    );
  }

  try {
    const candidateRows = await db
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
        ),
      )
      .orderBy(asc(profiles.firstName), asc(profiles.lastName))
      .limit(maxManagerAccounts + 1);

    if (candidateRows.length > maxManagerAccounts) {
      return jsonResponse(
        { success: false, message: "You have too many active candidates to show at once." },
        413,
      );
    }
    if (candidateRows.length === 0) {
      return jsonResponse(
        { success: false, message: "Add an active candidate before saving jobs." },
        409,
      );
    }

    const [duplicateDetails, presence] = await Promise.all([
      findGetJdDuplicateDetails(
        manager.id,
        job,
        candidateRows.map((candidate) => candidate.id),
      ),
      findManagerJobPresence(manager.id, job),
    ]);
    const candidateProfiles = candidateRows.map((candidate) => {
      const duplicate = duplicateDetails.get(candidate.id) ?? null;
      // An account that already has this job is shown as saved, never offered again.
      const available = duplicate === null;
      return {
        id: candidate.id,
        name: [candidate.firstName, candidate.lastName]
          .filter(Boolean)
          .join(" ") || "Candidate",
        category: candidate.category || null,
        available,
        state: getJdAccountState(duplicate),
        rowId: duplicate?.rowId ?? null,
        duplicateKind: duplicate?.kind ?? null,
        jobStatus: duplicate?.jobStatus ?? null,
      };
    });
    const allCandidatesAssigned = candidateProfiles.every((candidate) => !candidate.available);
    const summary = summarizeAccountStates(candidateProfiles.map((candidate) => candidate.state));
    const toastKind = presence.inBids
      ? "applied"
      : presence.inJobs
        ? "added"
        : "new";

    return jsonResponse({
      success: true,
      exists: presence.inJobs || presence.inBids,
      allCandidatesAssigned,
      ...presence,
      toastKind,
      toastMessage: toastKind === "new" ? "New job — not in your Jobs or Bids yet." : summary.text,
      summary,
      profiles: candidateProfiles,
      message: allCandidatesAssigned
        ? "All candidates already have this job."
        : duplicateDetails.size > 0
          ? `${summary.text} Select more candidates to add them.`
          : "New job. Select candidates to save it.",
    });
  } catch (error) {
    console.error(
      `Get JD duplicate check failed (code: ${readErrorCode(error)}).`,
    );
    return jsonResponse(
      { success: false, message: "QTS could not check this job. Try again." },
      500,
    );
  }
}

function readJob(value: unknown): {
  jobUrl: string;
  jobTitle: string;
  company: string;
} | null {
  if (!isRecord(value) || !isRecord(value.job)) return null;
  const { job } = value;
  if (
    typeof job.jobUrl !== "string" ||
    typeof job.jobTitle !== "string" ||
    typeof job.company !== "string" ||
    job.jobUrl.length > 2048 ||
    job.jobTitle.trim().length === 0 ||
    job.jobTitle.length > 500 ||
    job.company.trim().length === 0 ||
    job.company.length > 500 ||
    !isHttpUrl(job.jobUrl)
  ) {
    return null;
  }
  return {
    jobUrl: normalizeJobUrl(job.jobUrl),
    jobTitle: job.jobTitle.trim(),
    company: job.company.trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown";
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
