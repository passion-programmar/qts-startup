import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Tags } from "lucide-react";
import {
  CreateCategoryForm,
  DeleteCategoryForm,
  EditCategoryForm,
} from "@/app/categories/category-forms";
import { categories, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";

export const instant = false;

export const metadata: Metadata = {
  title: "Categories | QTS",
};

export default async function CategoriesPage() {
  const actor = await requireUser();
  if (actor.role !== "super_admin") redirect("/");

  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      assignedProfiles: count(profiles.userId),
    })
    .from(categories)
    .leftJoin(profiles, eq(profiles.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));

  return (
    <WorkspaceShell activeHref="/categories" user={actor}>
      <main className="py-1 text-slate-900">
        <PageHeader
          description="Group candidates by category. ChatGPT prompts are written per category."
          eyebrow="Administration"
          title="Candidate categories"
        />

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-800">Add category</h2>
          <CreateCategoryForm />
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Tags className="size-4 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">Categories</h2>
          </div>
          <PaginatedTable
            columns={[
              { label: "Category", className: "w-[60%]" },
              { label: "Candidate profiles", className: "w-[20%]" },
              { label: "Actions", className: "w-[20%]" },
            ]}
            emptyMessage="No categories"
            rows={categoryRows.map((category) => ({
              id: category.id,
              cells: [
                <EditCategoryForm id={category.id} key="category" name={category.name} />,
                category.assignedProfiles,
                <DeleteCategoryForm id={category.id} key="delete" name={category.name} />,
              ],
            }))}
          />
        </section>
      </main>
    </WorkspaceShell>
  );
}
