import { NextResponse } from "next/server";
import { releaseApplyAttempt, type ReleaseMode } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers } from "@/server/apply/apply-values";

const MODES = new Set<ReleaseMode>(["error", "skip", "later", "test", "drop", "remove"]);

// Ends a claimed application before Submit: an error returns it to the list, Skip keeps it from
// being offered again, Later (and test mode) gives it back without counting as a return, and
// Remove deletes the job row.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; mode?: unknown; reason?: unknown; appliedAnswers?: unknown } | null;
  if (!isUuid(body?.attemptId) || !MODES.has(body.mode as ReleaseMode) || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ success: false, message: "An attempt ID, how it ends, and a reason are required." }, { status: 400 });
  }
  try {
    const released = await releaseApplyAttempt(
      body.attemptId,
      auth.manager.id,
      auth.browser.id,
      body.mode as ReleaseMode,
      body.reason,
      parseAppliedAnswers(body.appliedAnswers),
    );
    return released
      ? NextResponse.json({ success: true })
      : NextResponse.json(
        {
          success: false,
          message: body.mode === "remove"
            ? "QTS could not remove this job: it is no longer held by this Chrome, or Generation is still writing it."
            : "This application is no longer held by this Chrome, or it was submitted.",
        },
        { status: 409 },
      );
  } catch (error) {
    console.error("Could not release the application.", error);
    return NextResponse.json({ success: false, message: "QTS could not return the application." }, { status: 500 });
  }
}
