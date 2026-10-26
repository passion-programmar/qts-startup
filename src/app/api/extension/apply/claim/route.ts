import { NextResponse } from "next/server";
import { claimNextApplication } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest } from "@/server/apply/apply-route-auth";

// The next application for this Chrome: the oldest Generation-completed job without a bid,
// at most 3 in progress per Manager and one per candidate, across every Chrome.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const application = await claimNextApplication(auth.manager.id, auth.browser);
    return NextResponse.json(
      { success: true, application },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not claim the next application.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not choose the next application." },
      { status: 500 },
    );
  }
}
