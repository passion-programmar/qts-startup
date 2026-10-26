import { and, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { resolveExtensionBrowser } from "@/server/browsers/extension-browsers";
import { isRecord, readText } from "@/server/generation/generation-values";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const leaseDurationMs = 20 * 60 * 1000;

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
  const jobId = isRecord(body) ? readText(body.jobId, 36) : "";
  if (!uuidPattern.test(jobId)) {
    return NextResponse.json(
      { success: false, message: "A valid queued job ID is required." },
      { status: 400 },
    );
  }

  try {
    // Only the Chrome processing the job renews it.
    const browser = await resolveExtensionBrowser(manager.id, request);
    const now = new Date();
    const [renewed] = await db
      .update(jobs)
      .set({
        generationLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        updatedAt: now,
      })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
        eq(jobs.generationStatus, "processing"),
        ...(browser ? [or(isNull(jobs.generationBrowserId), eq(jobs.generationBrowserId, browser.id))] : []),
      ))
      .returning({ id: jobs.id });
    if (!renewed) {
      return NextResponse.json(
        { success: false, message: "Generation is no longer processing for this job." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, generationStatus: "processing" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not renew the Generation lease.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not renew the Generation lease." },
      { status: 500 },
    );
  }
}
