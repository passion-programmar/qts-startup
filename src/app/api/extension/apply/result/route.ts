import { NextResponse } from "next/server";
import { recordApplyResult, saveCandidateAnswers } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers, parseApplyResultReport } from "@/server/apply/apply-values";

const MAX_ANSWERS = 100;

// The result of a submitted application: confirmed or not confirmed creates the bid (the job is
// Applied and never sent twice); failed leaves the job for the Manager. Only the Chrome that
// submitted may report it. Answers the application used are saved for the next form.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  const report = parseApplyResultReport(body);
  if (typeof report === "string") {
    return NextResponse.json({ success: false, message: report }, { status: 400 });
  }
  const answers = Array.isArray(body.answers)
    ? body.answers
      .slice(0, MAX_ANSWERS)
      .filter((entry): entry is { question: string; answer: string; source: "manager" | "ai" } =>
        Boolean(entry) && typeof entry.question === "string" && typeof entry.answer === "string"
        && (entry.source === "manager" || entry.source === "ai"))
    : [];

  try {
    const recorded = await recordApplyResult(
      body.attemptId,
      auth.manager.id,
      auth.browser.id,
      report,
      parseAppliedAnswers(body.appliedAnswers),
    );
    if (!recorded) {
      return NextResponse.json(
        { success: false, message: "This application is not waiting for a result from this Chrome." },
        { status: 409 },
      );
    }
    const savedAnswers = report.result === "failed"
      ? 0
      : await saveCandidateAnswers(auth.manager.id, body.attemptId, answers).catch((error) => {
        console.error("Could not save the application's answers.", error);
        return 0;
      });
    return NextResponse.json({ success: true, savedAnswers });
  } catch (error) {
    console.error("Could not record the application result.", error);
    return NextResponse.json({ success: false, message: "QTS could not record the result." }, { status: 500 });
  }
}
