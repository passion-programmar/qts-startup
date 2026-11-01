import { NextResponse } from "next/server";
import { claimNextApplication } from "@/server/apply/apply-attempts";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { scheduleDailyCleanup } from "@/server/database/database-usage";
import { getGetJdMatchingMode } from "@/server/jobs/get-jd-mode";
import { readWorkSelection } from "@/server/work/work-selection";

// The next application for this Chrome: the oldest eligible job, at most 2 open per Chrome.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  scheduleDailyCleanup();
  try {
    const body = await request.json().catch(() => null) as { skipJobIds?: unknown; selection?: unknown; mode?: unknown } | null;
    const mode = body?.mode === undefined ? "apply" : body.mode;
    if (mode !== "apply" && mode !== "auto_apply") {
      return NextResponse.json({ success: false, message: "Choose Apply or Auto Apply." }, { status: 400 });
    }
    let selection;
    try { selection = readWorkSelection(body?.selection); }
    catch (error) { return NextResponse.json({ success: false, message: (error as Error).message }, { status: 400 }); }
    if (selection && mode !== "auto_apply") {
      return NextResponse.json({ success: false, message: "This job selection is only valid for Auto Apply." }, { status: 400 });
    }
    const skipJobIds = Array.isArray(body?.skipJobIds) ? body.skipJobIds.filter(isUuid).slice(0, 200) : [];
    const requireMatchingNote = mode === "auto_apply" && await getGetJdMatchingMode(auth.manager.id) === "gemini";
    const application = await claimNextApplication(auth.manager.id, auth.browser, skipJobIds, selection, {
      autoApply: mode === "auto_apply",
      requireMatchingNote,
    });
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
