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
    <main className="px-4 py-7 text-slate-900 sm:px-7 sm:py-9">
      <div className="mx-auto max-w-4xl">
        <header className="mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Candidate categories
            </h1>
          </div>
        </header>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-800">
            Add category
          </h2>
          <CreateCategoryForm />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Tags className="size-4 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">
              Categories ({categoryRows.length})
            </h2>
          </div>
          {categoryRows.length ? (
            <ul className="divide-y divide-slate-100">
              {categoryRows.map((category) => (
                <li
                  className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={category.id}
                >
                  <div>
                    <EditCategoryForm
                      id={category.id}
                      name={category.name}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      {category.assignedProfiles} profiles
                    </p>
                  </div>
                  <DeleteCategoryForm
                    id={category.id}
                    name={category.name}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              No categories yet
            </p>
          )}
        </section>
      </div>
    </main>
    </WorkspaceShell>
  );
}
