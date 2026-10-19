import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Tags } from "lucide-react";
import {
  CreateCategoryForm,
  DeleteCategoryForm,
  EditCategoryForm,
} from "@/app/categories/category-forms";
import { categories, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

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
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">
              Super Admin workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Candidate categories
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Add and maintain the categories Managers can assign to candidate
              profiles. Only Super Admin can manage this list.
            </p>
          </div>
          <Link
            className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            href="/"
          >
            Back to dashboard
          </Link>
        </header>

        <section className="mb-5 rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">
            Add category
          </h2>
          <CreateCategoryForm />
        </section>

        <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Tags className="size-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-800">
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
                    <p className="mt-2 text-[11px] text-slate-500">
                      Assigned to {category.assignedProfiles} candidate
                      {category.assignedProfiles === 1 ? "" : "s"}.
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
            <p className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">
              No categories yet. Add one above to make it available when creating
              candidate profiles.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
