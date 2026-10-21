import { asc, desc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { JobActions } from "@/app/components/record-forms";
import { categories, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

export default async function JobsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.jobTitle,
      company: jobs.company,
      location: jobs.location,
      url: jobs.jobUrl,
      date: jobs.date,
      status: jobs.status,
      failureReason: jobs.failureReason,
      resumeLocalPath: jobs.resumeLocalPath,
      generationStatus: jobs.generationStatus,
      generationError: jobs.generationError,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      candidateId: jobs.candidateId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      category: categories.name,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
    .where(eq(jobs.managerId, currentUser.id))
    .orderBy(desc(jobs.date), desc(jobs.createdAt));
  const candidateRows = await db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(users.parentUserId, currentUser.id)).orderBy(asc(profiles.firstName), asc(profiles.lastName));
  const candidateOptions = candidateRows.map((candidate) => ({ id: candidate.id, name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate" }));

  return (
    <WorkspaceShell activeHref="/jobs" user={currentUser}>
      <main className="py-1">
        <header className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Jobs</h1>
          <p className="mt-1 text-sm text-slate-500">Jobs saved for your candidate accounts.</p>
        </header>
        <PaginatedTable
          columns={[
            { label: "No", className: "w-16" },
            { label: "Candidate", className: "min-w-44" },
            { label: "Category", className: "min-w-36" },
            { label: "Job", className: "min-w-56" },
            { label: "Location", className: "min-w-40" },
            { label: "Date", className: "min-w-28" },
            { label: "Status", className: "min-w-24" },
            { label: "Resume path (Downloads)", className: "min-w-52" },
            { label: "Generation", className: "min-w-32" },
            { label: "Failure reason", className: "min-w-44" },
            { label: "Link", className: "w-20" },
            { label: "Created", className: "min-w-40" },
            { label: "Updated", className: "min-w-40" },
            { label: "Actions", className: "min-w-48" },
          ]}
          emptyMessage="No jobs saved yet"
          rows={rows.map((row, index) => ({
            id: row.id,
            cells: [
              index + 1,
              [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
              row.category ?? "Uncategorized",
              <div key="job"><span className="block font-medium">{row.title}</span><span className="mt-1 block text-xs text-slate-500">{row.company}</span></div>,
              row.location ?? "—",
              row.date,
              <span className="capitalize" key="status">{row.status.replaceAll("_", " ")}</span>,
              row.resumeLocalPath
                ? <code className="block max-w-64 truncate text-xs" key="resume-path" title={row.resumeLocalPath}>{row.resumeLocalPath}</code>
                : "—",
              <span className="capitalize" key="generation-status">{row.generationStatus.replaceAll("_", " ")}{row.generationError ? <span className="mt-1 block max-w-52 text-xs text-rose-700">{row.generationError}</span> : null}</span>,
              row.failureReason ?? "—",
              <a aria-label={`Open ${row.title}`} className="inline-flex size-8 items-center justify-center rounded border border-blue-200 text-blue-600 hover:bg-blue-50" href={row.url} key="link" rel="noreferrer" target="_blank"><ExternalLink className="size-4" /></a>,
              row.createdAt.toLocaleString(),
              row.updatedAt.toLocaleString(),
              <JobActions candidates={candidateOptions} key="actions" record={{ id: row.id, candidateId: row.candidateId, title: row.title, company: row.company, location: row.location, url: row.url, date: row.date, status: row.status, failureReason: row.failureReason, generationStatus: row.generationStatus, generationError: row.generationError }} />,
            ],
          }))}
        />
      </main>
    </WorkspaceShell>
  );
}
