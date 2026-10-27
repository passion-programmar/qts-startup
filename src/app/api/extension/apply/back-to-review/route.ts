import { NextResponse } from "next/server";
import { returnApplicationToReview } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// "Not submitted — back to review": the site did not send the application, so review goes on.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    const returned = await returnApplicationToReview(body.attemptId, auth.manager.id, auth.browser.id);
    return returned
      ? NextResponse.json({ success: true })
      : NextResponse.json({ success: false, message: "This application is not waiting for your answer." }, { status: 409 });
  } catch (error) {
    console.error("Could not return the application to review.", error);
    return NextResponse.json({ success: false, message: "QTS could not return it to review." }, { status: 500 });
  }
}
