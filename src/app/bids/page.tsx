import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExportUrlsButton } from "@/app/components/export-urls";
import { OpenFolderButton } from "@/app/components/open-folder";
import { PaginatedTable } from "@/app/components/paginated-table";
import { BidActions } from "@/app/components/record-forms";
import { Badge } from "@/app/ui/badge";
import { PageHeader } from "@/app/ui/page-header";
import { profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { formatRomaniaDate, formatRomaniaTime } from "@/lib/romania-time";
import { requireUser } from "@/lib/session";
import { bidSearchFields, defaultBidPageSize, parseBidsQuery, readBidsPage } from "@/server/bids/bids-list";
import { interviewSteps, isInterviewResult, isInterviewStep, resultClasses, resultLabel, stepLabel, type InterviewResult, type InterviewStep } from "@/server/interviews/interview-values";

const trackDotClasses: Record<InterviewResult | "none", string> = {
  passed: "bg-emerald-500",
  waiting: "bg-amber-400",
  rejected: "bg-rose-500",
  no_show: "bg-rose-500",
  none: "bg-slate-200",
};

// "Interviewing" on a bid: one dot per step (Intro, Tech, Final, Offer) coloured by how its latest
// round went, then the latest round, e.g. "Tech · Waiting". Opens the Interviews By job view.
function InterviewTrack({ value }: { value: string }) {
  const rounds = value.split(",").map((part) => part.split(":")).filter((pair): pair is [InterviewStep, InterviewResult] => isInterviewStep(pair[0]) && isInterviewResult(pair[1]));
  const latest = rounds.at(-1);
  if (!latest) return null;
  const byStep = new Map(rounds);
  return (
    <Link className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset hover:opacity-80 ${resultClasses[latest[1]]}`} href="/interviews?mode=jobs" title={interviewSteps.map((step) => `${step.label}: ${byStep.has(step.key) ? resultLabel(byStep.get(step.key) ?? "waiting") : "–"}`).join(" · ")}>
      <span aria-hidden="true" className="flex gap-0.5">
        {interviewSteps.map((step) => <span className={`size-1.5 rounded-full ${trackDotClasses[byStep.get(step.key) ?? "none"]}`} key={step.key} />)}
      </span>
      {stepLabel(latest[0])} · {resultLabel(latest[1])}
    </Link>
  );
}

export const instant = false;

// Every application the Manager confirmed (Yes after Submit). Each bid is its own record: the job,
// documents, prompt, template, and answers as they were when it was made. Times are Romania time.
// One page is read at a time, searched on the server; a bid's answers load when its window opens.
export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  const query = parseBidsQuery(await searchParams);

  const [list, candidateRows] = await Promise.all([
    readBidsPage(currentUser.id, query),
    // A bid can be moved only to an active candidate; blocked ones are read-only.
    db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
      .where(and(eq(users.parentUserId, currentUser.id), isNull(users.blockedAt)))
      .orderBy(asc(profiles.firstName), asc(profiles.lastName)),
  ]);
  const candidateOptions = candidateRows.map((candidate) => ({ id: candidate.id, name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate" }));
  const offset = (list.page - 1) * query.size;

  return (
    <main className="py-1">
      <PageHeader
        actions={<Badge className="px-3 py-1 text-xs">{list.all} applied</Badge>}
        description="Applications you confirmed as submitted. Times are Romania time."
        title="Bids"
      />
      <PaginatedTable
        columns={[
          { label: "No", className: "w-[4%]" },
          { label: "Candidate", className: "w-[13%]" },
          { label: "Source URL", className: "w-[14%]" },
          { label: "Job title", className: "w-[22%]" },
          { label: "Company", className: "w-[15%]" },
          { label: "Résumé", className: "w-[9%]" },
          { label: "Created", className: "w-[12%]" },
          { label: "View", className: "w-[11%]" },
        ]}
        emptyMessage={query.q ? "No bids match your search" : "No applications confirmed yet"}
        toolbar={<ExportUrlsButton />}
        searchFields={[...bidSearchFields]}
        server={{
          path: "/bids",
          params: {},
          total: list.total,
          page: list.page,
          pageSize: query.size,
          defaultPageSize: defaultBidPageSize,
          field: query.field,
          query: query.q,
        }}
        rows={list.rows.map((row, index) => {
          const candidateName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate";
          const created = formatRomaniaDate(row.createdAt);
          return {
            id: row.id,
            cells: [
              offset + index + 1,
              <div key="candidate">
                <span className="block">{candidateName}</span>
                {row.candidateBlocked && <Badge className="mt-1" tone="danger">Blocked</Badge>}
              </div>,
              row.sourceSiteUrl ? (
                <a className="break-all text-xs text-blue-700 hover:underline" href={row.sourceSiteUrl} key="source" rel="noreferrer" target="_blank">
                  {row.sourceSiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              ) : "—",
              <div key="job">
                {row.url
                  ? <a className="font-medium text-blue-700 hover:underline" href={row.url} rel="noreferrer" target="_blank" title={row.url}>{row.title}</a>
                  : <span className="font-medium text-slate-900" title="No job URL (downloaded on the Resume page)">{row.title}</span>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {row.interviewRounds && <InterviewTrack value={row.interviewRounds} />}
                  <Link className="text-[11px] font-semibold text-indigo-600 hover:underline" href={`/interviews?add=${row.id}`}>+ Interview</Link>
                </div>
              </div>,
              row.company,
              <OpenFolderButton folder={row.resumeFolder} key="folder" label="Résumé" savedOn={row.resumeSavedOn} />,
              <span className="text-xs" key="created">{created}</span>,
              <BidActions
                candidates={candidateOptions}
                key="actions"
                record={{
                  id: row.id,
                  candidateId: row.candidateId,
                  title: row.title,
                  company: row.company,
                  location: row.location,
                  url: row.url,
                  workType: row.workType,
                  salary: row.salary,
                  resumeFolder: row.resumeFolder,
                  googleDrivePath: row.googleDrivePath,
                  details: {
                    candidateName,
                    category: row.category,
                    sourceSiteUrl: row.sourceSiteUrl,
                    appliedAt: formatRomaniaTime(row.appliedAt),
                    createdAt: created,
                    resumeSavedOn: row.resumeSavedOn,
                    promptName: row.promptName,
                    templateName: row.templateName,
                  },
                }}
              />,
            ],
          };
        })}
      />
    </main>
  );
}
