import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { categories } from "@/db/schema";
import { PageHeader } from "@/app/ui/page-header";
import { CandidateEditForm } from "@/app/users/candidate-form";
import { loadManagerCandidateProfile } from "@/app/users/candidate-profile";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

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
    <main className="py-1">
      <PageHeader
        back={{ href: "/users", label: "Candidate accounts" }}
        description={deleted
          ? "This candidate is deleted: the profile can be read but not changed, and it is not used for jobs."
          : "Update the candidate's contact information and profile details."}
        title={deleted ? `${name} (deleted, read-only)` : `Edit ${name}`}
      />
      <CandidateEditForm candidate={candidate} categories={candidateCategories} readOnly={deleted} />
    </main>
  );
}
