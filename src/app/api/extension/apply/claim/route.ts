import { NextResponse } from "next/server";
import { claimNextApplication } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { scheduleDailyCleanup } from "@/server/database/database-usage";

// The next application for this Chrome: the oldest Generation-completed job without a bid, at most 2
// open per Chrome. skipJobIds: jobs this Chrome cancelled since Apply was turned on (left in the list).
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  scheduleDailyCleanup();
  try {
    const body = await request.json().catch(() => null) as { skipJobIds?: unknown } | null;
    const skipJobIds = Array.isArray(body?.skipJobIds) ? body.skipJobIds.filter(isUuid).slice(0, 200) : [];
    const application = await claimNextApplication(auth.manager.id, auth.browser, skipJobIds);
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
