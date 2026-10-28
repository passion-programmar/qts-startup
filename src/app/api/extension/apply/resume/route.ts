import { NextResponse } from "next/server";
import { resumeApplication } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// A job page this Chrome still has open after its extension restarted (reloaded, updated, woken
// up): its application again, held for the Manager; null when the job can no longer be taken back.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; jobId?: unknown } | null;
  if (!isUuid(body?.attemptId) || !isUuid(body?.jobId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID and job ID are required." }, { status: 400 });
  }
  try {
    const application = await resumeApplication(auth.manager.id, auth.browser.id, body.attemptId, body.jobId);
    return NextResponse.json({ success: true, application }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not resume the application.", error);
    return NextResponse.json({ success: false, message: "QTS could not resume the application." }, { status: 500 });
  }
}
