import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";
import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
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
        description: jobs.description,
        generationStatus: jobs.generationStatus,
      })
      .from(jobs)
      .where(and(
        eq(jobs.managerId, manager.id),
        sql`regexp_replace(split_part(btrim(${jobs.jobUrl}), '#', 1), '/+$', '') = ${normalizedUrl}`,
      ));

    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "No saved candidates exist for this job. Run Get JD and save candidates first.",
        },
        { status: 404 },
      );
    }

    const queueableIds = rows
      .filter((row) =>
        !["queued", "processing"].includes(row.generationStatus)
        && Boolean(row.description?.trim()),
      )
      .map((row) => row.id);
    const alreadyReady = rows.filter((row) =>
      ["queued", "processing"].includes(row.generationStatus),
    ).length;
    const missingDescription = rows.filter((row) => !row.description?.trim()).length;

    if (queueableIds.length > 0) {
      await db
        .update(jobs)
        .set({
          generationStatus: "queued",
          generationError: null,
          generationLeaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(jobs.managerId, manager.id),
          inArray(jobs.id, queueableIds),
        ));
    }

    const readyCount = queueableIds.length + alreadyReady;
    if (readyCount === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "The saved candidates do not have a job description. Run Get JD again before Generation.",
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
