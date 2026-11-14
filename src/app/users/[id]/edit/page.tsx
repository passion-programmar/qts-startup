import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { categories } from "@/db/schema";
import { loadManagerCandidateProfile } from "@/app/users/candidate-profile";
import { CandidateEditForm } from "@/app/users/user-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";

export const instant = false;

export const metadata: Metadata = {
  title: "Edit candidate | QTS",
};

// A Manager edits one of their own candidates here. A deleted candidate opens read-only.
export default async function EditCandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  if (actor.role !== "manager") redirect("/users");

  const { id } = await params;
  const [loaded, candidateCategories] = await Promise.all([
    loadManagerCandidateProfile(actor.id, id),
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
  ]);
  if (!loaded) notFound();
  const { candidate, deleted } = loaded;
  const name = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate";

  return (
    <WorkspaceShell activeHref="/users" user={actor}>
      <main className="py-1">
        <Link className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800" href="/users">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Candidate accounts
        </Link>
        <PageHeader
          description={deleted
            ? "This candidate is deleted: the profile can be read but not changed, and it is not used for jobs."
            : "Update the candidate's contact information and profile details."}
          title={deleted ? `${name} (deleted, read-only)` : `Edit ${name}`}
        />
        <CandidateEditForm candidate={candidate} categories={candidateCategories} readOnly={deleted} />
      </main>
    </WorkspaceShell>
  );
}
