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
      description: jobs.description,
      location: jobs.location,
      employmentType: jobs.employmentType,
      workplaceType: jobs.workplaceType,
      salary: jobs.salary,
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
            { label: "No", className: "w-[3%]" },
            { label: "Candidate", className: "w-[7%]" },
            { label: "Category", className: "w-[6%]" },
            { label: "Job", className: "w-[9%]" },
            { label: "Location", className: "w-[7%]" },
            { label: "Work type", className: "w-[6%]" },
            { label: "Salary", className: "w-[6%]" },
            { label: "Date", className: "w-[5%]" },
            { label: "Status", className: "w-[5%]" },
            { label: "Resume path (Downloads)", className: "w-[7%]" },
            { label: "Generation", className: "w-[7%]" },
            { label: "Failure reason", className: "w-[7%]" },
            { label: "Link", className: "w-[4%]" },
            { label: "Created", className: "w-[6%]" },
            { label: "Updated", className: "w-[6%]" },
            { label: "Actions", className: "w-[9%]" },
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
              [row.employmentType, row.workplaceType].filter(Boolean).join(" · ") || "—",
              row.salary ?? "—",
              row.date,
              <span className="capitalize" key="status">{row.status.replaceAll("_", " ")}</span>,
              row.resumeLocalPath
                ? <code className="block max-w-full whitespace-normal break-all text-xs" key="resume-path" title={row.resumeLocalPath}>{row.resumeLocalPath}</code>
                : "—",
              <span className="capitalize" key="generation-status">{row.generationStatus.replaceAll("_", " ")}{row.generationError ? <span className="mt-1 block max-w-52 text-xs text-rose-700">{row.generationError}</span> : null}</span>,
              row.failureReason ?? "—",
              <a aria-label={`Open ${row.title}`} className="inline-flex size-8 items-center justify-center rounded border border-blue-200 text-blue-600 hover:bg-blue-50" href={row.url} key="link" rel="noreferrer" target="_blank"><ExternalLink className="size-4" /></a>,
              row.createdAt.toLocaleString(),
              row.updatedAt.toLocaleString(),
              <JobActions candidates={candidateOptions} key="actions" record={{ id: row.id, candidateId: row.candidateId, title: row.title, company: row.company, description: row.description, location: row.location, employmentType: row.employmentType, workplaceType: row.workplaceType, salary: row.salary, url: row.url, date: row.date, status: row.status, failureReason: row.failureReason, generationStatus: row.generationStatus, generationError: row.generationError }} />,
            ],
          }))}
        />
      </main>
    </WorkspaceShell>
  );
}
