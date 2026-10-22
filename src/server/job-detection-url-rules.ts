import "server-only";

import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";

export async function managerCanManageJobDetectionUrlRules(managerId: string): Promise<boolean> {
  const [manager] = await db
    .select({ allowed: users.canManageJobDetectionUrlRules })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);
  return manager?.allowed === true;
}

export function isUniqueJobDetectionUrlRuleViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "23505";
}

export { normalizeJobDetectionUrlRule } from "@/server/job-detection-url-rule-values";
