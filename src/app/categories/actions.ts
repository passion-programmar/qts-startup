"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { categories, subCategories } from "@/db/schema";
import { db } from "@/lib/db";
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

  try {
    const [deleted] = await db.delete(categories)
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!deleted) return failure("That category no longer exists. Refresh and try again.");
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return failure("Delete this category's subcategories before deleting the category.");
    }
    throw error;
  }

  revalidateCategoryPages();
  return success("Category deleted.");
}

export async function createSubCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return denied();

  const categoryId = readId(formData, "categoryId");
  const name = readName(formData);
  if (!categoryId || !name) return failure("Choose a category and enter a subcategory name.");

  let created: { id: string } | undefined;
  try {
    [created] = await db
      .insert(subCategories)
      .values({ categoryId, name })
      .onConflictDoNothing()
      .returning({ id: subCategories.id });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return failure("That category no longer exists. Refresh and try again.");
    }
    throw error;
  }
  if (!created) return failure("That subcategory already exists in this category.");

  revalidateCategoryPages();
  return success("Subcategory added.");
}

export async function updateSubCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return denied();

  const id = readId(formData, "subCategoryId");
  const categoryId = readId(formData, "categoryId");
  const name = readName(formData);
  if (!id || !categoryId || !name) return failure("Choose a category and enter a valid subcategory name.");

  try {
    const [updated] = await db.update(subCategories)
      .set({ categoryId, name, updatedAt: new Date() })
      .where(eq(subCategories.id, id))
      .returning({ id: subCategories.id });
    if (!updated) return failure("That subcategory no longer exists. Refresh and try again.");
  } catch (error) {
    if (isForeignKeyViolation(error)) return failure("That category no longer exists. Refresh and try again.");
    if (isUniqueViolation(error)) return failure("That subcategory already exists in this category.");
    throw error;
  }

  revalidateCategoryPages();
  return success("Subcategory updated.");
}

export async function deleteSubCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") return denied();

  const id = readId(formData, "subCategoryId");
  if (!id) return failure("Select a valid subcategory.");

  const [deleted] = await db.delete(subCategories)
    .where(eq(subCategories.id, id))
    .returning({ id: subCategories.id });
  if (!deleted) return failure("That subcategory no longer exists. Refresh and try again.");

  revalidateCategoryPages();
  return success("Subcategory deleted. Assigned candidates are now uncategorized.");
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

function isForeignKeyViolation(error: unknown): boolean {
  return hasErrorCode(error, "23503");
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
  revalidatePath("/");
}
