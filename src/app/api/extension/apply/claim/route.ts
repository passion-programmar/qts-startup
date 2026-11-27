import { NextResponse } from "next/server";
import { claimNextApplication, releaseUnheldAttempts } from "@/server/apply/apply-attempts";
import { loadApplyDocumentPaths } from "@/server/apply/apply-documents";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { scheduleDailyCleanup } from "@/server/database/database-usage";
import { readWorkSelection } from "@/server/work/work-selection";

const AUTO_APPLY_OFF_MESSAGE = "Auto Apply is not turned on for you. Ask your Super Admin to turn on Auto Apply with APIs.";

// The next application for this Chrome: the oldest eligible job, at most 2 open per Chrome.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  scheduleDailyCleanup();
  try {
    const body = await request.json().catch(() => null) as { skipJobIds?: unknown; selection?: unknown; mode?: unknown; keepAttemptIds?: unknown } | null;
    const mode = body?.mode === undefined ? "apply" : body.mode;
    if (mode !== "apply" && mode !== "auto_apply") {
      return NextResponse.json({ success: false, message: "Choose Apply or Auto Apply." }, { status: 400 });
    }
    // Auto Apply answers only with Gemini and Groq, so only a Manager whose Super Admin turned on
    // "Auto Apply with APIs" may use it. (Read with the session check: no second read.)
    if (mode === "auto_apply" && auth.applySettings.autoApplyApi !== true) {
      return NextResponse.json({ success: false, message: AUTO_APPLY_OFF_MESSAGE }, { status: 403 });
    }
    let selection;
    try { selection = readWorkSelection(body?.selection); }
    catch (error) { return NextResponse.json({ success: false, message: (error as Error).message }, { status: 400 }); }
    // Apply and Auto Apply both take the panel's candidate and checked jobs; none means every account.
    const skipJobIds = Array.isArray(body?.skipJobIds) ? body.skipJobIds.filter(isUuid).slice(0, 200) : [];
    // Auto Apply sends the applications it works on now: this Chrome's other holds are let go first, so
    // its jobs-at-once slots are only the ones really open (2026-11-25).
    if (mode === "auto_apply" && Array.isArray(body?.keepAttemptIds)) {
      await releaseUnheldAttempts(auth.manager.id, auth.browser.id, body.keepAttemptIds.filter(isUuid).slice(0, 20));
    }
    const application = await claimNextApplication(auth.manager.id, auth.browser, skipJobIds, selection, {
      autoApply: mode === "auto_apply",
      parallelLimit: auth.applySettings.applyParallelLimit,
    });
    // The claimed job's saved PDF paths come with it, so the extension needs no separate documents
    // call (2026-11-27). Missing paths (an old job to relink) are left out: the documents route then
    // explains what to do, as before.
    const documents = application
      ? await loadApplyDocumentPaths(application.attemptId, auth.manager.id, auth.browser.id).catch(() => null)
      : null;
    return NextResponse.json(
      { success: true, application: application && documents ? { ...application, documentPaths: documents } : application },
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
