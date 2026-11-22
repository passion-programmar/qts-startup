import "server-only";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { db } from "@/lib/db";
import type { StaffSession } from "@/lib/session";
import {
  remoteCompaniesPageQuery,
  remoteCompanyApplicationsQuery,
  toRemoteCompanies,
  type RemoteApplication,
  type RemoteCompaniesQuery,
  type RemoteCompaniesRow,
} from "@/server/remote-companies/remote-companies-query";

/**
 * Who sees the Remote companies page: the Super Admin always, a Manager only when the Super Admin
 * turned it on for them (Settings › Managers). Admins never.
 */
export async function canViewRemoteCompanies(user: Pick<StaffSession, "id" | "role">): Promise<boolean> {
  if (user.role === "super_admin") return true;
  if (user.role !== "manager") return false;
  const [row] = await db.select({ on: users.canViewRemoteCompanies }).from(users).where(eq(users.id, user.id)).limit(1);
  return row?.on === true;
}

/**
 * Who applied to one company's remote roles (one trip, when its details open). A Manager sees their
 * own candidates' names only; the Super Admin sees every candidate and their Manager.
 */
export async function readRemoteCompanyApplications(viewer: Pick<StaffSession, "id" | "role">, companyKey: string): Promise<RemoteApplication[]> {
  type Row = Omit<RemoteApplication, "appliedAt"> & { appliedAt: Date | string };
  const result = await db.execute<Row>(remoteCompanyApplicationsQuery(companyKey, { id: viewer.id, superAdmin: viewer.role === "super_admin" }));
  return result.rows.map((row) => ({ ...row, own: row.own === true, appliedAt: new Date(row.appliedAt) }));
}

/** One page of companies (one trip); a page past the end (an old link) shows the last page instead. */
export async function readRemoteCompaniesPage(query: RemoteCompaniesQuery) {
  const read = async (page: number) => toRemoteCompanies((await db.execute<RemoteCompaniesRow>(remoteCompaniesPageQuery(query, page))).rows[0]);
  const result = await read(query.page);
  const lastPage = Math.max(1, Math.ceil(result.total / query.size));
  if (query.page > lastPage) return { ...(await read(lastPage)), page: lastPage };
  return { ...result, page: query.page };
}
