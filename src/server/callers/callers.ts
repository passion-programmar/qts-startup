import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { callers, users } from "@/db/schema";
import { db } from "@/lib/db";

// Callers: the people who take interview calls, kept by each Admin for the Managers under them.

export type CallerOption = { id: string; name: string; label: string | null };

/** The Admin's callers, active first by name, then removed ones. */
export function readAdminCallers(adminId: string) {
  return db.select({ id: callers.id, name: callers.name, label: callers.label, archivedAt: callers.archivedAt })
    .from(callers)
    .where(eq(callers.adminId, adminId))
    .orderBy(sql`${callers.archivedAt} is not null`, asc(sql`lower(${callers.name})`));
}

// The Manager's Admin (users.parent_user_id), as a subquery.
const adminOf = (managerId: string) => sql`(select ${users.parentUserId} from ${users} where ${users.id} = ${managerId})`;

/** The active callers of the Manager's Admin, for the Interview window. */
export async function readCallerOptions(managerId: string): Promise<CallerOption[]> {
  return db.select({ id: callers.id, name: callers.name, label: callers.label })
    .from(callers)
    .where(and(sql`${callers.adminId} = ${adminOf(managerId)}`, isNull(callers.archivedAt)))
    .orderBy(asc(sql`lower(${callers.name})`));
}

/** Whether the caller belongs to the Manager's Admin (and is active, unless removed ones are allowed). */
export async function isManagersCaller(managerId: string, callerId: string, allowRemoved: boolean): Promise<boolean> {
  const [row] = await db.select({ id: callers.id }).from(callers)
    .where(and(
      eq(callers.id, callerId),
      sql`${callers.adminId} = ${adminOf(managerId)}`,
      allowRemoved ? undefined : isNull(callers.archivedAt),
    ))
    .limit(1);
  return Boolean(row);
}
