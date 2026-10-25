import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import { generationRuns, jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { generationDownloadPaths } from "@/server/generation/generation-artifacts";
import { isPdfTemplate, type PdfTemplate } from "@/server/pdf/pdf-templates";
import { renderTemplatePdfPackage } from "@/server/pdf/template-pdf";

// Chromium's first launch on a cold instance takes a few seconds.
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }
  const generationId = new URL(request.url).searchParams.get("generationId") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generationId)) {
    return NextResponse.json(
      { success: false, message: "A valid Generation ID is required." },
      { status: 400 },
    );
  }

  try {
    const [row] = await db
      .select({
        responseJson: generationRuns.responseJson,
        jobDescription: generationRuns.jobDescription,
        jobTitle: jobs.jobTitle,
        company: jobs.company,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        pdfTemplate: profiles.pdfTemplate,
        createdAt: generationRuns.createdAt,
      })
      .from(generationRuns)
      .innerJoin(jobs, eq(jobs.id, generationRuns.jobId))
      .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
      .where(and(
        eq(generationRuns.id, generationId),
        eq(generationRuns.managerId, manager.id),
        eq(generationRuns.status, "completed"),
        eq(jobs.managerId, manager.id),
      ))
      .limit(1);
    if (!row?.responseJson) {
      return NextResponse.json(
        { success: false, message: "The completed document package was not found." },
        { status: 404 },
      );
    }

    const data = parsePdfPackage(JSON.stringify(row.responseJson));
    const template = isPdfTemplate(row.pdfTemplate) ? row.pdfTemplate : "qts-standard";
    const pdfs = await renderGenerationPdfs(data, template);
    const candidateName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate";
    const paths = generationDownloadPaths({
      managerName: manager.displayName,
      candidateName,
      jobTitle: row.jobTitle,
      company: row.company,
      createdAt: row.createdAt,
    });
    return NextResponse.json({
      success: true,
      files: [
        {
          filename: paths.resume.split("/").at(-1),
          downloadPath: paths.resume,
          mimeType: "application/pdf",
          base64: Buffer.from(pdfs.resume).toString("base64"),
        },
        {
          filename: paths.coverLetter.split("/").at(-1),
          downloadPath: paths.coverLetter,
          mimeType: "application/pdf",
          base64: Buffer.from(pdfs.coverLetter).toString("base64"),
        },
        {
          filename: "JD.txt",
          downloadPath: paths.jobDescription,
          mimeType: "text/plain;charset=utf-8",
          base64: Buffer.from(row.jobDescription, "utf8").toString("base64"),
        },
      ],
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

// The HTML templates match the Resume page preview; if Chromium cannot print them, the
// built-in renderer still produces both PDFs so the Generation queue keeps moving.
async function renderGenerationPdfs(
  data: ReturnType<typeof parsePdfPackage>,
  template: PdfTemplate,
): Promise<{ resume: Uint8Array; coverLetter: Uint8Array }> {
  try {
    return await renderTemplatePdfPackage(data, template);
  } catch (error) {
    console.error(
      "Template PDF printing failed; using the built-in PDF renderer.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return renderPdfPackage(data, template);
  }
}
