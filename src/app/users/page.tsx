import { labelTextColor } from "@/server/users/manager-category-color";
import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CopyableAccountField,
  CopyLinkedInUrl,
  AddCandidateLink,
  CreateUserForm,
  CredentialResetForm,
  DeleteCandidateAccountForm,
  DeleteStaffUserForm,
  EditCandidateLink,
  ToggleCandidateAccountStatusForm,
} from "@/app/users/user-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";

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
  deleted_at: Date | string | null;
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
  category_id: string | null;
  manager_category: string;
  manager_category_color: string | null;
  category_name: string | null;
  work_authorization: string | null;
  needs_sponsorship: boolean | null;
  notice_period: string | null;
  salary_expectation_amount: number | null;
  salary_expectation_currency: string | null;
  salary_expectation_period: string | null;
  years_of_experience: number | null;
  willing_to_relocate: boolean | null;
  github_url: string | null;
  portfolio_url: string | null;
  eeo_preference: string | null;
  nationality: string | null;
  work_countries: string | null;
  work_permit_expiry: string | null;
  languages: string | null;
  contract_type: string | null;
  work_hours: string | null;
  work_mode: string | null;
  application_notes: string | null;
  gender: string | null;
  ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;
  sexual_orientation: string | null;
  pronouns: string | null;
};

