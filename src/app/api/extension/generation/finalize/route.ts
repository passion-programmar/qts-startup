import { and, eq, exists } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationRuns, jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { isRecord, readText } from "@/server/generation/generation-values";
import { generationDownloadPaths } from "@/server/generation/generation-artifacts";

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
    return NextResponse.json({ success: false, message: "Generation IDs are required." }, { status: 400 });
  }
  const jobId = readText(body.jobId, 36);
  const generationId = readText(body.generationId, 36);
  if (!uuidPattern.test(jobId) || !uuidPattern.test(generationId)) {
    return NextResponse.json({ success: false, message: "Valid Generation IDs are required." }, { status: 400 });
  }

  try {
    const [run] = await db
      .select({
        id: generationRuns.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        jobTitle: jobs.jobTitle,
        company: jobs.company,
        createdAt: generationRuns.createdAt,
      })
      .from(generationRuns)
      .innerJoin(jobs, eq(jobs.id, generationRuns.jobId))
      .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
      .where(and(
        eq(generationRuns.id, generationId),
        eq(generationRuns.jobId, jobId),
        eq(generationRuns.managerId, manager.id),
        eq(generationRuns.status, "completed"),
        eq(jobs.managerId, manager.id),
      ))
      .limit(1);
    if (!run) {
      return NextResponse.json(
        { success: false, message: "The completed document package was not found for this job." },
        { status: 404 },
      );
    }
    const candidateName = [run.firstName, run.lastName].filter(Boolean).join(" ") || "Candidate";
    const downloadPaths = generationDownloadPaths({
      managerName: manager.displayName,
      candidateName,
      jobTitle: run.jobTitle,
      company: run.company,
      createdAt: run.createdAt,
    });
    const [, delivered] = await db.batch([
      db.update(jobs)
        .set({
          generationStatus: "completed",
          generationError: null,
          generationLeaseExpiresAt: null,
          resumeLocalPath: downloadPaths.resume,
          updatedAt: new Date(),
        })
        .where(and(
          eq(jobs.id, jobId),
          eq(jobs.managerId, manager.id),
          eq(jobs.generationStatus, "processing"),
          exists(db.select({ id: generationRuns.id }).from(generationRuns).where(and(
            eq(generationRuns.id, generationId),
            eq(generationRuns.jobId, jobId),
            eq(generationRuns.managerId, manager.id),
            eq(generationRuns.status, "completed"),
          ))),
        ))
        .returning({ id: jobs.id }),
      db.update(generationRuns)
        .set({ status: "delivered", updatedAt: new Date() })
        .where(and(
          eq(generationRuns.id, generationId),
          eq(generationRuns.jobId, jobId),
          eq(generationRuns.managerId, manager.id),
          eq(generationRuns.status, "completed"),
          exists(db.select({ id: jobs.id }).from(jobs).where(and(
            eq(jobs.id, jobId),
            eq(jobs.managerId, manager.id),
            eq(jobs.generationStatus, "completed"),
            eq(jobs.resumeLocalPath, downloadPaths.resume),
          ))),
        ))
        .returning({ id: generationRuns.id }),
    ]);
    if (!delivered.length) {
      return NextResponse.json(
        { success: false, message: "The queued job is no longer processing." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, jobId, generationId });
  } catch (error) {
    console.error("Could not finalize queued Generation job.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not finalize the Generation job." },
      { status: 500 },
    );
  }
}
