import type { Metadata } from "next";
import {
  ShieldCheck,
  Users,
} from "lucide-react";
import { inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { categories, educations, experiences } from "@/db/schema";
import {
  CopyableAccountField,
  CopyLinkedInUrl,
  CreateUserForm,
  CredentialResetForm,
  DeleteCandidateAccountForm,
  DeleteStaffUserForm,
  EditCandidateProfileForm,
} from "@/app/users/user-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import {
  isPdfTemplate,
} from "@/server/pdf/pdf-templates";

export const instant = false;

export const metadata: Metadata = {
  title: "Users | QTS",
};

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  account: "Candidate Account",
};

type UserRow = {
  id: string;
  role: string;
  parent_user_id: string | null;
  display_name: string | null;
  login_name: string | null;
  blocked_at: Date | string | null;
  created_at: Date | string;
  first_name: string | null;
  last_name: string | null;
  birthday: string | null;
  pdf_template: string | null;
  candidate_email: string | null;
  phone: string | null;
  headline: string | null;
  linkedin_url: string | null;
  country: string | null;
  city: string | null;
  province: string | null;
  address_line_1: string | null;
  postal_code: string | null;
  jd_matching: string | null;
  category_id: string | null;
  category_name: string | null;
};

function userName(user: UserRow): string {
  if (user.role !== "account") return user.display_name ?? "Staff user";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    "Incomplete candidate profile"
  );
}

