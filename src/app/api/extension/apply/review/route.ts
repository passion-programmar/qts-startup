import { NextResponse } from "next/server";
import { setApplyReviewState } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers } from "@/server/apply/apply-values";

// A step is filled and waits for the Manager (review: true), or the Manager clicked Continue and
// Apply fills the next step (review: false). The answers so far come with it.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; review?: unknown; appliedAnswers?: unknown } | null;
  if (!isUuid(body?.attemptId) || typeof body.review !== "boolean") {
    return NextResponse.json({ success: false, message: "A valid attempt ID and review state are required." }, { status: 400 });
  }
  try {
    const saved = await setApplyReviewState(
      body.attemptId,
      auth.manager.id,
      auth.browser.id,
      body.review,
      parseAppliedAnswers(body.appliedAnswers),
    );
    return saved
      ? NextResponse.json({ success: true })
      : NextResponse.json({ success: false, message: "This application is no longer held by this Chrome." }, { status: 409 });
  } catch (error) {
    console.error("Could not save the application's review state.", error);
    return NextResponse.json({ success: false, message: "QTS could not save the review state." }, { status: 500 });
  }
}
