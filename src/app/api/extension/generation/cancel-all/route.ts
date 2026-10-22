import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";

export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
      { status: 401 },
    );
  }

  try {
    const cancelled = await db
      .update(jobs)
      .set({
        generationStatus: "not_queued",
        generationError: null,
        generationLeaseExpiresAt: null,
        resumeLocalPath: sql`case when ${jobs.generationStatus} = 'processing' then null else ${jobs.resumeLocalPath} end`,
        status: sql`case when ${jobs.generationStatus} = 'processing' then 'todo' else ${jobs.status} end`,
        failureReason: sql`case when ${jobs.generationStatus} = 'processing' then null else ${jobs.failureReason} end`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(jobs.managerId, manager.id),
        inArray(jobs.generationStatus, ["queued", "processing"]),
      ))
      .returning({ id: jobs.id });

    return NextResponse.json({ success: true, cancelledCount: cancelled.length });
  } catch (error) {
    console.error("Could not cancel extension Generation queue.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not cancel the Generation queue." },
      { status: 500 },
    );
  }
}
