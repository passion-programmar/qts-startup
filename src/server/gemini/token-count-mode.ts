import "server-only";

import { eq } from "drizzle-orm";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";

export type GeminiTokenCountMode = "local" | "gemini";

export async function getGeminiTokenCountMode(): Promise<GeminiTokenCountMode> {
  const [row] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, "gemini_token_count_mode")).limit(1);
  return row?.value === "gemini" ? "gemini" : "local";
}
