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
      <div className="mx-auto max-w-4xl">
        <header className="mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Candidate categories
            </h1>
          </div>
        </header>

        <section className="mb-5 rounded border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-800">
            Add category
          </h2>
          <CreateCategoryForm />
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Tags className="size-4 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">
              Categories
            </h2>
          </div>
          <PaginatedTable
            columns={[
              { label: "Category", className: "min-w-52" },
              { label: "Candidate profiles", className: "min-w-40" },
              { label: "Actions", className: "min-w-32" },
            ]}
            emptyMessage="No categories"
            rows={categoryRows.map((category) => ({
              id: category.id,
              cells: [
                <EditCategoryForm
                  id={category.id}
                  key="name"
                  name={category.name}
                />,
                category.assignedProfiles,
                <DeleteCategoryForm
                  id={category.id}
                  key="delete"
                  name={category.name}
                />,
              ],
            }))}
          />
        </section>
      </div>
    </main>
    </WorkspaceShell>
  );
}
