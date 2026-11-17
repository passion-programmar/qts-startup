import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { bids, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";
import { pdfTemplateLabels, type PdfTemplate } from "@/server/pdf/pdf-templates";

export type ResumePageBidInput = {
  candidateEmail: string;
  candidateName: string;
  jobTitle: string;
  company: string;
  template: PdfTemplate;
  // The folder the PDFs were saved in, under the picked download folder; empty when the browser saved them.
  resumeFolder: string;
};

export type ResumePageBidResult =
  | { status: "added"; candidateName: string }
  | { status: "exists"; candidateName: string }
  | { status: "no-candidate" };

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A Download on the Resume page records an applied bid without a job URL. The candidate is the
 * Manager's active account whose email matches the résumé's (else whose full name matches, when only
 * one does). The same candidate, title and company is recorded only once.
 */
export async function recordResumePageBid(managerId: string, input: ResumePageBidInput): Promise<ResumePageBidResult> {
  const candidates = await db
    .select({ id: profiles.userId, email: profiles.candidateEmail, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(users.parentUserId, managerId), eq(users.role, "account"), isNull(users.blockedAt), isNull(users.deletedAt)));
  const nameOf = (row: (typeof candidates)[number]) => [row.firstName, row.lastName].filter(Boolean).join(" ");
  const email = normalize(input.candidateEmail);
  const byEmail = email ? candidates.filter((row) => row.email && normalize(row.email) === email) : [];
  const byName = candidates.filter((row) => normalize(nameOf(row)) === normalize(input.candidateName));
  const candidate = byEmail.length === 1 ? byEmail[0] : byEmail.length === 0 && byName.length === 1 ? byName[0] : null;
  if (!candidate) return { status: "no-candidate" };
  const candidateName = nameOf(candidate) || input.candidateName;

  const titleCompanyKey = computeTitleCompanyKey(input.jobTitle, input.company) || null;
  const [existing] = await db
    .select({ id: bids.id })
    .from(bids)
    .where(and(
      eq(bids.managerId, managerId),
      eq(bids.candidateId, candidate.id),
      titleCompanyKey
        ? eq(bids.titleCompanyKey, titleCompanyKey)
        : sql`lower(btrim(${bids.jobTitle})) = ${normalize(input.jobTitle)} and lower(btrim(${bids.company})) = ${normalize(input.company)}`,
    ))
    .limit(1);
  if (existing) return { status: "exists", candidateName };

  const inserted = await db
    .insert(bids)
    .values({
      managerId,
      candidateId: candidate.id,
      jobUrl: "",
      jobTitle: input.jobTitle,
      company: input.company,
      titleCompanyKey,
      resumeFolder: input.resumeFolder,
      templateName: pdfTemplateLabels[input.template],
      promptName: "Resume page",
    })
    // Before migration 0098 a candidate can hold only one bid without a URL.
    .onConflictDoNothing()
    .returning({ id: bids.id });
  return inserted.length ? { status: "added", candidateName } : { status: "exists", candidateName };
}
