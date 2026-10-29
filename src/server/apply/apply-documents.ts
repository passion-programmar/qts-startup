import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { type PdfPackage, parsePdfPackage } from "@/app/pdf/document-data";
import { applyAttempts, generationRuns, jobs, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { generationDownloadPaths } from "@/server/generation/generation-artifacts";
import { type ChromePrintJob, chromePrintJob } from "@/server/pdf/chrome-print";
import { isPdfTemplate, type PdfTemplate } from "@/server/pdf/pdf-templates";
import { APPLY_DOCUMENT_STATUSES } from "./apply-values";

/** The template printer failed; the documents can be asked for again shortly. */
export class ApplyDocumentsUnavailableError extends Error {
  constructor() {
    super("QTS could not print the résumé right now. Apply tries again shortly.");
  }
}

export type ApplyDocuments = {
  // The job's Generation folder, so a screenshot PDF lands next to the files on any computer.
  folder: string;
  // No base64 when the Chrome prints them itself from `print`.
  resume: { filename: string; base64?: string };
  coverLetter: { filename: string; base64?: string };
  print?: ChromePrintJob;
};

/** What an application's résumé and cover letter are printed from, with their file names. */
export type ApplyDocumentSource = {
  data: PdfPackage;
  template: PdfTemplate;
  folder: string;
  resumeFilename: string;
  coverLetterFilename: string;
};

/**
 * The résumé and cover letter source for a claimed application, from the job's latest delivered
 * Generation run, so Apply works on a computer that never ran that Generation. Null when the attempt
 * is not this Chrome's live claim or the job has no delivered run. No printing here: the routes that
 * only hand out print jobs must not pull Chromium into their functions.
 */
export async function loadApplyDocumentSource(
  attemptId: string,
  managerId: string,
  managerName: string,
  browserId: string,
): Promise<ApplyDocumentSource | null> {
  const [row] = await db
    .select({
      responseJson: generationRuns.responseJson,
      jobTitle: generationRuns.jobTitle,
      company: generationRuns.company,
      runTemplate: generationRuns.pdfTemplate,
      createdAt: generationRuns.createdAt,
      profileTemplate: profiles.pdfTemplate,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
    .innerJoin(generationRuns, and(eq(generationRuns.jobId, jobs.id), eq(generationRuns.status, "delivered")))
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .where(and(
      eq(applyAttempts.id, attemptId),
      eq(applyAttempts.managerId, managerId),
      eq(applyAttempts.browserId, browserId),
      inArray(applyAttempts.status, [...APPLY_DOCUMENT_STATUSES]),
    ))
    .orderBy(desc(generationRuns.createdAt))
    .limit(1);
  if (!row?.responseJson) return null;

  const data = parsePdfPackage(JSON.stringify(row.responseJson));
  const savedTemplate = row.runTemplate ?? row.profileTemplate;
  const template = isPdfTemplate(savedTemplate) ? savedTemplate : "qts-standard";
  const paths = generationDownloadPaths({
    managerName,
    candidateName: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
    jobTitle: row.jobTitle,
    company: row.company,
    createdAt: row.createdAt,
  });
  const name = (path: string) => path.split("/").at(-1) ?? "document.pdf";
  return {
    data,
    template,
    folder: paths.resume.slice(0, paths.resume.lastIndexOf("/")),
    resumeFilename: name(paths.resume),
    coverLetterFilename: name(paths.coverLetter),
  };
}

/** The documents as a print job for the Chrome to print itself (?print=chrome). */
export function applyDocumentsPrintJob(source: ApplyDocumentSource): ApplyDocuments {
  return {
    folder: source.folder,
    resume: { filename: source.resumeFilename },
    coverLetter: { filename: source.coverLetterFilename },
    print: chromePrintJob(source.data, source.template),
  };
}
