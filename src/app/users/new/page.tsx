import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { categories } from "@/db/schema";
import { PageHeader } from "@/app/ui/page-header";
import { CandidateCreateForm } from "@/app/users/candidate-form";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

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
    <main className="py-1">
      <PageHeader
        back={{ href: "/users", label: "Candidate accounts" }}
        description="Add contact details and career information for this candidate."
        title="Add New candidate"
      />
      <CandidateCreateForm categories={candidateCategories} />
    </main>
  );
}
