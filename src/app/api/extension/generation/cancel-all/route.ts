import { and, eq, isNotNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { resolveExtensionBrowser } from "@/server/browsers/extension-browsers";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }

  try {
    // Cancel in a launcher stops only that Chrome's Generation; "Stop all" on the Jobs page stops
    // every Chrome. Extensions that send no Chrome identity still cancel all of the Manager's jobs.
    const browser = await resolveExtensionBrowser(manager.id, request);
    const cancelled = await db
      .update(jobs)
      // Only the holds go: the jobs stay as they were, ready for the next Generation.
      .set({ generationLeaseExpiresAt: null })
      .where(and(
        eq(jobs.managerId, manager.id),
        ne(jobs.generationStatus, "completed"),
        isNotNull(jobs.generationLeaseExpiresAt),
        ...(browser ? [eq(jobs.generationBrowserId, browser.id)] : []),
      ))
      .returning({ id: jobs.id });

    return NextResponse.json({ success: true, requeuedCount: cancelled.length });
  } catch (error) {
    console.error("Could not cancel extension Generation queue.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not cancel the Generation queue." },
      { status: 500 },
    );
  }
}
