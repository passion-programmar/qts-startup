import { NextResponse } from "next/server";
import { applySubmitSettings, renewApplyAttempt } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// Renews this Chrome's claim every 30 seconds. 409 means the attempt is no longer its own: stop it.
// The Manager's current review mode and automatic Submit come back with it, for the next step.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    const renewed = await renewApplyAttempt(body.attemptId, auth.manager.id, auth.browser.id);
    return renewed
      ? NextResponse.json({ success: true, ...(await applySubmitSettings(auth.manager.id)) })
      : NextResponse.json(
        { success: false, message: "This application is no longer held by this Chrome." },
        { status: 409 },
      );
  } catch (error) {
    console.error("Could not renew the application claim.", error);
    return NextResponse.json({ success: false, message: "QTS could not renew the application." }, { status: 500 });
  }
}
