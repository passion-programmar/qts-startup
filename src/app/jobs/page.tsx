import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import {
  JobDeleteAction,
  JobEditAction,
  JobGenerationQueueAction,
} from "@/app/components/record-forms";
import { jobs, profiles, users } from "@/db/schema";
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
      candidateId: jobs.candidateId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
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
            { label: "No", className: "w-[5%]" },
            { label: "Candidate Name", className: "w-[13%]" },
            { label: "Job Title", className: "w-[22%]" },
            { label: "Status", className: "w-[9%]" },
            { label: "Resume Path", className: "w-[16%]" },
            { label: "Date", className: "w-[9%]" },
            { label: "Edit", className: "w-[7%]" },
            { label: "Delete", className: "w-[7%]" },
            { label: "Queue", className: "w-[12%]" },
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
              generationError: row.generationError,
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
                </div>,
                <div key="status">
                  <span className="capitalize">{row.status.replaceAll("_", " ")}</span>
                  <span className="mt-1 block text-[10px] capitalize text-slate-500">
                    Generation: {row.generationStatus.replaceAll("_", " ")}
                  </span>
                  {row.generationError && (
                    <span className="mt-1 block text-xs text-rose-700">
                      {row.generationError}
                    </span>
                  )}
                </div>,
                row.resumeLocalPath
                  ? <code className="block max-w-full whitespace-normal break-all text-xs" key="resume-path" title={row.resumeLocalPath}>{row.resumeLocalPath}</code>
                  : "—",
                row.date,
                <JobEditAction candidates={candidateOptions} key="edit" record={editableJob} />,
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
