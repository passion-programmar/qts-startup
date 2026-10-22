import "server-only";

import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";

export async function managerCanManageTextHighlights(managerId: string): Promise<boolean> {
  const [manager] = await db
    .select({ allowed: users.canManageTextHighlights })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);
  return manager?.allowed === true;
}

export function readTextHighlightRule(value: unknown): {
  text: string;
  textColor: string;
  backgroundColor: string;
} | null {
  if (!isRecord(value)) return null;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const textColor = typeof value.textColor === "string"
    ? value.textColor.trim().toLowerCase()
    : "";
  const backgroundColor = typeof value.backgroundColor === "string"
    ? value.backgroundColor.trim().toLowerCase()
    : "";
  if (
    !text ||
    text.length > 500 ||
    !/^#[0-9a-f]{6}$/.test(textColor) ||
    !/^#[0-9a-f]{6}$/.test(backgroundColor)
  ) {
    return null;
  }
  return { text, textColor, backgroundColor };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "unknown";
}
