import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";
import { effectiveJobDescription, hasEffectiveJobDescription } from "@/server/jobs/job-description";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const jobUrl = isRecord(body) ? readText(body.jobUrl, 2048) : "";
  if (!jobUrl || !isHttpUrl(jobUrl)) {
    return NextResponse.json(
      { success: false, message: "A valid job-page URL is required." },
      { status: 400 },
    );
  }

  const normalizedUrl = normalizeJobUrl(jobUrl);
  try {
    const rows = await db
      .select({
        id: jobs.id,
        description: effectiveJobDescription(),
        jdMatching: profiles.jdMatching,
        resumeLocalPath: jobs.resumeLocalPath,
        generationAttemptCount: jobs.generationAttemptCount,
        generationStatus: jobs.generationStatus,
      })
      .from(jobs)
      .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
      .where(and(
        eq(jobs.managerId, manager.id),
        sql`regexp_replace(split_part(btrim(${jobs.jobUrl}), '#', 1), '/+$', '') = ${normalizedUrl}`,
      ));

    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "This job has not been saved for any candidate yet. Run Get JD and save it first.",
        },
        { status: 404 },
      );
    }

    const eligibleRows = rows.filter((row) =>
      // Every job not generated yet can be generated (failures and cancels record nothing).
      row.generationStatus !== "completed"
      && Boolean(row.description?.trim())
      && Boolean(row.jdMatching?.trim())
      && row.resumeLocalPath === null,
    );
    const queueableIds = eligibleRows
      .filter((row) => !["queued", "processing"].includes(row.generationStatus))
      .map((row) => row.id);
    const alreadyReady = eligibleRows.filter((row) =>
      ["queued", "processing"].includes(row.generationStatus),
    ).length;
    const missingDescription = rows.filter((row) => !row.description?.trim()).length;

    if (queueableIds.length > 0) {
      await db
        .update(jobs)
        .set({
          generationStatus: "queued",
          generationError: null,
          generationPromptId: null,
          generationLeaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(jobs.managerId, manager.id),
          inArray(jobs.id, queueableIds),
          inArray(jobs.generationStatus, ["not_queued", "failed", "cancelled"]),
          lt(jobs.generationAttemptCount, 2),
          isNull(jobs.resumeLocalPath),
          hasEffectiveJobDescription(),
          sql`length(btrim(${profiles.jdMatching})) > 0`,
        ));
    }

    const readyCount = queueableIds.length + alreadyReady;
    if (readyCount === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No saved candidate job meets Generation eligibility requirements.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      queuedCount: queueableIds.length,
      readyCount,
      skippedMissingDescription: missingDescription,
    });
  } catch (error) {
    console.error("Could not queue extension Generation jobs.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not queue Generation for this job." },
      { status: 500 },
    );
  }
}
