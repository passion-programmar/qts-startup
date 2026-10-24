import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationRuns, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (!isRecord(body)) {
    return NextResponse.json(
      { success: false, message: "A queued job ID and failure reason are required." },
      { status: 400 },
    );
  }
  const jobId = readText(body.jobId, 36);
  const generationId = readText(body.generationId, 36);
  const reason = readText(body.reason, 2000);
  const cancelled = body.cancelled === true;
  if (!uuidPattern.test(jobId) || (generationId && !uuidPattern.test(generationId)) || !reason) {
    return NextResponse.json(
      { success: false, message: "A valid queued job ID and failure reason are required." },
      { status: 400 },
    );
  }

  try {
    if (generationId) {
      await db
        .update(generationRuns)
        .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
        .where(and(
          eq(generationRuns.id, generationId),
          eq(generationRuns.jobId, jobId),
          eq(generationRuns.managerId, manager.id),
          inArray(generationRuns.status, ["pending", "completed"]),
        ));
    }
    if (cancelled) {
      await db
        .update(jobs)
        .set({
          generationStatus: "cancelled",
          generationAttemptCount: sql`greatest(${jobs.generationAttemptCount} - 1, 0)`,
          generationError: null,
          generationLeaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(jobs.id, jobId),
          eq(jobs.managerId, manager.id),
          eq(jobs.generationStatus, "processing"),
        ));
      return NextResponse.json({ success: true, jobId, cancelled: true });
    }
    const [failed] = await db
      .update(jobs)
      .set({
        generationStatus: "failed",
        generationError: reason,
        generationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
        eq(jobs.generationStatus, "processing"),
      ))
      .returning({ id: jobs.id });
    if (!failed) {
      return NextResponse.json(
        { success: false, message: "The queued job is not currently processing." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    console.error("Could not record queued Generation failure.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not record the Generation failure." },
      { status: 500 },
    );
  }
}
