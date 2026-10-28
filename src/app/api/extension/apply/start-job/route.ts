import { NextResponse } from "next/server";
import { claimJobForBrowser } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// "Apply this page" for one chosen account: that job, taken for this Chrome and held for the
// Manager. 409 when it can no longer be taken (another Chrome has it, or it has a bid).
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  if (!isUuid(body?.jobId)) {
    return NextResponse.json({ success: false, message: "A valid job ID is required." }, { status: 400 });
  }
  try {
    const application = await claimJobForBrowser(auth.manager.id, auth.browser.id, body.jobId);
    return application
      ? NextResponse.json({ success: true, application }, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ success: false, message: "This job can no longer be started: another Chrome has it open, it has a bid, or it is not generated." }, { status: 409 });
  } catch (error) {
    console.error("Could not start the chosen job.", error);
    return NextResponse.json({ success: false, message: "QTS could not start this job." }, { status: 500 });
  }
}
