import { NextResponse } from "next/server";
import { applyDocumentsPrintJob, loadApplyDocumentSource } from "@/server/apply/apply-documents";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { wantsChromePrint } from "@/server/pdf/chrome-print";

// The résumé and cover-letter PDFs to upload for a claimed application, with the job's folder name for
// a screenshot. With ?print=chrome they come as a print job, printed in the extension's Chrome. Without
// it (older extensions, or when that failed) the request is sent on to /api/pdf/print, the one function
// that bundles Chromium; the extension follows the redirect with its sign-in and Chrome identity, and
// that route authorizes it again.
export async function GET(request: Request): Promise<NextResponse> {
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  if (!wantsChromePrint(request)) {
    if (!isUuid(attemptId)) {
      return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
    }
    // Relative, so the redirect stays on the address the extension called and keeps its sign-in
    // (see /api/extension/generation/artifacts).
    return new NextResponse(null, {
      status: 307,
      headers: { Location: `/api/pdf/print?for=apply&attemptId=${attemptId}`, "Cache-Control": "no-store" },
    });
  }

  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  if (!isUuid(attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    const source = await loadApplyDocumentSource(attemptId, auth.manager.id, auth.manager.displayName, auth.browser.id);
    if (!source) {
      return NextResponse.json(
        { success: false, message: "The job's delivered résumé was not found, or this Chrome no longer holds the application." },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, documents: applyDocumentsPrintJob(source) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not prepare the application documents.", error);
    return NextResponse.json({ success: false, message: "QTS could not print the application documents." }, { status: 500 });
  }
}
