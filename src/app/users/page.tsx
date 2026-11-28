import type { Metadata } from "next";
import type { ReactNode } from "react";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { PeopleTree, type PeopleTreeUser } from "@/app/components/people-tree";
import { peopleTreeSummary } from "@/app/components/people-tree-summary";
import { LinkButton } from "@/app/ui/button";
import { PageHeader } from "@/app/ui/page-header";
import { CandidateBoard, type CandidateRowData } from "@/app/users/candidate-board";
import { CreateUserForm, CredentialResetForm, DeleteStaffUserForm } from "@/app/users/staff-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { linkedInStatusOf } from "@/server/users/linkedin-status";

export const instant = false;

export const metadata: Metadata = {
  title: "Users | QTS",
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
  linkedin_status: string | null;
  linkedin_status_changed_at: Date | string | null;
  category_id: string | null;
  manager_category: string | null;
  manager_category_color: string | null;
  category_name: string | null;
  category_color: string | null;
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
      profiles.linkedin_status, profiles.linkedin_status_changed_at,
      profiles.category_id, profiles.manager_category, profiles.manager_category_color,
      categories.name as category_name, categories.color as category_color
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
    : <StaffList actorId={actor.id} actorRole={actor.role} rows={result.rows} />;
}

// A Manager's candidates: status cards, search and category tabs over a short table (candidate-board.tsx).
function CandidateList({ rows, requestedCategory }: { rows: UserRow[]; requestedCategory: string }) {
  // Grouped under each category (A–Z); the query's name order stays within a category.
  const candidates: CandidateRowData[] = rows
    .filter((candidate) => candidate.role === "account")
    .sort((a, b) => (a.category_name ?? "Global").localeCompare(b.category_name ?? "Global"))
    .map((candidate) => ({
      id: candidate.id,
      name: userName(candidate),
      categoryKey: candidate.category_id ?? "global",
      categoryName: candidate.category_name ?? "Global",
      categoryColor: candidate.category_color,
      label: candidate.manager_category ?? "",
      // A category with a Super Admin colour decides the label colour.
      labelColor: candidate.category_color || candidate.manager_category_color,
      email: candidate.candidate_email,
      phone: candidate.phone,
      linkedinStatus: linkedInStatusOf(candidate.linkedin_status),
      linkedinChangedAt: candidate.linkedin_status_changed_at ? new Date(candidate.linkedin_status_changed_at).toISOString() : null,
      active: !candidate.blocked_at,
      deleted: Boolean(candidate.deleted_at),
    }));

  return (
    <main className="space-y-4 py-1">
      <PageHeader
        actions={<LinkButton href="/users/new" icon={<UserPlus aria-hidden="true" className="size-4" />} rel="noopener" target="_blank">Add candidate</LinkButton>}
        title="Candidate accounts"
      />
      <CandidateBoard candidates={candidates} initialCategory={requestedCategory} />
    </main>
  );
}

// Super Admin and Admin: everyone below them as a tree (Admin → Manager → candidates, 2026-11-28),
// with Reset login and Delete beside each staff member for the Super Admin.
function StaffList({ rows, actorId, actorRole }: { rows: UserRow[]; actorId: string; actorRole: string }) {
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

  const treeUsers: PeopleTreeUser[] = rows
    .filter((user) => user.role !== "super_admin" && user.id !== actorId)
    .map((user) => ({
      id: user.id,
      role: user.role,
      parentId: user.parent_user_id,
      name: userName(user),
      login: user.login_name,
      email: user.candidate_email,
      category: user.category_name,
      blocked: Boolean(user.blocked_at),
      deleted: Boolean(user.deleted_at),
    }));

  const actions: Record<string, ReactNode> = {};
  if (actorRole === "super_admin") {
    for (const person of rows) {
      if (person.role === "account" || person.role === "super_admin" || !person.login_name) continue;
      const directReports = directReportsByUserId.get(person.id) ?? [];
      const replacementUsers = (peersByParentAndRole.get(`${person.parent_user_id ?? "root"}:${person.role}`) ?? [])
        .filter((peer) => peer.id !== person.id && peer.role === person.role && peer.parent_user_id === person.parent_user_id && !peer.blocked_at)
        .map((peer) => ({ id: peer.id, name: `${userName(peer)} (@${peer.login_name ?? "no username"})` }));
      actions[person.id] = (
        <>
          <CredentialResetForm loginName={person.login_name} userId={person.id} />
          <DeleteStaffUserForm reportsCount={directReports.length} replacementUsers={replacementUsers} userId={person.id} />
        </>
      );
    }
  }

  return (
    <main className="space-y-4 py-1">
      <PageHeader
        actions={<CreateUserForm role={createRole} />}
        title="People"
      />
      <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-5 py-3 text-xs text-fg-muted">
          <span className="font-semibold uppercase tracking-wider">Admins, Managers and candidates</span>
          <span className="tabular-nums">{peopleTreeSummary(treeUsers)}</span>
        </div>
        <PeopleTree actions={actions} profileLinks={actorRole === "super_admin"} users={treeUsers} />
      </section>
    </main>
  );
}
