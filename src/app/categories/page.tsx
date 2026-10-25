import type { Metadata } from "next";
import { asc, count, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Tags } from "lucide-react";
import {
  CreateCategoryForm,
  CreateSubCategoryForm,
  DeleteCategoryForm,
  DeleteSubCategoryForm,
  EditCategoryForm,
  EditSubCategoryForm,
} from "@/app/categories/category-forms";
import { categories, profiles, subCategories } from "@/db/schema";
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
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.name));
  const subCategoryRows = await db
    .select({
      id: subCategories.id,
      categoryId: subCategories.categoryId,
      categoryName: categories.name,
      name: subCategories.name,
      assignedProfiles: count(profiles.userId),
    })
    .from(subCategories)
    .innerJoin(categories, eq(categories.id, subCategories.categoryId))
    .leftJoin(profiles, eq(profiles.subCategoryId, subCategories.id))
    .groupBy(subCategories.id, categories.id)
    .orderBy(asc(categories.name), asc(subCategories.name));
  const categoryCounts = new Map<string, number>();
  for (const subCategory of subCategoryRows) {
    categoryCounts.set(subCategory.categoryId, (categoryCounts.get(subCategory.categoryId) ?? 0) + 1);
  }
  const rows = [
    ...categoryRows.flatMap((category) => [
      {
        id: `category-${category.id}`,
        cells: [
          <EditCategoryForm id={category.id} key="category" name={category.name} />,
          <span className="font-semibold text-slate-700" key="kind">Category</span>,
          `${categoryCounts.get(category.id) ?? 0} subcategories`,
          <DeleteCategoryForm id={category.id} key="delete" name={category.name} />,
        ],
      },
      ...subCategoryRows
        .filter((subCategory) => subCategory.categoryId === category.id)
        .map((subCategory) => ({
          id: subCategory.id,
          cells: [
            <span className="text-slate-500" key="parent">{category.name}</span>,
            <EditSubCategoryForm
              categories={categoryRows}
              categoryId={category.id}
              id={subCategory.id}
              key="name"
              name={subCategory.name}
            />,
            subCategory.assignedProfiles,
            <DeleteSubCategoryForm id={subCategory.id} key="delete" name={subCategory.name} />,
          ],
        })),
    ]),
  ];

  return (
    <WorkspaceShell activeHref="/categories" user={actor}>
      <main className="py-1 text-slate-900">
        <PageHeader
          description="Organize candidate subcategories under parent categories."
          eyebrow="Administration"
          title="Candidate categories"
        />

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-800">Add category</h2>
            <CreateCategoryForm />
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-base font-semibold text-slate-800">Add subcategory</h2>
            {categoryRows.length
              ? <CreateSubCategoryForm categories={categoryRows} />
              : <p className="text-sm text-slate-500">Create a category first.</p>}
          </section>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Tags className="size-4 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">Category hierarchy</h2>
          </div>
          <PaginatedTable
            columns={[
              { label: "Category", className: "w-[24%]" },
              { label: "Subcategory", className: "w-[42%]" },
              { label: "Candidate profiles", className: "w-[14%]" },
              { label: "Actions", className: "w-[20%]" },
            ]}
            emptyMessage="No categories"
            rows={rows}
          />
        </section>
      </main>
    </WorkspaceShell>
  );
}
