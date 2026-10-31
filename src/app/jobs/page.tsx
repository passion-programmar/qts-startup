import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/app/components/page-header";
import { PaginatedTable } from "@/app/components/paginated-table";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import {
  JobDeleteAction,
  JobEditAction,
  JobGenerationQueueAction,
  type ApplyStatusLine,
  type JobTrack,
} from "@/app/components/record-forms";
import { GenerationSetup } from "@/app/components/generation-setup";
import { OpenFolderButton } from "@/app/components/open-folder";
import { ExportUrlsButton } from "@/app/components/export-urls";
import { StopAllButtons } from "@/app/jobs/stop-all-buttons";
import { AnswerApplicationButtons, ApplyAgainButton } from "@/app/jobs/apply-buttons";
import { jobs, profiles, prompts, users } from "@/db/schema";
import { db } from "@/lib/db";
import { romaniaClock } from "@/lib/romania-time";
import { requireUser } from "@/lib/session";
import { jobHasBid } from "@/server/jobs/job-bids";
import { effectiveJobDescription } from "@/server/jobs/job-description";
import { resumeFolderOf, type ApplyRun } from "@/server/apply/apply-values";
import { isPdfTemplate, pdfTemplateLabels } from "@/server/pdf/pdf-templates";

export const instant = false;

type ApplyAttemptSummary = {
  id: string;
  status: "claimed" | "waiting_review" | "waiting_confirmation" | "submitting" | "confirmed" | "not_confirmed"
    | "failed" | "released" | "skipped" | "cleared";
  reason: string | null;
  browser: string | null;
  returns: number;
};

/** One line about a row's latest application, plus where its screenshot is when it has one. */
function applyStatusLines(attempt: ApplyAttemptSummary | null): ApplyStatusLine[] {
  if (!attempt) return [];
  const where = attempt.browser ? ` on ${attempt.browser}` : "";
  switch (attempt.status) {
    case "claimed":
      return [{ text: `Apply is filling the form${where}`, tone: "info", detail: null }];
    case "waiting_review":
      return [{ text: `Waiting for your review${where}`, tone: "warn", detail: null }];
    case "waiting_confirmation":
    case "submitting":
      return [{ text: `Submitted${where} — waiting for your answer`, tone: "warn", detail: null }];
    case "confirmed":
      return [{ text: "Applied: you confirmed it", tone: "info", detail: null }];
    case "not_confirmed":
      return [{ text: "Submitted — not confirmed", tone: "warn", detail: attempt.reason }];
    case "failed":
      return [{ text: "Not submitted (you answered No)", tone: "error", detail: null }];
    case "skipped":
      return [{ text: "Apply skipped", tone: "warn", detail: attempt.reason }];
    case "released":
      return attempt.reason ? [{ text: attempt.returns >= 2 ? "Apply stopped twice" : "Apply returned to the list", tone: attempt.returns >= 2 ? "error" : "info", detail: attempt.reason }] : [];
    case "cleared":
      return [{ text: "Offered to Apply again", tone: "info", detail: null }];
  }
}

/** Whether a job's latest application can be offered to Apply again. */
function canApplyAgain(attempt: ApplyAttemptSummary | null, jobStatus: string): boolean {
  if (!attempt || jobStatus === "applied") return false;
  return attempt.status === "failed" || attempt.status === "skipped" || (attempt.status === "released" && attempt.returns >= 2);
}

