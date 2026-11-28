"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { categories } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { isManagerCategoryColor } from "@/server/users/manager-category-color";

export type CategoryActionState = {
  error: string | null;
  success: string | null;
};

const emptyState: CategoryActionState = { error: null, success: null };

export async function createCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return denied();

  const name = readName(formData);
  if (!name) return failure("Enter a category name up to 120 characters.");
  const color = readColor(formData);
  if (color === null) return failure("Select a valid colour.");

  const [created] = await db
    .insert(categories)
    .values({ name, color: color || null })
    .onConflictDoNothing()
    .returning({ id: categories.id });
  if (!created) return failure("A category with that name already exists.");

  revalidateCategoryPages();
  return success("Category added.");
}

export async function updateCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return denied();

  const id = readId(formData, "categoryId");
  const name = readName(formData);
  if (!id || !name) return failure("Enter a valid category name.");
  const color = readColor(formData);
  if (color === null) return failure("Select a valid colour.");

  let reset = 0;
  try {
    // A new colour (not "no colour") resets the label colour of every candidate in the category
    // (user, 2026-11-28); Managers may change single candidates again afterwards.
    const result = await db.execute<{ updated: number; reset: number }>(sql`
      with previous as (select color from categories where id = ${id}::uuid),
      updated as (
        update categories set name = ${name}, color = ${color || null}, updated_at = now()
        where id = ${id}::uuid
        returning id
      ),
      reset as (
        update profiles set manager_category_color = ${color || null}, updated_at = now()
        where category_id = ${id}::uuid
          and ${color || null}::text is not null
          and (select color from previous) is distinct from ${color || null}::text
        returning user_id
      )
      select (select count(*) from updated)::int as updated, (select count(*) from reset)::int as reset
    `);
    if (!result.rows[0]?.updated) return failure("That category no longer exists. Refresh and try again.");
    reset = result.rows[0].reset;
  } catch (error) {
    if (isUniqueViolation(error)) return failure("A category with that name already exists.");
    throw error;
  }

  revalidateCategoryPages();
  return success(reset ? `Category updated. ${reset} ${reset === 1 ? "candidate" : "candidates"} now use its colour.` : "Category updated.");
}

export async function deleteCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return denied();

  const id = readId(formData, "categoryId");
  if (!id) return failure("Select a valid category.");

  const [category] = await db.select({ isDefault: categories.isDefault })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (!category) return failure("That category no longer exists. Refresh and try again.");
  if (category.isDefault) return failure("The default category cannot be deleted; candidates fall back to it.");

  // Candidates move to the default category first, so every account keeps a category.
  const results = await neonSql.transaction((tx) => [
    tx`
      update profiles
      set category_id = (select id from categories where is_default),
        manager_category_color = coalesce((select color from categories where is_default), manager_category_color),
        updated_at = now()
      where category_id = ${id}::uuid
    `,
    tx`delete from categories where id = ${id}::uuid and not is_default returning id`,
  ]);
  if (!results[1]?.length) return failure("That category no longer exists. Refresh and try again.");

  revalidateCategoryPages();
  return success("Category deleted. Its candidates moved to the default category.");
}

function readName(formData: FormData): string {
  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 120 ? name : "";
}

/** The chosen colour, "" for no colour, or null when it is not one of the offered colours. */
function readColor(formData: FormData): string | null {
  const color = String(formData.get("color") || "").trim();
  return isManagerCategoryColor(color) ? color : null;
}

function readId(formData: FormData, field: string): string {
  const id = String(formData.get(field) || "").trim();
  return isUuid(id) ? id : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUniqueViolation(error: unknown): boolean {
  return hasErrorCode(error, "23505");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === code;
}

function denied(): CategoryActionState {
  return failure("Only Super Admin can manage categories.");
}

function failure(error: string): CategoryActionState {
  return { ...emptyState, error };
}

function success(message: string): CategoryActionState {
  return { ...emptyState, success: message };
}

function revalidateCategoryPages(): void {
  revalidatePath("/categories");
  revalidatePath("/users");
  revalidatePath("/settings");
  revalidatePath("/");
}
