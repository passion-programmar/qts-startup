import { NextResponse } from "next/server";
import { renewApplyAttempt, submitSettingsFrom } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// Renews this Chrome's claim every 30 seconds, less often while the Manager reviews (the answer says
// how long the hold lasts). 409 means the attempt is no longer its own: stop it. The Manager's
// current review mode and automatic Submit come back with it, for the next step.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; jobId?: unknown; stopVersion?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    // Auto Apply sends its job and the Stop all count it was taken with: a hold that ran out while
    // this Chrome was away is taken back when nothing else happened to the job meanwhile.
    const recover = isUuid(body.jobId) && Number.isInteger(body.stopVersion)
      ? { jobId: body.jobId, stopVersion: body.stopVersion as number }
      : null;
    const leaseSeconds = await renewApplyAttempt(body.attemptId, auth.manager.id, auth.browser.id, recover);
    return leaseSeconds !== null
      // (The Submit settings come from the session check's read of the Manager: no second read.)
      ? NextResponse.json({ success: true, leaseSeconds, ...submitSettingsFrom(auth.applySettings) })
      : NextResponse.json(
        { success: false, message: "This application is no longer held by this Chrome." },
        { status: 409 },
      );
  } catch (error) {
    console.error("Could not renew the application claim.", error);
    return NextResponse.json({ success: false, message: "QTS could not renew the application." }, { status: 500 });
  }
}
