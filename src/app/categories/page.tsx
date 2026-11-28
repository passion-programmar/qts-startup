import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  CategoryDialogButton,
  CategoryDot,
  DeleteCategoryForm,
} from "@/app/categories/category-forms";
import { categories, profiles } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Badge } from "@/app/ui/badge";
import { PageHeader } from "@/app/ui/page-header";

export const instant = false;

export const metadata: Metadata = {
  title: "Categories | QTS",
};

// Super Admin's candidate categories (2026-11-28 layout): one line each (colour, name, candidates,
// edit, delete); Add and Edit open the same window.
export default async function CategoriesPage() {
  const actor = await requireUser();
  if (actor.role !== "super_admin") redirect("/");

  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      isDefault: categories.isDefault,
      color: categories.color,
      assignedProfiles: count(profiles.userId),
    })
    .from(categories)
    .leftJoin(profiles, eq(profiles.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));

  return (
    <main className="space-y-4 py-1 text-fg">
      <PageHeader actions={<CategoryDialogButton mode="add" />} title="Candidate categories" />

      <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          <span>Category</span>
          <span>{categoryRows.length} {categoryRows.length === 1 ? "category" : "categories"}</span>
        </div>
        {categoryRows.length ? (
          <ul className="divide-y divide-line">
            {categoryRows.map((category) => (
              <li className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-subtle" key={category.id}>
                <CategoryDot color={category.color} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-fg">{category.name}</span>
                  {category.isDefault ? <Badge tone="primary">Default</Badge> : null}
                </div>
                <span className="shrink-0 text-sm tabular-nums text-fg-muted">
                  {category.assignedProfiles} {category.assignedProfiles === 1 ? "candidate" : "candidates"}
                </span>
                <div className="flex w-[4.5rem] shrink-0 items-center justify-end gap-1">
                  <CategoryDialogButton
                    color={category.color}
                    id={category.id}
                    mode="edit"
                    name={category.name}
                    profiles={category.assignedProfiles}
                  />
                  {category.isDefault ? (
                    <span className="size-8" title="The default category cannot be deleted; candidates fall back to it." />
                  ) : (
                    <DeleteCategoryForm id={category.id} name={category.name} profiles={category.assignedProfiles} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-12 text-center text-sm text-fg-muted">No categories yet</p>
        )}
      </section>
    </main>
  );
}
