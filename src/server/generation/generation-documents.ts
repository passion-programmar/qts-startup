import "server-only";

import { and, eq } from "drizzle-orm";
import { type PdfPackage, parsePdfPackage } from "@/app/pdf/document-data";
import { generationRuns, jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { generationDownloadPaths } from "@/server/generation/generation-artifacts";
import { isPdfTemplate, type PdfTemplate } from "@/server/pdf/pdf-templates";

export type GenerationDocuments = {
  data: PdfPackage;
  template: PdfTemplate;
  paths: ReturnType<typeof generationDownloadPaths>;
  jobDescription: string;
};

/**
 * The completed Generation run's documents for this Manager, or null when there is none. No printing
 * here: the routes that only hand out print jobs must not pull Chromium into their functions.
 */
export async function loadGenerationDocuments(
  managerId: string,
  managerName: string,
  generationId: string,
): Promise<GenerationDocuments | null> {
  const [row] = await db
    .select({
      responseJson: generationRuns.responseJson,
      jobDescription: generationRuns.jobDescription,
      jobTitle: generationRuns.jobTitle,
      company: generationRuns.company,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      runTemplate: generationRuns.pdfTemplate,
      profileTemplate: profiles.pdfTemplate,
      createdAt: generationRuns.createdAt,
    })
    .from(generationRuns)
    .innerJoin(jobs, eq(jobs.id, generationRuns.jobId))
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .where(and(
      eq(generationRuns.id, generationId),
      eq(generationRuns.managerId, managerId),
      eq(generationRuns.status, "completed"),
      eq(jobs.managerId, managerId),
    ))
    .limit(1);
  if (!row?.responseJson) return null;

  const data = parsePdfPackage(JSON.stringify(row.responseJson));
  // Runs from before template rotation have no saved template and use the account's.
  const savedTemplate = row.runTemplate ?? row.profileTemplate;
  const template = isPdfTemplate(savedTemplate) ? savedTemplate : "qts-standard";
  const candidateName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate";
  const paths = generationDownloadPaths({
    managerName,
    candidateName,
    jobTitle: row.jobTitle,
    company: row.company,
    createdAt: row.createdAt,
  });
  return { data, template, paths, jobDescription: row.jobDescription };
}

export const generationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The three download files; the PDFs either printed (base64) or left for the Chrome to print. */
export function generationDownloadFiles(
  documents: GenerationDocuments,
  pdfs: { resume: Uint8Array; coverLetter: Uint8Array } | null,
) {
  const { paths } = documents;
  return [
    {
      filename: paths.resume.split("/").at(-1),
      downloadPath: paths.resume,
      mimeType: "application/pdf",
      ...(pdfs ? { base64: Buffer.from(pdfs.resume).toString("base64") } : { printDocument: "resume" }),
    },
    {
      filename: paths.coverLetter.split("/").at(-1),
      downloadPath: paths.coverLetter,
      mimeType: "application/pdf",
      ...(pdfs ? { base64: Buffer.from(pdfs.coverLetter).toString("base64") } : { printDocument: "cover-letter" }),
    },
    {
      filename: "JD.txt",
      downloadPath: paths.jobDescription,
      mimeType: "text/plain;charset=utf-8",
      base64: Buffer.from(documents.jobDescription, "utf8").toString("base64"),
    },
  ];
}
