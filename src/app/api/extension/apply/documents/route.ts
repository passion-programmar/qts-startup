import { NextResponse } from "next/server";
import { loadApplyDocumentPaths } from "@/server/apply/apply-documents";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { loadPdfRecoveryContext } from "@/server/apply/apply-pdf-recovery-store";

// Apply only receives the exact local PDF paths saved by Generation. This route never renders PDFs.
export async function GET(request: Request): Promise<NextResponse> {
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) { auth.headers.set("Cache-Control", "no-store"); return auth; }
  if (!isUuid(attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const wantsRecovery = new URL(request.url).searchParams.get("recovery") === "1";
    if (wantsRecovery) {
      const recovery = await loadPdfRecoveryContext({ managerId: auth.manager.id, browserId: auth.browser.id, authVersion: auth.manager.authVersion }, attemptId);
      return NextResponse.json(recovery ? { success: true, recovery } : {
        success: false, message: "This application is not available for PDF relinking. Check that this Chrome still owns a live review and that original paths are missing.",
      }, { status: recovery ? 200 : 404, headers: { "Cache-Control": "no-store" } });
    }
    const documents = await loadApplyDocumentPaths(attemptId, auth.manager.id, auth.browser.id);
    if (!documents) {
      const recovery = await loadPdfRecoveryContext({ managerId: auth.manager.id, browserId: auth.browser.id, authVersion: auth.manager.authVersion }, attemptId);
      return NextResponse.json(
        { success: false, ...(recovery ? { code: "PDF_RELINK_REQUIRED" } : {}), message: recovery
          ? "The cover-letter PDF path is missing. Use Link existing PDFs in Assisted Apply to confirm both original files. For Auto Apply, stop it and open this job in Assisted Apply first. PDFs will not be regenerated."
          : "The exact Generation PDF paths are unavailable. Ask your QTS administrator to check the original paths and application access. PDFs will not be regenerated." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ success: true, documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not prepare the application documents.", error);
    return NextResponse.json({ success: false, message: "QTS could not retrieve the saved Generation PDF paths." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
