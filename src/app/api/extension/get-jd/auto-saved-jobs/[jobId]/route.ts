import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { jobs } from "@/db/schema";
import { getExtensionManager } from "@/lib/extension-auth";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  }

  try {
    const { jobId } = await context.params;
    if (!isUuid(jobId)) {
      return jsonResponse({ success: false, message: "Invalid auto-saved job ID." }, 400);
    }
    const [deleted] = await db
      .delete(jobs)
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.managerId, manager.id),
        eq(jobs.autoSavedByGetJd, true),
        eq(jobs.status, "todo"),
        eq(jobs.generationStatus, "not_queued"),
      ))
      .returning({ id: jobs.id });
    if (!deleted) {
      return jsonResponse({
        success: false,
        message: "This auto-saved job is no longer removable. It may have been changed or Generation may have started.",
      }, 409);
    }
    return jsonResponse({ success: true, jobId: deleted.id });
  } catch (error) {
    const code = getErrorCode(error);
    console.error(`Could not remove auto-saved Get JD job (code: ${code}).`);
    return jsonResponse({ success: false, message: "Could not remove the automatically saved job." }, 500);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown";
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