export default async function JobsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.jobTitle,
      company: jobs.company,
      description: effectiveJobDescription(),
      location: jobs.location,
      employmentType: jobs.employmentType,
      workplaceType: jobs.workplaceType,
      salary: jobs.salary,
      jobReason: jobs.jobReason,
      url: jobs.jobUrl,
      date: jobs.date,
      status: jobs.status,
      failureReason: jobs.failureReason,
      resumeLocalPath: jobs.resumeLocalPath,
      googleDrivePath: jobs.googleDrivePath,
      createdAt: jobs.createdAt,
      applyRuns: sql<ApplyRun[] | null>`${jobs.applyAnswers}`,
      generationStatus: jobs.generationStatus,
      generationAttemptCount: jobs.generationAttemptCount,
      generationError: jobs.generationError,
      candidateId: jobs.candidateId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      promptName: prompts.name,
      promptVersion: prompts.version,
      pdfTemplate: jobs.pdfTemplate,
      // Where this row runs when several Chromes work, and how its latest application went.
      generationBrowserName: sql<string | null>`(
        select b.name from extension_browsers b where b.id = ${jobs.generationBrowserId}
      )`,
      applyAttempt: sql<ApplyAttemptSummary | null>`(
        select jsonb_build_object(
          'id', a.id, 'status', a.status, 'reason', a.result_reason, 'browser', b.name,
          'returns', (select count(*) from apply_attempts r where r.job_id = a.job_id and r.status = 'released')
        )
        from apply_attempts a left join extension_browsers b on b.id = a.browser_id
        where a.job_id = ${jobs.id}
        order by a.created_at desc limit 1
      )`,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .leftJoin(prompts, eq(prompts.id, jobs.promptId))
    // A job that already has a bid lives on the Bids page, so it is left out here.
    .where(and(eq(jobs.managerId, currentUser.id), sql`not ${jobHasBid()}`))
    .orderBy(desc(jobs.date), desc(jobs.createdAt));
  const [candidateRows, generationPromptRows] = await Promise.all([
    db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
      // Blocked candidates are read-only: no job can be moved to one.
      .where(and(eq(users.parentUserId, currentUser.id), isNull(users.blockedAt)))
      .orderBy(asc(profiles.firstName), asc(profiles.lastName)),
    db.select({ id: prompts.id, name: prompts.name, version: prompts.version })
      .from(prompts)
      .where(and(
        eq(prompts.ownerManagerId, currentUser.id),
        eq(prompts.provider, "openai"),
        eq(prompts.purpose, "document_generation"),
        eq(prompts.isActive, true),
        isNull(prompts.archivedAt),
      ))
      .orderBy(asc(prompts.name), asc(prompts.version)),
  ]);
  const candidateOptions = candidateRows.map((candidate) => ({ id: candidate.id, name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate" }));
  const generationPromptOptions = generationPromptRows.map((prompt) => ({
    id: prompt.id,
    name: `${prompt.name} · v${prompt.version}`,
  }));

  return (
    <WorkspaceShell activeHref="/jobs" user={currentUser}>
      <main className="py-1">
        <PageHeader
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StopAllButtons />
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{rows.length} saved</span>
            </div>
          }
          description="Jobs saved for your candidate accounts. Jobs already applied to are on the Bids page."
          title="Jobs"
        />
        <PaginatedTable
          columns={[
            { label: "No", className: "w-[4%]" },
            { label: "Name", className: "w-[11%]" },
            { label: "Job title", className: "w-[17%]" },
            { label: "Company", className: "w-[12%]" },
            { label: "Job URL", className: "w-[12%]" },
            { label: "Résumé", className: "w-[9%]" },
            { label: "Prompt · Template", className: "w-[13%]" },
            { label: "Date", className: "w-[9%]" },
            { label: "Actions", className: "w-[14%]" },
          ]}
          emptyMessage="No jobs saved yet"
          toolbar={<ExportUrlsButton entries={rows.map((row) => ({ url: row.url, date: row.date }))} fileLabel="jobs" today={romaniaClock().day} />}
          searchFields={[
            { key: "name", label: "Name" },
            { key: "title", label: "Job title" },
            { key: "company", label: "Company" },
            { key: "url", label: "Job URL" },
            { key: "setup", label: "Prompt · Template" },
            { key: "date", label: "Date" },
          ]}
          rows={rows.map((row, index) => {
            const candidateName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate";
            const date = row.date.replaceAll("-", "/");
            const editableJob = {
              id: row.id,
              candidateId: row.candidateId,
              title: row.title,
              company: row.company,
              description: row.description,
              location: row.location,
              employmentType: row.employmentType,
              workplaceType: row.workplaceType,
              salary: row.salary,
              url: row.url,
              date: row.date,
              status: row.status,
              failureReason: row.failureReason,
              generationStatus: row.generationStatus,
              generationAttemptCount: row.generationAttemptCount,
              generationError: row.generationError,
            };
            const track: JobTrack = {
              savedAt: row.createdAt.toISOString(),
              jobReason: row.jobReason,
              prompt: row.promptName ? `${row.promptName} · v${row.promptVersion}` : null,
              template: row.pdfTemplate ? (isPdfTemplate(row.pdfTemplate) ? pdfTemplateLabels[row.pdfTemplate] : row.pdfTemplate) : null,
              resumeLocalPath: row.resumeLocalPath,
              googleDrivePath: row.googleDrivePath,
              generationBrowserName: row.generationBrowserName,
              applyStatus: applyStatusLines(row.applyAttempt),
              applyRuns: Array.isArray(row.applyRuns) ? row.applyRuns : [],
            };
            return {
              id: row.id,
              search: {
                name: candidateName,
                title: row.title,
                company: row.company,
                url: row.url,
                setup: [track.prompt, track.template].filter(Boolean).join(" "),
                date,
              },
              cells: [
                index + 1,
                candidateName,
                <a
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  href={row.url}
                  key="job"
                  rel="noopener noreferrer"
                  target="_blank"
                  title={row.url}
                >
                  {row.title}
                </a>,
                row.company,
                <a className="break-all text-xs text-blue-700 hover:underline" href={row.url} key="url" rel="noopener noreferrer" target="_blank">
                  {row.url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>,
                row.resumeLocalPath
                  ? <OpenFolderButton folder={resumeFolderOf(row.resumeLocalPath)} key="resume" label="Résumé" savedOn={row.generationBrowserName} />
                  : "—",
                <GenerationSetup
                  key="generation-setup"
                  pdfTemplate={row.pdfTemplate}
                  promptName={row.promptName}
                  promptVersion={row.promptVersion}
                />,
                <span className="text-xs" key="date">{date}</span>,
                // Status and the Apply story live in the edit window; only what needs an answer stays here.
                <div key="actions">
                  <div className="flex flex-wrap items-start gap-2">
                    <JobEditAction candidates={candidateOptions} record={editableJob} track={track} />
                    <JobDeleteAction record={editableJob} />
                    <JobGenerationQueueAction prompts={generationPromptOptions} record={editableJob} />
                  </div>
                  {row.applyAttempt && ["waiting_confirmation", "submitting"].includes(row.applyAttempt.status) && (
                    <AnswerApplicationButtons attemptId={row.applyAttempt.id} title={`${row.title} — ${row.company}`} />
                  )}
                  {canApplyAgain(row.applyAttempt, row.status) && <ApplyAgainButton jobId={row.id} />}
                </div>,
              ],
            };
          })}
        />
      </main>
    </WorkspaceShell>
  );
}
