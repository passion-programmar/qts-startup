"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { categories } from "@/db/schema";
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
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can manage categories." };
  }

  const name = readCategoryName(formData);
  if (!name) {
    return { ...emptyState, error: "Enter a category name up to 120 characters." };
  }

  try {
    await db.insert(categories).values({ name });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ...emptyState, error: "A category with that name already exists." };
    }
    throw error;
  }

  revalidateCategoryPages();
  return { ...emptyState, success: "Category added." };
}

export async function updateCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can manage categories." };
  }

  const id = String(formData.get("categoryId") || "").trim();
  const name = readCategoryName(formData);
  if (!isUuid(id) || !name) {
    return { ...emptyState, error: "Enter a valid category name." };
  }

  try {
    const [updated] = await db
      .update(categories)
      .set({ name, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!updated) {
      return { ...emptyState, error: "That category no longer exists. Refresh and try again." };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ...emptyState, error: "A category with that name already exists." };
    }
    throw error;
  }

  revalidateCategoryPages();
  return { ...emptyState, success: "Category updated." };
}

export async function deleteCategoryAction(
  _previousState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const actor = await requireUser();
  if (actor.role !== "super_admin") {
    return { ...emptyState, error: "Only Super Admin can manage categories." };
  }

  const id = String(formData.get("categoryId") || "").trim();
  if (!isUuid(id)) {
    return { ...emptyState, error: "Select a valid category." };
  }

  const [deleted] = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!deleted) {
    return { ...emptyState, error: "That category no longer exists. Refresh and try again." };
  }

  revalidateCategoryPages();
  return { ...emptyState, success: "Category deleted. Assigned profiles are now uncategorized." };
}

function readCategoryName(formData: FormData): string {
  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= 120 ? name : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "23505";
}

function revalidateCategoryPages(): void {
  revalidatePath("/categories");
  revalidatePath("/users");
  revalidatePath("/");
}
