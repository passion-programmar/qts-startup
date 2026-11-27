import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Eye, Pencil, UserPlus } from "lucide-react";
import { PaginatedTable } from "@/app/components/paginated-table";
import { Badge } from "@/app/ui/badge";
import { LinkButton } from "@/app/ui/button";
import { PageHeader } from "@/app/ui/page-header";
import { LinkTabs } from "@/app/ui/tabs";
import {
  CopyableAccountField,
  CopyLinkedInUrl,
  DeleteCandidateAccountForm,
  LinkedInStatusForm,
  ToggleCandidateAccountStatusForm,
} from "@/app/users/row-actions";
import { CreateUserForm, CredentialResetForm, DeleteStaffUserForm } from "@/app/users/staff-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { labelTextColor } from "@/server/users/manager-category-color";
import { linkedInStatusOf } from "@/server/users/linkedin-status";

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

// Only what the list shows; the edit page loads a candidate's full profile itself.
type UserRow = {
  id: string;
  role: string;
  parent_user_id: string | null;
  display_name: string | null;
  login_name: string | null;
  blocked_at: Date | string | null;
  deleted_at: Date | string | null;
  first_name: string | null;
  last_name: string | null;
  candidate_email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  linkedin_status: string | null;
  linkedin_status_changed_at: Date | string | null;
  address_line_1: string | null;
  postal_code: string | null;
  category_id: string | null;
  manager_category: string | null;
  manager_category_color: string | null;
  category_name: string | null;
};

function userName(user: UserRow): string {
  if (user.role !== "account") return user.display_name ?? "Staff user";
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "Incomplete candidate profile";
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
      select id, role, parent_user_id, display_name, login_name, blocked_at, deleted_at
      from users
      where id = ${actor.id}

      union all

      select child.id, child.role, child.parent_user_id, child.display_name,
        child.login_name, child.blocked_at, child.deleted_at
      from users as child
      inner join visible_users as parent on child.parent_user_id = parent.id
      -- Inactive and deleted candidate accounts stay visible to their Manager.
      where ${includeBlocked} or child.blocked_at is null or child.role = 'account'
    )
    select
      visible_users.id, visible_users.role, visible_users.parent_user_id, visible_users.display_name,
      visible_users.login_name, visible_users.blocked_at, visible_users.deleted_at,
      profiles.first_name, profiles.last_name, profiles.candidate_email, profiles.phone,
      profiles.linkedin_url, profiles.linkedin_status, profiles.linkedin_status_changed_at, profiles.address_line_1, profiles.postal_code,
      profiles.category_id, profiles.manager_category, profiles.manager_category_color,
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

  return actor.role === "manager"
    ? <CandidateList requestedCategory={requestedCategory} rows={result.rows} />
    : <StaffList actorRole={actor.role} rows={result.rows} />;
}

