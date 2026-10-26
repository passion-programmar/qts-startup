import { NextResponse } from "next/server";
import { releaseApplyAttempt } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers } from "@/server/apply/apply-values";

// Gives a claimed job back before Submit: to the ready list, or skipped for good (skip=true)
// when the site is not supported yet or the Manager must handle it.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; reason?: unknown; skip?: unknown; dryRun?: unknown; appliedAnswers?: unknown } | null;
  if (!isUuid(body?.attemptId) || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ success: false, message: "An attempt ID and a reason are required." }, { status: 400 });
  }
  try {
    const released = await releaseApplyAttempt(
      body.attemptId,
      auth.manager.id,
      auth.browser.id,
      body.reason,
      body.skip === true,
      body.dryRun === true,
      parseAppliedAnswers(body.appliedAnswers),
    );
    return released
      ? NextResponse.json({ success: true })
      : NextResponse.json(
        { success: false, message: "This application is no longer held by this Chrome, or it was submitted." },
        { status: 409 },
      );
  } catch (error) {
    console.error("Could not release the application.", error);
    return NextResponse.json({ success: false, message: "QTS could not return the application." }, { status: 500 });
  }
}
