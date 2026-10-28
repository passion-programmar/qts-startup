import { NextResponse } from "next/server";
import { findPageApplications } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest } from "@/server/apply/apply-route-auth";
import { isHttpUrl } from "@/server/jobs/job-values";

// The Manager's saved jobs for the page the launcher is on, one per account, with which can be
// applied to now (for "Apply this page").
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { url?: unknown } | null;
  if (typeof body?.url !== "string" || body.url.length > 2048 || !isHttpUrl(body.url)) {
    return NextResponse.json({ success: false, message: "A valid page address is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      { success: true, applications: await findPageApplications(auth.manager.id, body.url) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not find the page's applications.", error);
    return NextResponse.json({ success: false, message: "QTS could not look up this page." }, { status: 500 });
  }
}
