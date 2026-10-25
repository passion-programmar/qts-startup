import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { removeGetJdJobAccount } from "@/server/jobs/get-jd-jobs";

type RouteContext = { params: Promise<{ rowId: string }> };

// Removes one of the Manager's accounts from a job (unchecked in the Get JD panel).
// Refused for applied accounts, bids, and running Generation.
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return jsonResponse({ success: false, message: "Your QTS session has ended. Sign in again." }, 401);
  }

  try {
    const { rowId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rowId)) {
      return jsonResponse({ success: false, message: "Invalid job row." }, 400);
    }
    const removed = await removeGetJdJobAccount(manager.id, rowId);
    if (!removed) {
      return jsonResponse({
        success: false,
        locked: true,
        message: "Kept: this candidate applied, Generation is running, or it was already removed.",
      }, 409);
    }
    return jsonResponse({ success: true, rowId });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code.slice(0, 80)
      : error instanceof Error ? error.name.slice(0, 80) : "unknown";
    console.error(`Could not remove a Get JD job account (code: ${code}).`);
    return jsonResponse({ success: false, message: "Could not remove this candidate from the job." }, 500);
  }
}

function jsonResponse(body: object, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
