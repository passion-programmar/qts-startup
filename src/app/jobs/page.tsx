import { and, asc, eq, isNull } from "drizzle-orm";
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
import { JobsFilters } from "@/app/jobs/jobs-filters";
import { jobUrlsOnDayAction } from "@/app/jobs/actions";
import { profiles, prompts, users } from "@/db/schema";
import { db } from "@/lib/db";
import { romaniaClock } from "@/lib/romania-time";
import { requireUser } from "@/lib/session";
import { resumeFolderOf } from "@/server/apply/apply-values";
import { isPdfTemplate, pdfTemplateLabels } from "@/server/pdf/pdf-templates";
import { readJobsPage, type ApplyAttemptSummary } from "@/server/jobs/jobs-list";
import {
  defaultJobPageSize,
  jobSearchFields,
  jobsFilterParams,
  parseJobsQuery,
  type JobStage,
} from "@/server/jobs/jobs-list-query";

export const instant = false;

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

const stageStyles: Record<JobStage, { dot: string; badge: string }> = {
  answer: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-800 ring-amber-200" },
  failed: { dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 ring-rose-200" },
  applying: { dot: "bg-sky-500", badge: "bg-sky-50 text-sky-800 ring-sky-200" },
  generating: { dot: "bg-violet-500", badge: "bg-violet-50 text-violet-800 ring-violet-200" },
  ready: { dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  not_started: { dot: "bg-slate-400", badge: "bg-slate-50 text-slate-600 ring-slate-200" },
};

type StatusInput = {
  stage: JobStage;
  status: string;
  failureReason: string | null;
  generationStatus: string;
  generationError: string | null;
  generationBrowserName: string | null;
  applyAttempt: ApplyAttemptSummary | null;
};

/** The words in a row's Status label, and a second line with the reason when there is one. */
function statusLabel(row: StatusInput): { text: string; detail: string | null } {
  const attempt = row.applyAttempt;
  const where = attempt?.browser ? ` on ${attempt.browser}` : "";
  switch (row.stage) {
    case "answer":
      return attempt?.status === "waiting_review"
        ? { text: `Review the form${where}`, detail: null }
        : { text: "Submitted — did it go through?", detail: attempt?.browser ? `On ${attempt.browser}` : null };
    case "applying":
      return { text: `Applying${where}`, detail: null };
    case "generating":
      return row.generationStatus === "processing"
        ? { text: `Making résumé${row.generationBrowserName ? ` on ${row.generationBrowserName}` : ""}`, detail: null }
        : { text: "Queued for résumé", detail: null };
    case "failed": {
      if (row.status === "failed") return { text: "Failed", detail: row.failureReason };
      if (row.generationStatus === "failed") return { text: "Résumé failed", detail: row.generationError };
      const line = applyStatusLines(attempt)[0];
      return { text: line?.text ?? "Apply failed", detail: line?.detail ?? null };
    }
    case "ready":
      return { text: "Résumé ready", detail: attempt?.status === "released" && attempt.reason ? `Apply returned: ${attempt.reason}` : null };
    case "not_started":
      if (row.generationStatus === "cancelled") return { text: "Résumé cancelled", detail: null };
      if (row.generationStatus === "ready") return { text: "Résumé stopped", detail: "Queue it again" };
      return { text: "Not queued", detail: null };
  }
}

function StatusBadge({ row }: { row: StatusInput }) {
  const style = stageStyles[row.stage];
  const label = statusLabel(row);
  return (
    <div className="text-xs">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ring-1 ${style.badge}`}>
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${style.dot}`} />
        {label.text}
      </span>
      {label.detail && <span className="mt-1 line-clamp-2 block text-[11px] text-slate-500" title={label.detail}>{label.detail}</span>}
    </div>
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  const query = parseJobsQuery(await searchParams);
  const today = romaniaClock().day;

  const [list, candidateRows, generationPromptRows] = await Promise.all([
    readJobsPage(currentUser.id, query, today),
    db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName, blockedAt: users.blockedAt })
      .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(users.parentUserId, currentUser.id))
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
  const nameOf = (candidate: { firstName: string | null; lastName: string | null }) =>
    [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate";
  // Every candidate can be filtered on; blocked candidates are read-only, so no job can be moved to one.
  const filterCandidates = candidateRows.map((candidate) => ({ id: candidate.id, name: nameOf(candidate), blocked: candidate.blockedAt !== null }));
  const candidateOptions = candidateRows.filter((candidate) => candidate.blockedAt === null)
    .map((candidate) => ({ id: candidate.id, name: nameOf(candidate) }));
  const generationPromptOptions = generationPromptRows.map((prompt) => ({
    id: prompt.id,
    name: `${prompt.name} · v${prompt.version}`,
  }));
  const pageQuery = { ...query, page: list.page };
  const offset = (list.page - 1) * query.size;
  const filtered = query.tab !== "all" || query.candidate !== "all" || query.date !== "all" || query.q !== "";

  return (
    <WorkspaceShell activeHref="/jobs" user={currentUser}>
      <main className="py-1">
        <PageHeader
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StopAllButtons />
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{list.counts.all} saved</span>
            </div>
          }
          description="Jobs saved for your candidate accounts. Jobs already applied to are on the Bids page."
          title="Jobs"
        />
        <JobsFilters candidates={filterCandidates} counts={list.counts} query={pageQuery} today={today} />
        <PaginatedTable
          columns={[
            { label: "No", className: "w-[4%]" },
            { label: "Name", className: "w-[11%]" },
            { label: "Job title", className: "w-[19%]" },
            { label: "Company", className: "w-[12%]" },
            { label: "Status", className: "w-[14%]" },
            { label: "Résumé", className: "w-[8%]" },
            { label: "Prompt · Template", className: "w-[12%]" },
            { label: "Date", className: "w-[7%]" },
            { label: "Actions", className: "w-[13%]" },
          ]}
          emptyMessage={filtered ? "No jobs match these filters" : "No jobs saved yet"}
          toolbar={<ExportUrlsButton fileLabel="jobs" loadEntries={jobUrlsOnDayAction} today={today} />}
          searchFields={[...jobSearchFields]}
          server={{
            path: "/jobs",
            params: jobsFilterParams(query),
            total: list.total,
            page: list.page,
            pageSize: query.size,
            defaultPageSize: defaultJobPageSize,
            field: query.field,
            query: query.q,
          }}
          rows={list.rows.map((row, index) => {
            const candidateName = nameOf(row);
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
                offset + index + 1,
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
                <StatusBadge key="status" row={row} />,
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
                // The full Apply story lives in the edit window; only what needs an answer stays here.
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
