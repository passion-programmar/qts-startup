import "server-only";

import { and, eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";

export type GetJdMatchingMode = "manual" | "gemini";

// Gemini matching is assigned per Manager by a Super Admin; everyone else uses general Get JD.
export async function getGetJdMatchingMode(managerId: string): Promise<GetJdMatchingMode> {
  const [row] = await db
    .select({ useGeminiMatching: users.useGeminiMatching })
    .from(users)
    .where(and(eq(users.id, managerId), eq(users.role, "manager")))
    .limit(1);
  return row?.useGeminiMatching ? "gemini" : "manual";
}
