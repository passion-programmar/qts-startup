import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PdfWorkspace } from "@/app/pdf/pdf-workspace";
import { requireUser } from "@/lib/session";
import { generationRuns, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { isPdfTemplate } from "@/server/pdf/pdf-templates";

export const instant = false;

export const metadata: Metadata = {
  title: "Resume",
};

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
  const generationRows = jobRows.length
    ? await db
        .select({
          jobId: generationRuns.jobId,
          jobDescription: generationRuns.jobDescription,
          responseJson: generationRuns.responseJson,
        })
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.managerId, currentUser.id),
            eq(generationRuns.status, "delivered"),
            isNotNull(generationRuns.responseJson),
            inArray(generationRuns.jobId, jobRows.map((job) => job.id)),
          ),
        )
        .orderBy(desc(generationRuns.createdAt))
        .limit(250)
    : [];
  const generationByJob = new Map<string, (typeof generationRows)[number]>();
  for (const run of generationRows) {
    if (run.jobId && !generationByJob.has(run.jobId)) {
      generationByJob.set(run.jobId, run);
    }
  }
  const savedJobs = jobRows.map((job) => {
    const generation = generationByJob.get(job.id);
    const candidateName =
      [job.firstName, job.lastName].filter(Boolean).join(" ") || "Candidate";
    return {
      id: job.id,
      candidateName,
      jobTitle: job.jobTitle,
      company: job.company,
      jobUrl: job.jobUrl,
      location: job.location ?? "",
      description: job.description || generation?.jobDescription || "",
      generatedDocument: generation?.responseJson ?? null,
      pdfTemplate: isPdfTemplate(job.pdfTemplate) ? job.pdfTemplate : "qts-standard",
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
