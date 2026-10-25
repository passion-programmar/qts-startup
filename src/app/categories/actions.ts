"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { categories } from "@/db/schema";
import { db, neonSql } from "@/lib/db";
import { requireUser } from "@/lib/session";

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

  const [created] = await db
    .insert(categories)
    .values({ name })
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

  try {
    const [updated] = await db.update(categories)
      .set({ name, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!updated) return failure("That category no longer exists. Refresh and try again.");
  } catch (error) {
    if (isUniqueViolation(error)) return failure("A category with that name already exists.");
    throw error;
  }

  revalidateCategoryPages();
  return success("Category updated.");
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
      set category_id = (select id from categories where is_default), updated_at = now()
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
