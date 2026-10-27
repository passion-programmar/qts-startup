import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { BidActions } from "@/app/components/record-forms";
import { OpenFolderButton } from "@/app/components/open-folder";
import { SubmittedAnswersButton, type SubmittedAnswer } from "@/app/components/submitted-answers";
import { bids, categories, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { formatRomaniaTime } from "@/lib/romania-time";
import { requireUser } from "@/lib/session";

export const instant = false;

// Every application the Manager confirmed (Yes after Submit). Each bid is its own record: the job,
// documents, prompt, template, and answers as they were when it was made. Times are Romania time.
export default async function BidsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const rows = await db
    .select({
      id: bids.id,
      title: bids.jobTitle,
      company: bids.company,
      location: bids.location,
      workType: bids.workType,
      salary: bids.salary,
      url: bids.jobUrl,
      sourceSiteUrl: bids.sourceSiteUrl,
      appliedAt: bids.appliedAt,
      resumeFolder: bids.resumeFolder,
      resumeSavedOn: bids.resumeSavedOn,
      googleDrivePath: bids.googleDrivePath,
      templateName: bids.templateName,
      promptName: bids.promptName,
      answers: bids.answers,
      candidateId: bids.candidateId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      candidateBlocked: users.blockedAt,
      category: categories.name,
    })
    .from(bids)
    .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
    .innerJoin(users, eq(users.id, bids.candidateId))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
    .where(eq(bids.managerId, currentUser.id))
    .orderBy(desc(bids.appliedAt));
  // A bid can be moved only to an active candidate; blocked ones are read-only.
  const candidateRows = await db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
    .where(and(eq(users.parentUserId, currentUser.id), isNull(users.blockedAt)))
    .orderBy(asc(profiles.firstName), asc(profiles.lastName));
  const candidateOptions = candidateRows.map((candidate) => ({ id: candidate.id, name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate" }));

  return (
    <WorkspaceShell activeHref="/bids" user={currentUser}>
      <main className="py-1">
        <PageHeader
          actions={<span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{rows.length} applied</span>}
          description="Applications you confirmed as submitted. Times are Romania time."
          title="Bids"
        />
        <PaginatedTable
          columns={[
            { label: "No", className: "w-[3%]" },
            { label: "Candidate", className: "w-[8%]" },
            { label: "Job", className: "w-[13%]" },
            { label: "Source site", className: "w-[8%]" },
            { label: "Location", className: "w-[7%]" },
            { label: "Work type", className: "w-[7%]" },
            { label: "Salary", className: "w-[7%]" },
            { label: "Applied", className: "w-[8%]" },
            { label: "Résumé folder", className: "w-[14%]" },
            { label: "Drive path", className: "w-[6%]" },
            { label: "Prompt · Template", className: "w-[9%]" },
            { label: "Answers", className: "w-[5%]" },
            { label: "Link", className: "w-[4%]" },
            { label: "Actions", className: "w-[5%]" },
          ]}
          emptyMessage="No applications confirmed yet"
          rows={rows.map((row, index) => {
            const candidateName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate";
            const answers = Array.isArray(row.answers) ? row.answers as SubmittedAnswer[] : [];
            return {
              id: row.id,
              cells: [
                index + 1,
                <div key="candidate">
                  <span className="block">{candidateName}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{row.category || "Uncategorized"}</span>
                  {row.candidateBlocked && <span className="mt-0.5 block text-[10px] font-semibold text-rose-700">Blocked</span>}
                </div>,
                <div key="job"><span className="block font-medium">{row.title}</span><span className="mt-1 block text-xs text-slate-500">{row.company}</span></div>,
                row.sourceSiteUrl ? (
                  <a className="break-all text-xs text-blue-700 hover:underline" href={row.sourceSiteUrl} key="source" rel="noreferrer" target="_blank">
                    {row.sourceSiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : "—",
                row.location ?? "—",
                row.workType ?? "—",
                row.salary ?? "—",
                <span className="text-xs" key="applied">{formatRomaniaTime(row.appliedAt)}</span>,
                <OpenFolderButton folder={row.resumeFolder} key="folder" savedOn={row.resumeSavedOn} />,
                row.googleDrivePath ?? "—",
                <div className="text-xs" key="setup">
                  <span className="block font-medium text-slate-700">{row.promptName ?? "—"}</span>
                  {row.templateName && <span className="mt-1 block text-slate-500">{row.templateName}</span>}
                </div>,
                <SubmittedAnswersButton answers={answers} key="answers" title={`${candidateName} · ${row.title} — ${row.company}`} />,
                <a aria-label={`Open ${row.title}`} className="inline-flex size-8 items-center justify-center rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50" href={row.url} key="link" rel="noreferrer" target="_blank"><ExternalLink className="size-4" /></a>,
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
                  }}
                />,
              ],
            };
          })}
        />
      </main>
    </WorkspaceShell>
  );
}