// A Manager's candidates, with a tab for each category.
function CandidateList({ rows, requestedCategory }: { rows: UserRow[]; requestedCategory: string }) {
  // Grouped under each category (A–Z); the query's name order stays within a category.
  const allCandidates = rows
    .filter((candidate) => candidate.role === "account")
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
  const addNew = <LinkButton href="/users/new" icon={<UserPlus aria-hidden="true" className="size-4" />}>Add New</LinkButton>;

  return (
    <main className="space-y-4 py-1">
      <PageHeader
        description="Click a name, contact or address to copy it. An inactive candidate is left out of Get JD, Generation and Apply."
        title="Candidate accounts"
      />
      {allCandidates.length > 0 ? (
        <LinkTabs
          items={[{ key: "all", label: "All", count: allCandidates.length }, ...categoryTabs].map((tab) => ({
            href: tab.key === "all" ? "/users" : `/users?category=${encodeURIComponent(tab.key)}`,
            label: tab.label,
            count: tab.count,
            active: tab.key === activeCategory,
          }))}
          label="Candidate categories"
          trailing={addNew}
        />
      ) : (
        <div className="flex justify-end">{addNew}</div>
      )}
      <PaginatedTable
        key={activeCategory}
        columns={[
          { label: "No", className: "w-[4%] text-center" },
          { label: "Full name", className: "w-[13%]" },
          { label: "Category", className: "w-[11%]" },
          { label: "Label", className: "w-[11%]" },
          { label: "Contact", className: "w-[17%]" },
          { label: "Street address", className: "w-[15%]" },
          { label: "Postal code", className: "w-[8%]" },
          { label: "LinkedIn", className: "w-[8%]" },
          { label: "Edit", className: "w-[7%] text-center" },
          { label: "Status", className: "w-[9%] text-center" },
          { label: "Delete", className: "w-[8%] text-center" },
        ]}
        emptyMessage="No candidate accounts"
        rows={shownCandidates.map((candidate, index) => {
          const name = userName(candidate);
          const active = !candidate.blocked_at;
          const deleted = Boolean(candidate.deleted_at);
          return {
            id: candidate.id,
            // On a category tab every row has the same category, so the heading row is left out.
            group: activeCategory === "all" ? candidate.category_name ?? "Global" : undefined,
            cells: [
              <CopyableAccountField ariaLabel={`Copy row number ${index + 1}`} className="text-center" key="number" value={String(index + 1)}>
                {index + 1}
              </CopyableAccountField>,
              <CopyableAccountField ariaLabel={`Copy full name for ${name}`} className="font-semibold text-fg" key="candidate" value={name}>
                {name}
              </CopyableAccountField>,
              <span key="global-category">{candidate.category_name || "Global"}</span>,
              <CopyableAccountField ariaLabel={`Copy label for ${name}`} key="category" value={candidate.manager_category || "No label"}>
                <span
                  className="inline-flex max-w-full items-center rounded-md px-2 py-1 font-medium"
                  style={{ backgroundColor: candidate.manager_category_color || "#e2e8f0", color: labelTextColor(candidate.manager_category_color) }}
                >
                  {candidate.manager_category || "No label"}
                </span>
              </CopyableAccountField>,
              <CopyableAccountField
                ariaLabel={`Copy contact for ${name}`}
                key="contact"
                value={[candidate.candidate_email, candidate.phone].filter(Boolean).join("\n") || "—"}
              >
                <div>{candidate.candidate_email ?? "—"}</div>
                <div className="mt-1 text-fg-muted">{candidate.phone ?? "—"}</div>
              </CopyableAccountField>,
              <CopyableAccountField ariaLabel={`Copy street address for ${name}`} key="street-address" value={candidate.address_line_1 || "—"}>
                {candidate.address_line_1 || "—"}
              </CopyableAccountField>,
              <CopyableAccountField ariaLabel={`Copy postal code for ${name}`} key="postal-code" value={candidate.postal_code || "—"}>
                {candidate.postal_code || "—"}
              </CopyableAccountField>,
              // The LinkedIn account's status (Live / Applying / Blocked, the Manager's signal), with the
              // profile link to copy under it.
              <div className="space-y-1" key="linkedin">
                {deleted ? null : (
                  <LinkedInStatusForm
                    candidateName={name}
                    changedAt={candidate.linkedin_status_changed_at ? new Date(candidate.linkedin_status_changed_at).toISOString() : null}
                    status={linkedInStatusOf(candidate.linkedin_status)}
                    userId={candidate.id}
                  />
                )}
                {candidate.linkedin_url ? <CopyLinkedInUrl url={candidate.linkedin_url} /> : <span className="block text-xs text-fg-faint">—</span>}
              </div>,
              <LinkButton
                aria-label={deleted ? "View deleted candidate profile" : "Edit candidate profile"}
                href={`/users/${candidate.id}/edit`}
                icon={deleted ? <Eye aria-hidden="true" className="size-3.5" /> : <Pencil aria-hidden="true" className="size-3.5" />}
                key="edit"
                size="sm"
                variant="soft"
              >
                {deleted ? "View" : "Edit"}
              </LinkButton>,
              deleted ? (
                <Badge key="status">Deleted</Badge>
              ) : (
                <ToggleCandidateAccountStatusForm active={active} candidateName={name} key="status" userId={candidate.id} />
              ),
              deleted ? (
                <span className="block text-center text-xs text-fg-faint" key="delete">—</span>
              ) : (
                <DeleteCandidateAccountForm active={active} candidateName={name} key="delete" userId={candidate.id} />
              ),
            ],
          };
        })}
      />
    </main>
  );
}

// Super Admin and Admin: everyone below them, with their role and reporting line.
function StaffList({ rows, actorRole }: { rows: UserRow[]; actorRole: string }) {
  const usersById = new Map(rows.map((user) => [user.id, user]));
  const directReportsByUserId = new Map<string, UserRow[]>();
  const peersByParentAndRole = new Map<string, UserRow[]>();
  for (const user of rows) {
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
  const createRole = actorRole === "super_admin" ? "admin" : "manager";

  return (
    <main className="space-y-4 py-1">
      <PageHeader
        actions={<CreateUserForm role={createRole} />}
        description="Everyone in your part of the organization, with their roles and reporting lines."
        title="People"
      />
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
        rows={rows.map((person) => {
          const directReports = directReportsByUserId.get(person.id) ?? [];
          const parent = person.parent_user_id ? usersById.get(person.parent_user_id) : undefined;
          const replacementUsers = (peersByParentAndRole.get(`${person.parent_user_id ?? "root"}:${person.role}`) ?? [])
            .filter((peer) => peer.id !== person.id && peer.role === person.role && peer.parent_user_id === person.parent_user_id && !peer.blocked_at)
            .map((peer) => ({ id: peer.id, name: `${userName(peer)} (@${peer.login_name ?? "no username"})` }));
          return {
            id: person.id,
            cells: [
              <div key="person">
                <div className="font-semibold text-fg">{userName(person)}</div>
                <div className="mt-1 text-xs text-fg-muted">
                  {person.role === "account" ? person.candidate_email || "—" : `@${person.login_name}`}
                </div>
              </div>,
              parent ? userName(parent) : "—",
              roleLabels[person.role] ?? person.role,
              directReports.length,
              person.blocked_at ? <Badge dot key="status" tone="danger">Blocked</Badge> : <Badge dot key="status" tone="success">Active</Badge>,
              actorRole === "super_admin" && person.role !== "account" && person.login_name ? (
                <div className="flex flex-wrap items-center gap-2" key="actions">
                  <CredentialResetForm loginName={person.login_name} userId={person.id} />
                  {(person.role === "admin" || person.role === "manager") && (
                    <DeleteStaffUserForm reportsCount={directReports.length} replacementUsers={replacementUsers} userId={person.id} />
                  )}
                </div>
              ) : (
                "—"
              ),
            ],
          };
        })}
      />
    </main>
  );
}
