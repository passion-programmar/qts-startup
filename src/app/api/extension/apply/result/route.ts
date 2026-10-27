import { NextResponse } from "next/server";
import { answerApplication } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers } from "@/server/apply/apply-values";

// The Manager's answer to "Submitted successfully?" from the Chrome: Yes makes the bid and the job
// Applied; No makes the job Failed. Only the Chrome holding the application may answer here.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; submitted?: unknown; appliedAnswers?: unknown } | null;
  if (!isUuid(body?.attemptId) || typeof body.submitted !== "boolean") {
    return NextResponse.json({ success: false, message: "A valid attempt ID and Yes or No are required." }, { status: 400 });
  }
  try {
    const result = await answerApplication({
      attemptId: body.attemptId,
      managerId: auth.manager.id,
      browserId: auth.browser.id,
      submitted: body.submitted,
      answers: parseAppliedAnswers(body.appliedAnswers),
    });
    return result
      ? NextResponse.json({ success: true, result })
      : NextResponse.json(
        { success: false, message: "This application is not waiting for your answer (it may have been answered on the Jobs page)." },
        { status: 409 },
      );
  } catch (error) {
    console.error("Could not record the application's answer.", error);
    return NextResponse.json({ success: false, message: "QTS could not record your answer. Try again." }, { status: 500 });
  }
}
