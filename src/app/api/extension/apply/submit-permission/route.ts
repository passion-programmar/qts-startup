import { NextResponse } from "next/server";
import { grantSubmitPermission } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// Asked right before Submit. Granted once per job, only to the Chrome holding a live claim on a
// job without a bid; the extension must not click Submit without it.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    const granted = await grantSubmitPermission(body.attemptId, auth.manager.id, auth.browser.id);
    return granted
      ? NextResponse.json({ success: true, granted: true })
      : NextResponse.json(
        {
          success: false,
          granted: false,
          message: "Submit is not allowed: this Chrome no longer holds the application, or the job already has a bid.",
        },
        { status: 409 },
      );
  } catch (error) {
    console.error("Could not grant Submit permission.", error);
    return NextResponse.json({ success: false, granted: false, message: "QTS could not allow Submit." }, { status: 500 });
  }
}
