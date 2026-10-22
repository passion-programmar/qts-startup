import { asc, desc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";
import { PaginatedTable } from "@/app/components/paginated-table";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { BidActions } from "@/app/components/record-forms";
import { bids, categories, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

export default async function BidsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const rows = await db
    .select({
      id: bids.id,
      title: bids.jobTitle,
      company: bids.company,
      location: bids.location,
      employmentType: bids.employmentType,
      workplaceType: bids.workplaceType,
      salary: bids.salary,
      url: bids.jobUrl,
      appliedAt: bids.appliedAt,
      sourceJobId: bids.sourceJobId,
      resumeLocalPath: bids.resumeLocalPath,
      googleDrivePath: bids.googleDrivePath,
      createdAt: bids.createdAt,
      updatedAt: bids.updatedAt,
      candidateId: bids.candidateId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      category: categories.name,
    })
    .from(bids)
    .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
    .where(eq(bids.managerId, currentUser.id))
    .orderBy(desc(bids.appliedAt));
  const candidateRows = await db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName })
    .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(users.parentUserId, currentUser.id)).orderBy(asc(profiles.firstName), asc(profiles.lastName));
  const candidateOptions = candidateRows.map((candidate) => ({ id: candidate.id, name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate" }));

  return (
    <WorkspaceShell activeHref="/bids" user={currentUser}>
      <main className="py-1">
        <header className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bids</h1>
          <p className="mt-1 text-sm text-slate-500">Applications submitted for your candidate accounts.</p>
        </header>
        <PaginatedTable
          columns={[
            { label: "No", className: "w-[3%]" },
            { label: "Candidate", className: "w-[7%]" },
            { label: "Category", className: "w-[6%]" },
            { label: "Job", className: "w-[9%]" },
            { label: "Location", className: "w-[7%]" },
            { label: "Type", className: "w-[5%]" },
            { label: "Salary", className: "w-[6%]" },
            { label: "Applied", className: "w-[5%]" },
            { label: "Resume path", className: "w-[7%]" },
            { label: "Drive path", className: "w-[7%]" },
            { label: "Source job", className: "w-[8%]" },
            { label: "Link", className: "w-[4%]" },
            { label: "Created", className: "w-[6%]" },
            { label: "Updated", className: "w-[6%]" },
            { label: "Actions", className: "w-[14%]" },
          ]}
          emptyMessage="No bids submitted yet"
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
              formatDate(row.appliedAt),
              row.resumeLocalPath,
              row.googleDrivePath ?? "—",
              row.sourceJobId,
              <a aria-label={`Open ${row.title}`} className="inline-flex size-8 items-center justify-center rounded border border-blue-200 text-blue-600 hover:bg-blue-50" href={row.url} key="link" rel="noreferrer" target="_blank"><ExternalLink className="size-4" /></a>,
              row.createdAt.toLocaleString(),
              row.updatedAt.toLocaleString(),
              <BidActions candidates={candidateOptions} key="actions" record={{ id: row.id, candidateId: row.candidateId, title: row.title, company: row.company, location: row.location, url: row.url, employmentType: row.employmentType, workplaceType: row.workplaceType, salary: row.salary, resumeLocalPath: row.resumeLocalPath, googleDrivePath: row.googleDrivePath, appliedAt: toDateTimeLocal(row.appliedAt) }} />,
            ],
          }))}
        />
      </main>
    </WorkspaceShell>
  );
}

function toDateTimeLocal(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
