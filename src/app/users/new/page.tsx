import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { categories } from "@/db/schema";
import { CandidateCreateForm } from "@/app/users/user-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";

export const instant = false;

export const metadata: Metadata = {
  title: "Add candidate | QTS",
};

// A Manager adds a candidate on this page; other roles add staff from the People page.
export default async function NewCandidatePage() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  if (actor.role !== "manager") redirect("/users");

  const candidateCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.name));

  return (
    <WorkspaceShell activeHref="/users" user={actor}>
      <main className="py-1">
        <Link className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800" href="/users">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Candidate accounts
        </Link>
        <PageHeader
          description="Add contact details and career information for this candidate."
          title="Add New candidate"
        />
        <CandidateCreateForm categories={candidateCategories} />
      </main>
    </WorkspaceShell>
  );
}
