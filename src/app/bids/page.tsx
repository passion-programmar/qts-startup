import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { BidActions } from "@/app/components/record-forms";
import { OpenFolderButton } from "@/app/components/open-folder";
import { ExportUrlsButton } from "@/app/components/export-urls";
import type { SubmittedAnswer } from "@/app/components/submitted-answers";
import { bids, categories, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { formatRomaniaDate, formatRomaniaTime, romaniaClock } from "@/lib/romania-time";
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
      createdAt: bids.createdAt,
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
            { label: "No", className: "w-[4%]" },
            { label: "Candidate", className: "w-[13%]" },
            { label: "Source URL", className: "w-[14%]" },
            { label: "Job title", className: "w-[22%]" },
            { label: "Company", className: "w-[15%]" },
            { label: "Résumé", className: "w-[9%]" },
            { label: "Created", className: "w-[12%]" },
            { label: "View", className: "w-[11%]" },
          ]}
          emptyMessage="No applications confirmed yet"
          toolbar={<ExportUrlsButton entries={rows.map((row) => ({ url: row.url, date: romaniaClock(row.createdAt).day }))} fileLabel="bids" today={romaniaClock().day} />}
          searchFields={[
            { key: "candidate", label: "Candidate" },
            { key: "source", label: "Source URL" },
            { key: "title", label: "Job title" },
            { key: "company", label: "Company" },
            { key: "created", label: "Date" },
          ]}
          rows={rows.map((row, index) => {
            const candidateName = [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate";
            const answers = Array.isArray(row.answers) ? row.answers as SubmittedAnswer[] : [];
            const created = formatRomaniaDate(row.createdAt);
            return {
              id: row.id,
              search: {
                candidate: candidateName,
                source: row.sourceSiteUrl ?? "",
                title: row.title,
                company: row.company,
                created,
              },
              cells: [
                index + 1,
                <div key="candidate">
                  <span className="block">{candidateName}</span>
                  {row.candidateBlocked && <span className="mt-0.5 block text-[10px] font-semibold text-rose-700">Blocked</span>}
                </div>,
                row.sourceSiteUrl ? (
                  <a className="break-all text-xs text-blue-700 hover:underline" href={row.sourceSiteUrl} key="source" rel="noreferrer" target="_blank">
                    {row.sourceSiteUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : "—",
                <a className="font-medium text-blue-700 hover:underline" href={row.url} key="job" rel="noreferrer" target="_blank" title={row.url}>{row.title}</a>,
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
                      answers,
                    },
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
