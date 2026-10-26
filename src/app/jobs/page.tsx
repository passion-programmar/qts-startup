import { asc, desc, eq, sql } from "drizzle-orm";
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
import { StopAllButtons } from "@/app/jobs/stop-all-buttons";
import { jobs, profiles, prompts, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { effectiveJobDescription } from "@/server/jobs/job-description";
import type { ApplyRun } from "@/server/apply/apply-values";
import { isPdfTemplate, pdfTemplateLabels } from "@/server/pdf/pdf-templates";

export const instant = false;

type ApplyAttemptSummary = {
  status: "claimed" | "submitting" | "confirmed" | "not_confirmed" | "failed" | "released" | "skipped";
  reason: string | null;
  browser: string | null;
  screenshot: string | null;
};

/** One line about a row's latest application, plus where its screenshot is when it has one. */
function applyStatusLines(attempt: ApplyAttemptSummary | null): ApplyStatusLine[] {
  if (!attempt) return [];
  const where = attempt.browser ? ` on ${attempt.browser}` : "";
  const screenshot = attempt.screenshot ? `Screenshot saved on ${attempt.screenshot}` : null;
  switch (attempt.status) {
    case "claimed":
      return [{ text: `Applying${where}`, tone: "info", detail: null }];
    case "submitting":
      return [{ text: `Submitted${where} — checking the result`, tone: "info", detail: null }];
    case "confirmed":
      return [{ text: "Apply: confirmed", tone: "info", detail: null }];
    case "not_confirmed":
      return [{ text: "Submitted — not confirmed", tone: "warn", detail: [attempt.reason, screenshot].filter(Boolean).join(" · ") || null }];
    case "failed":
      return [{ text: "Apply failed", tone: "error", detail: [attempt.reason, screenshot].filter(Boolean).join(" · ") || null }];
    case "skipped":
      return [{ text: "Apply skipped", tone: "warn", detail: attempt.reason }];
    case "released":
      return attempt.reason ? [{ text: "Apply returned to the list", tone: "info", detail: attempt.reason }] : [];
  }
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
          'status', a.status, 'reason', a.result_reason,
          'browser', b.name, 'screenshot', a.screenshot_browser_name
        )
        from apply_attempts a left join extension_browsers b on b.id = a.browser_id
        where a.job_id = ${jobs.id}
        order by a.created_at desc limit 1
      )`,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .leftJoin(prompts, eq(prompts.id, jobs.promptId))
    .where(eq(jobs.managerId, currentUser.id))
    .orderBy(desc(jobs.date), desc(jobs.createdAt));
  const candidateRows = await db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(users.parentUserId, currentUser.id)).orderBy(asc(profiles.firstName), asc(profiles.lastName));
  const candidateOptions = candidateRows.map((candidate) => ({ id: candidate.id, name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate" }));

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
          description="Jobs saved for your candidate accounts."
          title="Jobs"
        />
        <PaginatedTable
          columns={[
            { label: "No", className: "w-[5%]" },
            { label: "Candidate Name", className: "w-[11%]" },
            { label: "Job Title", className: "w-[22%]" },
            { label: "Status", className: "w-[9%]" },
            { label: "Resume Path", className: "w-[14%]" },
            { label: "Prompt · Template", className: "w-[12%]" },
            { label: "Date", className: "w-[7%]" },
            { label: "Edit", className: "w-[5%]" },
            { label: "Delete", className: "w-[5%]" },
            { label: "Queue", className: "w-[10%]" },
          ]}
          emptyMessage="No jobs saved yet"
          rows={rows.map((row, index) => {
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
              cells: [
                index + 1,
                [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
                <div key="job">
                  <a
                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                    href={row.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {row.title}
                  </a>
                  <span className="mt-1 block text-xs text-slate-500">{row.company}</span>
                  {row.jobReason && (
                    <span className="mt-1 block text-xs text-slate-500">{row.jobReason}</span>
                  )}
                </div>,
                <div key="status">
                  <span className="capitalize">{row.status.replaceAll("_", " ")}</span>
                  <span className="mt-1 block text-[10px] capitalize text-slate-500">
                    Generation: {row.generationStatus.replaceAll("_", " ")}
                    {row.generationStatus === "processing" && row.generationBrowserName && (
                      <span className="normal-case"> on {row.generationBrowserName}</span>
                    )}
                  </span>
                  {applyStatusLines(row.applyAttempt).map((line) => (
                    <span className="mt-1 block" key={line.text}>
                      <span className={`block text-[10px] font-semibold ${
                        line.tone === "error" ? "text-rose-700" : line.tone === "warn" ? "text-amber-700" : "text-slate-600"
                      }`}>
                        {line.text}
                      </span>
                      {line.detail && <span className="block text-xs text-slate-500">{line.detail}</span>}
                    </span>
                  ))}
                  {row.generationError && (
                    // Only a failed job shows its note as an error; a requeued job's note is informational.
                    <span className={`mt-1 block text-xs ${row.generationStatus === "failed" ? "text-rose-700" : "text-slate-500"}`}>
                      {row.generationError}
                    </span>
                  )}
                </div>,
                row.resumeLocalPath
                  ? <code className="block max-w-full whitespace-normal break-all text-xs" key="resume-path" title={row.resumeLocalPath}>{row.resumeLocalPath}</code>
                  : "—",
                <GenerationSetup
                  key="generation-setup"
                  pdfTemplate={row.pdfTemplate}
                  promptName={row.promptName}
                  promptVersion={row.promptVersion}
                />,
                row.date,
                <JobEditAction candidates={candidateOptions} key="edit" record={editableJob} track={track} />,
                <JobDeleteAction key="delete" record={editableJob} />,
                <JobGenerationQueueAction key="queue" record={editableJob} />,
              ],
            };
          })}
        />
      </main>
    </WorkspaceShell>
  );
}