export default async function UsersPage() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");

  const includeBlocked = actor.role === "super_admin";
  const result = await db.execute<UserRow>(sql`
    with recursive visible_users as (
      select
        id, role, parent_user_id, display_name, login_name, blocked_at, created_at
      from users
      where id = ${actor.id}

      union all

      select
        child.id, child.role, child.parent_user_id, child.display_name,
        child.login_name, child.blocked_at, child.created_at
      from users as child
      inner join visible_users as parent on child.parent_user_id = parent.id
      where ${includeBlocked} or child.blocked_at is null
    )
    select
      visible_users.id,
      visible_users.role,
      visible_users.parent_user_id,
      visible_users.display_name,
      visible_users.login_name,
      visible_users.blocked_at,
      visible_users.created_at,
      profiles.first_name,
      profiles.last_name,
      profiles.birthday,
      profiles.pdf_template,
      profiles.candidate_email,
      profiles.phone,
      profiles.headline,
      profiles.linkedin_url,
      profiles.country,
      profiles.city,
      profiles.province,
      profiles.address_line_1,
      profiles.postal_code,
      profiles.jd_matching,
      profiles.category_id,
      categories.name as category_name
    from visible_users
    left join profiles on profiles.user_id = visible_users.id
    left join categories on categories.id = profiles.category_id
    order by
      profiles.first_name nulls last,
      profiles.last_name nulls last,
      visible_users.display_name nulls last,
      visible_users.login_name nulls last,
      visible_users.id
  `);
  const usersById = new Map(result.rows.map((user) => [user.id, user]));
  const directReportsByUserId = new Map<string, UserRow[]>();
  const peersByParentAndRole = new Map<string, UserRow[]>();
  for (const user of result.rows) {
    if (user.parent_user_id) {
      const reports = directReportsByUserId.get(user.parent_user_id) ?? [];
      reports.push(user);
      directReportsByUserId.set(user.parent_user_id, reports);
    }

    const peerKey = `${user.parent_user_id ?? "root"}:${user.role}`;
    const peers = peersByParentAndRole.get(peerKey) ?? [];
    peers.push(user);
    peersByParentAndRole.set(peerKey, peers);
  }

  const createRole =
    actor.role === "super_admin"
      ? "admin"
      : actor.role === "admin"
        ? "manager"
        : "account";

  const categoryOptions = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(categories.name);

  const candidateIds = result.rows
    .filter((user) => user.role === "account")
    .map((user) => user.id);
  const [educationHistory, experienceHistory] = candidateIds.length
    ? await Promise.all([
        db
          .select()
          .from(educations)
          .where(inArray(educations.profileUserId, candidateIds))
          .orderBy(educations.profileUserId, educations.sortOrder),
        db
          .select()
          .from(experiences)
          .where(inArray(experiences.profileUserId, candidateIds))
          .orderBy(experiences.profileUserId, experiences.sortOrder),
      ])
    : [[], []];
  const educationByCandidate = new Map<string, typeof educationHistory>();
  for (const entry of educationHistory) {
    const rows = educationByCandidate.get(entry.profileUserId) ?? [];
    rows.push(entry);
    educationByCandidate.set(entry.profileUserId, rows);
  }
  const experienceByCandidate = new Map<string, typeof experienceHistory>();
  for (const entry of experienceHistory) {
    const rows = experienceByCandidate.get(entry.profileUserId) ?? [];
    rows.push(entry);
    experienceByCandidate.set(entry.profileUserId, rows);
  }

  const visibleCount = result.rows.length;
  const staffCount = result.rows.filter((user) => user.role !== "account").length;
  const candidateCount = visibleCount - staffCount;

  return (
    <WorkspaceShell activeHref="/users" user={actor}>
    <main className="py-1">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {actor.role === "manager"
                ? "Candidate Accounts"
                : "Users & hierarchy"}
            </h1>
          </div>
        </div>
        <section aria-label="Visible user totals" className="mb-5 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Visible users", value: visibleCount, icon: Users },
            { label: "Staff accounts", value: staffCount, icon: ShieldCheck },
            { label: "Candidate Accounts", value: candidateCount, icon: Users },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <article
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                key={item.label}
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-xl font-semibold text-slate-900">
                    {item.value}
                  </p>
                  <p className="text-[11px] text-slate-500">{item.label}</p>
                </div>
              </article>
            );
          })}
        </section>

        <div className="mt-5 space-y-5">
          <section>
            <CreateUserForm categories={categoryOptions} role={createRole} />
          </section>
          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">
                {actor.role === "manager" ? "Candidate accounts" : "People"}
              </h2>
            </div>
            {actor.role === "manager" ? (
              <PaginatedTable
                columns={[
                  { label: "No", className: "w-16 text-center" },
                  { label: "Full name", className: "min-w-40" },
                  { label: "Category", className: "min-w-28" },
                  { label: "Contact", className: "min-w-40" },
                  { label: "Street address", className: "min-w-44" },
                  { label: "Postal code", className: "min-w-28" },
                  { label: "LinkedIn", className: "w-24" },
                  { label: "Edit", className: "w-24 text-center" },
                  { label: "Delete", className: "w-24 text-center" },
                ]}
                emptyMessage="No candidate accounts"
                rows={result.rows
                  .filter((candidate) => candidate.role === "account")
                  .map((candidate, index) => ({
                    id: candidate.id,
                    cells: [
                      <CopyableAccountField
                        ariaLabel={`Copy row number ${index + 1}`}
                        className="text-center"
                        key="number"
                        value={String(index + 1)}
                      >
                        {index + 1}
                      </CopyableAccountField>,
                      <CopyableAccountField
                        ariaLabel={`Copy full name for ${userName(candidate)}`}
                        className="font-semibold"
                        key="candidate"
                        value={userName(candidate)}
                      >
                        {userName(candidate)}
                      </CopyableAccountField>,
                      <CopyableAccountField
                        ariaLabel={`Copy category for ${userName(candidate)}`}
                        key="category"
                        value={candidate.category_name ?? "Uncategorized"}
                      >
                        {candidate.category_name ?? "Uncategorized"}
                      </CopyableAccountField>,
                      <CopyableAccountField
                        ariaLabel={`Copy contact for ${userName(candidate)}`}
                        key="contact"
                        value={[candidate.candidate_email, candidate.phone]
                          .filter(Boolean)
                          .join("\n") || "—"}
                      >
                        <div>{candidate.candidate_email ?? "—"}</div>
                        <div className="mt-1 text-slate-500">
                          {candidate.phone ?? "—"}
                        </div>
                      </CopyableAccountField>,
                      <CopyableAccountField
                        ariaLabel={`Copy street address for ${userName(candidate)}`}
                        key="street-address"
                        value={candidate.address_line_1 || "—"}
                      >
                        {candidate.address_line_1 || "—"}
                      </CopyableAccountField>,
                      <CopyableAccountField
                        ariaLabel={`Copy postal code for ${userName(candidate)}`}
                        key="postal-code"
                        value={candidate.postal_code || "—"}
                      >
                        {candidate.postal_code || "—"}
                      </CopyableAccountField>,
                      candidate.linkedin_url ? (
                        <CopyLinkedInUrl
                          key="linkedin"
                          url={candidate.linkedin_url}
                        />
                      ) : (
                        "—"
                      ),
                      <EditCandidateProfileForm
                        candidate={{
                          userId: candidate.id,
                          firstName: candidate.first_name,
                          lastName: candidate.last_name,
                          birthday: candidate.birthday,
                          pdfTemplate: candidate.pdf_template
                            && isPdfTemplate(candidate.pdf_template)
                            ? candidate.pdf_template
                            : "heritage",
                          candidateEmail: candidate.candidate_email,
                          phone: candidate.phone,
                          headline: candidate.headline,
                          linkedinUrl: candidate.linkedin_url,
                          country: candidate.country,
                          city: candidate.city,
                          province: candidate.province,
                          addressLine1: candidate.address_line_1,
                          postalCode: candidate.postal_code,
                          jdMatching: candidate.jd_matching,
                          categoryId: candidate.category_id,
                          education: (educationByCandidate.get(candidate.id) ?? []).map(
                            (entry) => ({
                              institution: entry.institution,
                              degree: entry.degree,
                              fieldOfStudy: entry.fieldOfStudy,
                              startDate: entry.startDate?.slice(0, 7) ?? null,
                              endDate: entry.endDate?.slice(0, 7) ?? null,
                              isCurrent: entry.isCurrent,
                              description: entry.description,
                            }),
                          ),
                          experience: (experienceByCandidate.get(candidate.id) ?? []).map(
                            (entry) => ({
                              companyName: entry.companyName,
                              jobTitle: entry.jobTitle,
                              location: entry.location,
                              startDate: entry.startDate?.slice(0, 7) ?? null,
                              endDate: entry.endDate?.slice(0, 7) ?? null,
                              isCurrent: entry.isCurrent,
                              description: entry.description,
                            }),
                          ),
                        }}
                        categories={categoryOptions}
                        key="edit"
                      />,
                      <DeleteCandidateAccountForm
                        candidateName={userName(candidate)}
                        key="delete"
                        userId={candidate.id}
                      />,
                    ],
                  }))}
              />
            ) : (
              <PaginatedTable
                columns={[
                  { label: "Name", className: "min-w-44" },
                  { label: "Reports to", className: "min-w-36" },
                  { label: "Role", className: "min-w-28" },
                  { label: "Direct reports", className: "min-w-28" },
                  { label: "Status", className: "min-w-24" },
                  { label: "Actions", className: "min-w-64" },
                ]}
                emptyMessage="No people found"
                rows={result.rows.map((person) => {
                  const directReports =
                    directReportsByUserId.get(person.id) ?? [];
                  const parent = person.parent_user_id
                    ? usersById.get(person.parent_user_id)
                    : undefined;
                  const peerKey = `${person.parent_user_id ?? "root"}:${person.role}`;
                  const replacementUsers = (
                    peersByParentAndRole.get(peerKey) ?? []
                  )
                    .filter(
                      (candidate) =>
                        candidate.id !== person.id &&
                        candidate.role === person.role &&
                        candidate.parent_user_id === person.parent_user_id &&
                        !candidate.blocked_at,
                    )
                    .map((candidate) => ({
                      id: candidate.id,
                      name: `${userName(candidate)} (@${candidate.login_name ?? "no username"})`,
                    }));
                  return {
                    id: person.id,
                    cells: [
                      <div key="person">
                        <div className="font-semibold">{userName(person)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {person.role === "account"
                            ? person.candidate_email || "—"
                            : `@${person.login_name}`}
                        </div>
                      </div>,
                      parent ? userName(parent) : "—",
                      roleLabels[person.role] ?? person.role,
                      directReports.length,
                      person.blocked_at ? (
                        <span className="rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                          Blocked
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      ),
                      actor.role === "super_admin" &&
                      person.role !== "account" &&
                      person.login_name ? (
                        <div className="flex flex-wrap items-center gap-2" key="actions">
                          <CredentialResetForm
                            loginName={person.login_name}
                            userId={person.id}
                          />
                          {(person.role === "admin" ||
                            person.role === "manager") && (
                            <DeleteStaffUserForm
                              reportsCount={directReports.length}
                              replacementUsers={replacementUsers}
                              userId={person.id}
                            />
                          )}
                        </div>
                      ) : (
                        "—"
                      ),
                    ],
                  };
                })}
              />
            )}
          </section>
        </div>
      </div>
    </main>
    </WorkspaceShell>
  );
}
