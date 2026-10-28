import { and, eq, isNotNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
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
      { success: false, message: "A claimed job ID is required." },
      { status: 400 },
    );
  }
  const jobId = readText(body.jobId, 36);
  if (!uuidPattern.test(jobId)) {
    return NextResponse.json(
      { success: false, message: "A valid claimed job ID is required." },
      { status: 400 },
    );
  }

  try {
    const [released] = await db
      .update(jobs)
      // Only the hold goes: the job stays as it was, ready for the next Generation.
      .set({ generationLeaseExpiresAt: null })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
        ne(jobs.generationStatus, "completed"),
        isNotNull(jobs.generationLeaseExpiresAt),
      ))
      .returning({ id: jobs.id });
    if (!released) {
      return NextResponse.json(
        { success: false, message: "The claimed job is no longer processing." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, jobId });
  } catch (error) {
    console.error("Could not release queued Generation after shared setup failure.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not release the claimed Generation job." },
      { status: 500 },
    );
  }
}
