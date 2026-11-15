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
import { Badge } from "@/app/ui/badge";
import { Card, CardHeader } from "@/app/ui/card";
import { PageHeader } from "@/app/ui/page-header";
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
      isDefault: categories.isDefault,
      assignedProfiles: count(profiles.userId),
    })
    .from(categories)
    .leftJoin(profiles, eq(profiles.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));

  return (
      <main className="space-y-6 py-1 text-fg">
        <PageHeader
          description="Group candidates by category. Every candidate has one; the default category catches the rest."
          title="Candidate categories"
        />

        <Card>
          <CardHeader className="mb-4" title="Add category" />
          <CreateCategoryForm />
        </Card>

        <section>
          <CardHeader actions={<Badge tone="primary">{categoryRows.length} total</Badge>} className="mb-3" icon={<Tags />} title="Categories" />
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
                <div className="space-y-1" key="category">
                  <EditCategoryForm id={category.id} name={category.name} />
                  {category.isDefault && (
                    <Badge tone="primary">Default · new candidates start here</Badge>
                  )}
                </div>,
                category.assignedProfiles,
                category.isDefault
                  ? <span className="text-xs text-fg-faint" key="delete">Cannot be deleted</span>
                  : <DeleteCategoryForm id={category.id} key="delete" name={category.name} />,
              ],
            }))}
          />
        </section>
      </main>
  );
}
