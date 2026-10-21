import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
      { status: 401 },
    );
  }
  const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
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
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
      ))
      .limit(1);
    if (!job) {
      return NextResponse.json(
        { success: false, message: "The queued job was not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      generationStatus: job.generationStatus,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not check queued Generation status.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not check Generation status." },
      { status: 500 },
    );
  }
}
