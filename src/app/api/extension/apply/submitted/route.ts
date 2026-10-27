import { NextResponse } from "next/server";
import { markApplicationSubmitted } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers } from "@/server/apply/apply-values";
import { parseLearnedAnswers } from "@/server/apply/question-memory-values";

// The site's Submit was clicked: the job is never offered again, and it waits for the Manager's
// Yes/No with the answers the form held at that moment.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; appliedAnswers?: unknown; learned?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    const marked = await markApplicationSubmitted(
      body.attemptId,
      auth.manager.id,
      auth.browser.id,
      parseAppliedAnswers(body.appliedAnswers),
      parseLearnedAnswers(body.learned),
    );
    return marked
      ? NextResponse.json({ success: true })
      : NextResponse.json({ success: false, message: "This application is no longer held by this Chrome." }, { status: 409 });
  } catch (error) {
    console.error("Could not record the Submit click.", error);
    return NextResponse.json({ success: false, message: "QTS could not record the Submit." }, { status: 500 });
  }
}
