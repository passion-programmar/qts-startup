import { NextResponse } from "next/server";
import { ApplyDocumentsUnavailableError, buildApplyDocuments } from "@/server/apply/apply-documents";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";

// Chromium's first launch on a cold instance takes a few seconds.
export const maxDuration = 60;

// The résumé and cover-letter PDFs to upload for a claimed application, printed from the job's
// delivered Generation run, with the job's folder name for a screenshot.
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  if (!isUuid(attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  try {
    const documents = await buildApplyDocuments(attemptId, auth.manager.id, auth.manager.displayName, auth.browser.id);
    if (!documents) {
      return NextResponse.json(
        { success: false, message: "The job's delivered résumé was not found, or this Chrome no longer holds the application." },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApplyDocumentsUnavailableError) {
      return NextResponse.json({ success: false, retry: true, message: error.message }, { status: 503 });
    }
    console.error("Could not print the application documents.", error);
    return NextResponse.json({ success: false, message: "QTS could not print the application documents." }, { status: 500 });
  }
}
