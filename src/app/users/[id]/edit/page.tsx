import { createHash } from "node:crypto";
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
  // The Manager edits their own candidates; the Super Admin may view any candidate (read-only).
  const viewOnly = actor.role === "super_admin";
  if (actor.role !== "manager" && !viewOnly) redirect("/users");

  const { id } = await params;
  const [loaded, candidateCategories] = await Promise.all([
    loadManagerCandidateProfile(viewOnly ? null : actor.id, id),
    db.select({ id: categories.id, name: categories.name, color: categories.color, isDefault: categories.isDefault }).from(categories).orderBy(asc(categories.name)),
  ]);
  if (!loaded) notFound();
  const { candidate, deleted } = loaded;
  const name = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Candidate";

  return (
    <main className="py-1">
      <PageHeader
        back={{ href: "/users", label: viewOnly ? "People" : "Candidate accounts" }}
        title={deleted ? `${name} (deleted, read-only)` : viewOnly ? `${name} (view only)` : `Edit ${name}`}
      />
      {/* Next keeps a left page alive with its typed values (Activity). Keyed by the saved data, the
          form starts over from the database after a save instead of showing the old values. */}
      <CandidateEditForm
        candidate={candidate}
        categories={candidateCategories}
        key={createHash("sha1").update(JSON.stringify(loaded)).digest("hex")}
        readOnly={deleted || viewOnly}
      />
    </main>
  );
}
