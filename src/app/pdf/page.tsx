import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PdfWorkspace } from "@/app/pdf/pdf-workspace";
import { requireUser } from "@/lib/session";
import { generationRuns, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { normalizeJobUrl } from "@/server/jobs/job-values";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";

export const instant = false;

export default async function PdfPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  const jobRows = await db
    .select({
      id: jobs.id,
      jobUrl: jobs.jobUrl,
      jobTitle: jobs.jobTitle,
      company: jobs.company,
      location: jobs.location,
      description: jobs.description,
      candidateId: profiles.userId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      pdfTemplate: profiles.pdfTemplate,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        eq(jobs.managerId, currentUser.id),
        eq(users.parentUserId, currentUser.id),
        eq(users.role, "account"),
        isNull(users.blockedAt),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(250);
  const jobUrls = [...new Set(jobRows.map((job) => normalizeJobUrl(job.jobUrl)))];
  const generationRows = jobUrls.length
    ? await db
        .select({
          jobUrl: generationRuns.jobUrl,
          jobDescription: generationRuns.jobDescription,
          responseJson: generationRuns.responseJson,
        })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.managerId, currentUser.id),
            eq(generationRuns.status, "completed"),
            isNotNull(generationRuns.responseJson),
            inArray(generationRuns.jobUrl, jobUrls),
          ),
        )
        .orderBy(desc(generationRuns.createdAt))
        .limit(250)
    : [];
  const generationByUrl = new Map<
    string,
    (typeof generationRows)[number][]
  >();
  for (const run of generationRows) {
    const key = normalizeJobUrl(run.jobUrl);
    const matchingRuns = generationByUrl.get(key) ?? [];
    matchingRuns.push(run);
    generationByUrl.set(key, matchingRuns);
  }
  const savedJobs = jobRows.map((job) => {
    const matchingRuns = generationByUrl.get(normalizeJobUrl(job.jobUrl)) ?? [];
    const candidateName =
      [job.firstName, job.lastName].filter(Boolean).join(" ") || "Candidate";
    const generation = matchingRuns.find((run) =>
      generatedCandidateMatches(run.responseJson, candidateName),
    );
    return {
      id: job.id,
      candidateName,
      jobTitle: job.jobTitle,
      company: job.company,
      jobUrl: job.jobUrl,
      location: job.location ?? "",
      description: job.description || matchingRuns[0]?.jobDescription || "",
      generatedDocument: generation?.responseJson ?? null,
      pdfTemplate: isPdfTemplate(job.pdfTemplate) ? job.pdfTemplate : "professional",
    };
  });
  return (
    <WorkspaceShell activeHref="/pdf" user={currentUser}>
      <PdfWorkspace
        managerName={currentUser.displayName}
        savedJobs={savedJobs}
      />
    </WorkspaceShell>
  );
}

function generatedCandidateMatches(value: unknown, expectedName: string): boolean {
  if (!isRecord(value) || !isRecord(value.resume) || !isRecord(value.resume.candidate)) {
    return false;
  }
  const name = value.resume.candidate.fullName;
  return typeof name === "string" && normalizeName(name) === normalizeName(expectedName);
}

function normalizeName(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
