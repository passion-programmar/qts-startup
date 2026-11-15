"use server";

import { eq } from "drizzle-orm";
import { geminiApiCallLogs } from "@/db/schema";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One stored Google reply (up to 1 MB), for its View details window. The responses list leaves the
 * replies out, so a page of 100 calls does not carry up to 100 MB to the browser.
 */
export async function loadGeminiResponseBodyAction(callId: string): Promise<{ responseBody: string | null } | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin" || typeof callId !== "string" || !uuidPattern.test(callId)) return null;
  const [row] = await db.select({ responseBody: geminiApiCallLogs.responseBody })
    .from(geminiApiCallLogs).where(eq(geminiApiCallLogs.id, callId)).limit(1);
  return row ? { responseBody: row.responseBody } : null;
}
