import { NextResponse } from "next/server";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { getCurrentUser } from "@/lib/session";
import { renderDocumentPdfs } from "@/server/pdf/document-pdfs";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";

// Chromium's first launch on a cold instance takes a few seconds.
export const maxDuration = 60;

const maxBodyCharacters = 1_000_000;

// The Resume page's download button: prints the résumé and cover letter with the same server-side
// Chromium printing as Generation, from the template the page's preview draws in the browser.
export async function POST(request: Request): Promise<NextResponse> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ success: false, message: "Your QTS session has ended. Sign in again." }, { status: 401 });
  }
  if (currentUser.role !== "manager") {
    return NextResponse.json({ success: false, message: "Only Managers can download resume PDFs." }, { status: 403 });
  }
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ success: false, message: "Invalid request origin." }, { status: 403 });
  }

  const text = await request.text();
  if (text.length > maxBodyCharacters) {
    return NextResponse.json({ success: false, message: "The document JSON is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ success: false, message: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.template !== "string" || !isPdfTemplate(body.template)) {
    return NextResponse.json({ success: false, message: "Choose a valid resume template." }, { status: 400 });
  }

  let data: ReturnType<typeof parsePdfPackage>;
  try {
    data = parsePdfPackage(JSON.stringify(body.document));
  } catch (error) {
    // The parser's messages describe what to fix in the JSON, as the Resume page already shows them.
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "The document JSON is invalid." },
      { status: 400 },
    );
  }

  try {
    // Manual downloads have never been limited to two pages; the preview warns about long content.
    const pdfs = await renderDocumentPdfs(data, body.template, { enforcePageLimits: false });
    return NextResponse.json(
      {
        success: true,
        resume: Buffer.from(pdfs.resume).toString("base64"),
        coverLetter: Buffer.from(pdfs.coverLetter).toString("base64"),
        renderer: pdfs.renderer,
        warnings: pdfs.warnings,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not print Resume page PDFs.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, message: "QTS could not prepare the resume and cover letter PDFs. Try again." },
      { status: 500 },
    );
  }
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
