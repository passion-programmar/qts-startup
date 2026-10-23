import "server-only";

import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";

export type GetJdMatchingMode = "manual" | "gemini";

export async function getGetJdMatchingMode(): Promise<GetJdMatchingMode> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "get_jd_matching_mode"))
    .limit(1);
  return row?.value === "gemini" ? "gemini" : "manual";
}
