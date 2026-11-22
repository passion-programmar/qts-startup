"use server";

import { requireUser } from "@/lib/session";
import { canViewRemoteCompanies, readRemoteCompanyApplications } from "@/server/remote-companies/remote-companies";

export type CompanyApplication = {
  titleKey: string;
  candidate: string | null;
  manager: string | null;
  own: boolean;
  appliedAt: string;
  place: string | null;
};

export type CompanyApplicationsResult =
  | { ok: true; applications: CompanyApplication[] }
  | { ok: false; error: string };

// Who applied to one company's remote roles, read when its details window opens.
export async function readCompanyApplicationsAction(companyKey: unknown): Promise<CompanyApplicationsResult> {
  const user = await requireUser();
  if (!(await canViewRemoteCompanies(user))) return { ok: false, error: "The Remote companies page is not turned on for you." };
  if (typeof companyKey !== "string" || !companyKey.trim() || companyKey.length > 300) return { ok: false, error: "That company was not found." };
  try {
    const applications = await readRemoteCompanyApplications(user, companyKey);
    return { ok: true, applications: applications.map((row) => ({ ...row, appliedAt: row.appliedAt.toISOString() })) };
  } catch (error) {
    console.error("Reading who applied to a remote company failed.", error instanceof Error ? error.message : error);
    return { ok: false, error: "Who applied could not be loaded. Try again." };
  }
}
