import "server-only";

import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { normalizePageDetectionKeyword } from "@/server/page-exclusion-values";

export async function managerCanManagePageExclusions(managerId: string): Promise<boolean> {
  const [manager] = await db
    .select({ allowed: users.canManagePageExclusions })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);
  return manager?.allowed === true;
}

export { normalizePageDetectionKeyword as readPageDetectionKeyword };
