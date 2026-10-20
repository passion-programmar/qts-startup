import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { findManagerJobPresence } from "@/server/jobs/get-jd-jobs";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";

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
  if (!job) {
    return jsonResponse(
      { success: false, message: "Valid extracted job details are required." },
      400,
    );
  }

  try {
    const presence = await findManagerJobPresence(manager.id, job);
    const exists = presence.inJobs || presence.inBids;
    return jsonResponse({
      success: true,
      exists,
      ...presence,
      message: presence.inBids
        ? "You have already applied to this job."
        : presence.inJobs
          ? "This job already exists in Jobs."
          : "This is a new job!",
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
