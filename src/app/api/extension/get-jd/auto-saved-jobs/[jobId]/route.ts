import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { removeGetJdJobAccount } from "@/server/jobs/get-jd-jobs";

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
    // Same guard as unchecking in the panel: applied accounts and running Generation are kept.
    const removed = await removeGetJdJobAccount(manager.id, jobId, { autoSavedOnly: true });
    if (!removed) {
      return jsonResponse({
        success: false,
        message: "This job can't be removed: the candidate applied, Generation is running, or it was already removed.",
      }, 409);
    }
    return jsonResponse({ success: true, jobId });
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
