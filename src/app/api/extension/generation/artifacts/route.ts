import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import {
  generationDownloadFiles,
  generationIdPattern,
  loadGenerationDocuments,
} from "@/server/generation/generation-documents";
import { chromePrintJob, wantsChromePrint } from "@/server/pdf/chrome-print";

// The three download files. With ?print=chrome the two PDFs come as a print job, printed in the
// extension's Chrome. Without it (older extensions, or when that failed) the request is sent on to
// /api/pdf/print, the one function that bundles Chromium; the extension follows the redirect with its
// sign-in, and that route checks it again.
export async function GET(request: Request): Promise<NextResponse> {
  const generationId = new URL(request.url).searchParams.get("generationId") ?? "";
  if (!wantsChromePrint(request)) {
    if (!generationIdPattern.test(generationId)) {
      return NextResponse.json({ success: false, message: "A valid Generation ID is required." }, { status: 400 });
    }
    // A relative Location: the client resolves it against the address it called, so the redirect stays
    // on the same origin and keeps the Authorization header (an absolute URL built from the server's
    // own idea of its host can differ, and the header would be dropped).
    return new NextResponse(null, {
      status: 307,
      headers: { Location: `/api/pdf/print?for=generation&generationId=${generationId}`, "Cache-Control": "no-store" },
    });
  }

  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }
  if (!generationIdPattern.test(generationId)) {
    return NextResponse.json(
      { success: false, message: "A valid Generation ID is required." },
      { status: 400 },
    );
  }

  try {
    const documents = await loadGenerationDocuments(manager.id, manager.displayName, generationId);
    if (!documents) {
      return NextResponse.json(
        { success: false, message: "The completed document package was not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      print: chromePrintJob(documents.data, documents.template),
      files: generationDownloadFiles(documents, null),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not generate local Generation download files.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not prepare the three download files." },
      { status: 500 },
    );
  }
}
