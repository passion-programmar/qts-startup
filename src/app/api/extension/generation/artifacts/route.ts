import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import { generationRuns, jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { getExtensionManager } from "@/lib/extension-auth";
import { generatedResumeLocalPath } from "@/server/generation/generation-artifacts";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";

export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Extension session is invalid or expired." },
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
    const template = isPdfTemplate(row.pdfTemplate) ? row.pdfTemplate : "heritage";
    const pdfs = await renderPdfPackage(data, template);
    const resumeLocalPath = generatedResumeLocalPath(row.firstName, row.lastName);
    const resumeFilename = resumeLocalPath.split("/").at(-1) ?? "Candidate_Resume.pdf";
    const fileStem = resumeFilename.replace(/_Resume\.pdf$/, "");
    return NextResponse.json({
      success: true,
      files: [
        {
          filename: resumeFilename,
          mimeType: "application/pdf",
          base64: Buffer.from(pdfs.resume).toString("base64"),
        },
        {
          filename: `${fileStem}_Cover_Letter.pdf`,
          mimeType: "application/pdf",
          base64: Buffer.from(pdfs.coverLetter).toString("base64"),
        },
        {
          filename: `${fileStem}_Job_Description.txt`,
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
