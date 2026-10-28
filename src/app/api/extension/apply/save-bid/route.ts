import { NextResponse } from "next/server";
import { saveBidForJob } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseAppliedAnswers } from "@/server/apply/apply-values";

// Submitted on a job page whose application record is gone (its hold ran out while the Chrome was
// away): the bid is saved from the job, and the job row is deleted. 404 when the job is gone too.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { jobId?: unknown; appliedAnswers?: unknown } | null;
  if (!isUuid(body?.jobId)) {
    return NextResponse.json({ success: false, message: "A valid job ID is required." }, { status: 400 });
  }
  try {
    const saved = await saveBidForJob(auth.manager.id, body.jobId, parseAppliedAnswers(body.appliedAnswers));
    return saved
      ? NextResponse.json({ success: true })
      : NextResponse.json({ success: false, message: "This job is no longer in your Jobs list (it may be saved as a bid already)." }, { status: 404 });
  } catch (error) {
    console.error("Could not save the bid from the job.", error);
    return NextResponse.json({ success: false, message: "QTS could not save the bid. Try again." }, { status: 500 });
  }
}
