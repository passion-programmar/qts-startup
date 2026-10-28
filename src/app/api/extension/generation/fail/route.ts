import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { generationRuns, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { resolveExtensionBrowser } from "@/server/browsers/extension-browsers";
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
    // A failure or a cancel records nothing (the reason is the Chrome's notice): the run that did
    // not finish goes, and this Chrome's hold, so the job stays ready for the next Generation.
    if (generationId) {
      await db
        .delete(generationRuns)
        .where(and(
          eq(generationRuns.id, generationId),
          eq(generationRuns.jobId, jobId),
          eq(generationRuns.managerId, manager.id),
          inArray(generationRuns.status, ["pending", "completed", "failed"]),
        ));
    }
    const browser = await resolveExtensionBrowser(manager.id, request);
    const [job] = await db
      .update(jobs)
      .set({ generationLeaseExpiresAt: null })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
        ne(jobs.generationStatus, "completed"),
        ...(browser ? [or(isNull(jobs.generationBrowserId), eq(jobs.generationBrowserId, browser.id))] : []),
      ))
      .returning({ id: jobs.id });
    if (cancelled) return NextResponse.json({ success: true, jobId, cancelled: true });
    if (!job) {
      return NextResponse.json(
        { success: false, message: "The queued job is not currently processing." },
        { status: 409 },
      );
    }
    // The extension tries a failed job once more in the same run, then leaves it for the next run.
    return NextResponse.json({ success: true, jobId, canRetry: true });
  } catch (error) {
    console.error("Could not record queued Generation failure.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not record the Generation failure." },
      { status: 500 },
    );
  }
}
