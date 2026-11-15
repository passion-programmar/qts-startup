"use server";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { callers } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import type { RecordActionState } from "@/app/record-action-state";

// An Admin's callers: added, renamed or relabelled, removed (kept on old interviews, not offered for
// new ones) and restored. Only the Admin who owns a caller can change it.

function text(data: FormData, name: string, max: number): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}
function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && /callers_admin_name_active_unique/.test(`${error.message} ${String(error.cause ?? "")}`);
}
function refresh() {
  revalidatePath("/callers");
  revalidatePath("/interviews");
}

async function requireAdmin() {
  const user = await requireUser();
  return user.role === "admin" ? user : null;
}

/** Adds a caller (no id) or saves a caller's name and label (with id). */
export async function saveCallerAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Admin access is required.", success: null };
  const id = text(formData, "id", 36);
  const name = text(formData, "name", 120);
  const label = text(formData, "label", 60);
  if (!name) return { error: "Enter the caller's name.", success: null };
  try {
    if (id) {
      if (!uuid(id)) return { error: "Caller was not found.", success: null };
      const updated = await db.update(callers).set({ name, label: label || null, updatedAt: new Date() })
        .where(and(eq(callers.id, id), eq(callers.adminId, admin.id)))
        .returning({ id: callers.id });
      if (!updated.length) return { error: "Caller was not found.", success: null };
    } else {
      await db.insert(callers).values({ adminId: admin.id, name, label: label || null });
    }
  } catch (error) {
    if (isDuplicateName(error)) return { error: `You already have a caller named “${name}”.`, success: null };
    throw error;
  }
  refresh();
  return { error: null, success: id ? "Caller saved." : "Caller added." };
}

/** Removes a caller (it stays on the interviews it took) or restores a removed one. */
export async function setCallerRemovedAction(_state: RecordActionState, formData: FormData): Promise<RecordActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Admin access is required.", success: null };
  const id = text(formData, "id", 36);
  const remove = text(formData, "intent", 10) === "remove";
  if (!uuid(id)) return { error: "Caller was not found.", success: null };
  try {
    const updated = await db.update(callers)
      .set({ archivedAt: remove ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(callers.id, id), eq(callers.adminId, admin.id), remove ? isNull(callers.archivedAt) : isNotNull(callers.archivedAt)))
      .returning({ id: callers.id });
    if (!updated.length) return { error: "Caller was not found.", success: null };
  } catch (error) {
    if (isDuplicateName(error)) return { error: "An active caller already has this name. Rename one of them first.", success: null };
    throw error;
  }
  refresh();
  return { error: null, success: remove ? "Caller removed." : "Caller restored." };
}