function userName(user: UserRow): string {
  if (user.role !== "account") return user.display_name ?? "Staff user";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    "Incomplete candidate profile"
  );
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const categoryParam = (await searchParams).category;
  const requestedCategory = typeof categoryParam === "string" ? categoryParam : "";

  const includeBlocked = actor.role === "super_admin";
  const result = await db.execute<UserRow>(sql`
    with recursive visible_users as (
      select
        id, role, parent_user_id, display_name, login_name, blocked_at, deleted_at, created_at
      from users
      where id = ${actor.id}

      union all

      select
        child.id, child.role, child.parent_user_id, child.display_name,
        child.login_name, child.blocked_at, child.deleted_at, child.created_at
      from users as child
      inner join visible_users as parent on child.parent_user_id = parent.id
      -- Inactive and deleted candidate accounts stay visible to their Manager.
      where ${includeBlocked} or child.blocked_at is null or child.role = 'account'
    )
    select
      visible_users.id,
      visible_users.role,
      visible_users.parent_user_id,
      visible_users.display_name,
      visible_users.login_name,
      visible_users.blocked_at,
      visible_users.deleted_at,
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
      profiles.category_id,
      profiles.manager_category,
      profiles.manager_category_color,
      profiles.work_authorization,
      profiles.needs_sponsorship,
      profiles.notice_period,
      profiles.salary_expectation_amount,
      profiles.salary_expectation_currency,
      profiles.salary_expectation_period,
      profiles.years_of_experience,
      profiles.willing_to_relocate,
      profiles.github_url,
      profiles.portfolio_url,
      profiles.eeo_preference,
      profiles.nationality,
      profiles.work_countries,
      to_char(profiles.work_permit_expiry, 'YYYY-MM-DD') as work_permit_expiry,
      profiles.languages,
      profiles.contract_type,
      profiles.work_hours,
      profiles.work_mode,
      profiles.application_notes,
      profiles.gender,
      profiles.ethnicity,
      profiles.veteran_status,
      profiles.disability_status,
      profiles.sexual_orientation,
      profiles.pronouns,
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


  // Candidates by category, A–Z, for the Manager's category tabs; "All" lists every candidate.
  const allCandidates = result.rows
    .filter((candidate) => candidate.role === "account")
    // Grouped under each category (A–Z); the query's name order stays within a category.
    .sort((a, b) => (a.category_name ?? "Global").localeCompare(b.category_name ?? "Global"));
  const categoryKey = (candidate: UserRow) => candidate.category_id ?? "global";
  const categoryTabs: { key: string; label: string; count: number }[] = [];
  for (const candidate of allCandidates) {
    const key = categoryKey(candidate);
    const tab = categoryTabs.find((item) => item.key === key);
    if (tab) tab.count += 1;
    else categoryTabs.push({ key, label: candidate.category_name ?? "Global", count: 1 });
  }
  const activeCategory = categoryTabs.some((tab) => tab.key === requestedCategory) ? requestedCategory : "all";
  const shownCandidates = activeCategory === "all"
    ? allCandidates
    : allCandidates.filter((candidate) => categoryKey(candidate) === activeCategory);

  return (
    <WorkspaceShell activeHref="/users" user={actor}>
    <main className="py-1">
      <div>
        <PageHeader
          description={actor.role === "manager"
            ? ""
            : "Everyone in your part of the organization, with their roles and reporting lines."}
          title={actor.role === "manager" ? "" : "People"}
        />
        <div className="mt-5 space-y-5">
          {actor.role !== "manager" && (
            <section>
              <CreateUserForm role={createRole} />
            </section>
          )}
          <section className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">
                {actor.role === "manager" ? "Candidate accounts" : "People"}
              </h2>
            </div>
            {actor.role === "manager" && (
              // Category tabs on the left, Add New on the right.
              <div className="mb-3 flex items-center gap-3">
                {allCandidates.length > 0 ? (
                <nav aria-label="Candidate categories" className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                  {[{ key: "all", label: "All", count: allCandidates.length }, ...categoryTabs].map((tab) => {
                    const active = tab.key === activeCategory;
                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
                        href={tab.key === "all" ? "/users" : `/users?category=${encodeURIComponent(tab.key)}`}
                        key={tab.key}
                        scroll={false}
                      >
                        {tab.label}
                        <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>
                          {tab.count}
                        </span>
                      </Link>
                    );
                  })}
                </nav>
                ) : <div className="flex-1" />}
                <div className="shrink-0">
                  <AddCandidateLink />
                </div>
              </div>
            )}
            {actor.role === "manager" ? (
              <PaginatedTable
                key={activeCategory}
                columns={[
                  { label: "No", className: "w-[4%] text-center" },
                  { label: "Full name", className: "w-[13%]" },
                  { label: "Category", className: "w-[11%]" },
                  { label: "Label", className: "w-[11%]" },
                  { label: "Contact", className: "w-[17%]" },
                  { label: "Street address", className: "w-[15%]" },
                  { label: "Postal code", className: "w-[9%]" },
                  { label: "LinkedIn", className: "w-[7%]" },
                  { label: "Edit", className: "w-[7%] text-center" },
                  { label: "Status", className: "w-[9%] text-center" },
                  { label: "Delete", className: "w-[8%] text-center" },
                ]}
                emptyMessage="No candidate accounts"
                rows={shownCandidates
                  .map((candidate, index) => ({
                    id: candidate.id,
                    // On a category tab every row has the same category, so the heading row is left out.
                    group: activeCategory === "all" ? candidate.category_name ?? "Global" : undefined,
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
                      <span key="global-category">{candidate.category_name || "Global"}</span>,
                      <CopyableAccountField
                        ariaLabel={`Copy label for ${userName(candidate)}`}
                        key="category"
                        value={candidate.manager_category || "No label"}
                      >
                        <span
                          className="inline-flex max-w-full items-center rounded-md px-2 py-1 font-medium"
                          style={{ backgroundColor: candidate.manager_category_color || "#e2e8f0", color: labelTextColor(candidate.manager_category_color) }}
                        >
                          {candidate.manager_category || "No label"}
                        </span>
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
                      <EditCandidateLink
                        candidateId={candidate.id}
                        key="edit"
                        readOnly={Boolean(candidate.deleted_at)}
                      />,
                      candidate.deleted_at ? (
                        <span className="block text-center text-xs font-medium text-slate-500" key="status">Deleted</span>
                      ) : (
                        <ToggleCandidateAccountStatusForm
                          active={!Boolean(candidate.blocked_at)}
                          candidateName={userName(candidate)}
                          key="status"
                          userId={candidate.id}
                        />
                      ),
                      candidate.deleted_at ? (
                        <span className="block text-center text-xs text-slate-400" key="delete">—</span>
                      ) : (
                        <DeleteCandidateAccountForm
                          active={!Boolean(candidate.blocked_at)}
                          candidateName={userName(candidate)}
                          key="delete"
                          userId={candidate.id}
                        />
                      ),
                    ],
                  }))}
              />
            ) : (
              <PaginatedTable
                columns={[
                  { label: "Name", className: "w-[22%]" },
                  { label: "Reports to", className: "w-[18%]" },
                  { label: "Role", className: "w-[15%]" },
                  { label: "Direct reports", className: "w-[15%]" },
                  { label: "Status", className: "w-[12%]" },
                  { label: "Actions", className: "w-[18%]" },
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
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-100">
                          Blocked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
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
