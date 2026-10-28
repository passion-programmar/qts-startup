import { and, eq, inArray, ne } from "drizzle-orm";
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
  if (!isRecord(body)) {
    return NextResponse.json(
      { success: false, message: "A queued job ID is required." },
      { status: 400 },
    );
  }
  const jobId = readText(body.jobId, 36);
  if (!uuidPattern.test(jobId)) {
    return NextResponse.json(
      { success: false, message: "A valid queued job ID is required." },
      { status: 400 },
    );
  }

  try {
    const [job] = await db
      .select({ generationStatus: jobs.generationStatus })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.managerId, manager.id)))
      .limit(1);
    if (!job || job.generationStatus === "completed") {
      return NextResponse.json(
        { success: false, message: "The job is already generated." },
        { status: 409 },
      );
    }
    // A cancel records nothing: the hold and the unfinished run go, the job stays ready.
    const [cancelled] = await db
      .update(jobs)
      .set({ generationLeaseExpiresAt: null })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
        ne(jobs.generationStatus, "completed"),
      ))
      .returning({ id: jobs.id });
    await db
      .delete(generationRuns)
      .where(and(
        eq(generationRuns.jobId, jobId),
        eq(generationRuns.managerId, manager.id),
        inArray(generationRuns.status, ["pending", "completed", "failed"]),
      ));
    if (!cancelled) {
      return NextResponse.json(
        { success: false, message: "The job changed before it could be cancelled." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    console.error("Could not cancel queued Generation from the extension.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not cancel Generation." },
      { status: 500 },
    );
  }
}
