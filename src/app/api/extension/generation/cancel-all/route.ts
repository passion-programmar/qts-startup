import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }

  try {
    const cancelled = await db
      .update(jobs)
      .set({
        generationStatus: "cancelled",
        generationAttemptCount: sql`greatest(${jobs.generationAttemptCount} - 1, 0)`,
        generationError: null,
        generationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobs.managerId, manager.id),
        eq(jobs.generationStatus, "processing"),
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
