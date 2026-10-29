import { NextResponse } from "next/server";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { getExtensionManager } from "@/lib/extension-auth";
import { getCurrentUser } from "@/lib/session";
import { ApplyDocumentsUnavailableError, loadApplyDocumentSource } from "@/server/apply/apply-documents";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import {
  generationDownloadFiles,
  generationIdPattern,
  loadGenerationDocuments,
} from "@/server/generation/generation-documents";
import { renderDocumentPdfs } from "@/server/pdf/document-pdfs";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";

// Chromium's first launch on a cold instance takes a few seconds.
export const maxDuration = 60;

const maxBodyCharacters = 1_000_000;

// The only route that prints on the server, so only this function bundles Chromium (next.config.ts).
// GET is the extension's server printing: /api/extension/generation/artifacts and
// /api/extension/apply/documents redirect here when a Chrome asks the server to print (older
// extensions, or after printing in the Chrome failed). It answers exactly as those routes did. It
// accepts only the extension's sign-in (Authorization header), never the site's cookie.
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const kind = params.get("for");
  if (kind === "generation") return printGenerationDownloads(request, params.get("generationId") ?? "");
  if (kind === "apply") return printApplyDocuments(request, params.get("attemptId"));
  return NextResponse.json({ success: false, message: "Unknown print request." }, { status: 400 });
}

// What /api/extension/generation/artifacts answered without ?print=chrome: the three files, printed here.
async function printGenerationDownloads(request: Request, generationId: string): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json({ success: false, message: "Your QTS session has ended. Sign in again." }, { status: 401 });
  }
  if (!generationIdPattern.test(generationId)) {
    return NextResponse.json({ success: false, message: "A valid Generation ID is required." }, { status: 400 });
  }
  try {
    const documents = await loadGenerationDocuments(manager.id, manager.displayName, generationId);
    if (!documents) {
      return NextResponse.json({ success: false, message: "The completed document package was not found." }, { status: 404 });
    }
    // No page limit: a longer résumé or cover letter is delivered as it is.
    const pdfs = await renderDocumentPdfs(documents.data, documents.template, { enforcePageLimits: false });
    return NextResponse.json(
      { success: true, files: generationDownloadFiles(documents, pdfs) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not generate local Generation download files.", error);
    return NextResponse.json({ success: false, message: "QTS could not prepare the three download files." }, { status: 500 });
  }
}

// What /api/extension/apply/documents answered without ?print=chrome: the two PDFs to upload, printed here.
async function printApplyDocuments(request: Request, attemptId: string | null): Promise<NextResponse> {
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
    const pdfs = await renderDocumentPdfs(source.data, source.template, { enforcePageLimits: false });
    // Chromium printing only: when it failed, Apply waits and tries again rather than uploading the
    // plainer fallback design.
    if (pdfs.renderer === "fallback") throw new ApplyDocumentsUnavailableError();
    const documents = {
      folder: source.folder,
      resume: { filename: source.resumeFilename, base64: Buffer.from(pdfs.resume).toString("base64") },
      coverLetter: { filename: source.coverLetterFilename, base64: Buffer.from(pdfs.coverLetter).toString("base64") },
    };
    return NextResponse.json({ success: true, documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApplyDocumentsUnavailableError) {
      return NextResponse.json({ success: false, retry: true, message: error.message }, { status: 503 });
    }
    console.error("Could not print the application documents.", error);
    return NextResponse.json({ success: false, message: "QTS could not print the application documents." }, { status: 500 });
  }
}

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
