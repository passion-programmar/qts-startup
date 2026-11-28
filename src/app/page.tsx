import { BriefcaseBusiness, History, Tags, Users } from "lucide-react";
import { sql } from "drizzle-orm";
import type { ReactNode } from "react";
import { ManagerOverview } from "@/app/components/manager-overview";
import { PaginatedTable } from "@/app/components/paginated-table";
import { PeopleTree, type PeopleTreeUser } from "@/app/components/people-tree";
import { peopleTreeSummary } from "@/app/components/people-tree-summary";
import { Badge } from "@/app/ui/badge";
import { Card, CardHeader } from "@/app/ui/card";
import { PageHeader } from "@/app/ui/page-header";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseAnalysisView } from "@/server/analysis/analysis-values";

export const instant = false;

type WorkspaceUserRow = {
  id: string;
  role: string;
  parent_user_id: string | null;
  display_name: string | null;
  login_name: string | null;
  blocked_at: Date | null;
  created_at: Date | string;
  first_name: string | null;
  last_name: string | null;
  candidate_email: string | null;
  category_name: string | null;
};

type LoginHistoryRow = {
  user_id: string;
  display_name: string | null;
  login_name: string | null;
  logged_in_at: Date | string;
};

function displayUserName(user: WorkspaceUserRow): string {
  if (user.role !== "account") return user.display_name ?? "Staff user";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name || "Incomplete candidate profile";
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDateTime(value: Date | string): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-fg tabular-nums">{value}</p>
      </div>
      <span className="flex size-11 items-center justify-center rounded-control bg-linear-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/20 [&>svg]:size-5">
        {icon}
      </span>
    </Card>
  );
}

// Super Admin and Admin start here. A Manager signs in to Jobs; their Overview here shows bids and
// interviews over time (this week day by day; ?back=N earlier weeks; ?range=month|year; ?tz=cet|ro).
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role === "manager") {
    return <ManagerOverview user={currentUser} view={parseAnalysisView(await searchParams)} />;
  }
  const canViewBlocked = currentUser.role === "super_admin";

  // The three reads don't depend on each other, so they run together (one wait, not three).
  const [visibleResult, categoryResult, loginResult] = await Promise.all([
    db.execute<WorkspaceUserRow>(sql`
      with recursive visible_users as (
        select id, role, parent_user_id, display_name, login_name, blocked_at, created_at
        from users
        where id = ${currentUser.id}

        union all

        select child.id, child.role, child.parent_user_id, child.display_name,
          child.login_name, child.blocked_at, child.created_at
        from users as child
        inner join visible_users as parent on child.parent_user_id = parent.id
        where ${canViewBlocked} or child.blocked_at is null
      )
      select
        visible_users.id, visible_users.role, visible_users.parent_user_id, visible_users.display_name, visible_users.login_name,
        visible_users.blocked_at, visible_users.created_at,
        profiles.first_name, profiles.last_name, profiles.candidate_email,
        categories.name as category_name
      from visible_users
      left join profiles on profiles.user_id = visible_users.id
      left join categories on categories.id = profiles.category_id
      order by visible_users.created_at desc
    `),
    db.execute<{ count: number }>(sql`select count(*)::int as count from categories`),
    // Each staff member's last five sign-ins, read from the (user, time) index instead of ranking
    // every sign-in ever recorded.
    canViewBlocked
      ? db.execute<LoginHistoryRow>(sql`
          select users.id as user_id, users.display_name, users.login_name, recent.logged_in_at
          from users
          cross join lateral (
            select login_history.logged_in_at
            from login_history
            where login_history.user_id = users.id
            order by login_history.logged_in_at desc, login_history.id desc
            limit 5
          ) as recent
          where users.role <> 'account'
          order by recent.logged_in_at desc
        `)
      : Promise.resolve({ rows: [] as LoginHistoryRow[] }),
  ]);
  const workspaceUsers = visibleResult.rows;
  const activeUsers = workspaceUsers.filter((user) => !user.blocked_at);
  const candidateCount = activeUsers.filter((user) => user.role === "account").length;
  const staffCount = activeUsers.filter((user) => user.role !== "account").length;
  const blockedCount = workspaceUsers.filter((user) => user.blocked_at).length;
  const categoryCount = categoryResult.rows[0]?.count ?? 0;
  const recentLogins = loginResult.rows;
  // Everyone below the viewer, grouped Admin → Manager → candidates.
  const treeUsers: PeopleTreeUser[] = workspaceUsers
    .filter((user) => user.role !== "super_admin" && user.id !== currentUser.id)
    .map((user) => ({
      id: user.id,
      role: user.role,
      parentId: user.parent_user_id,
      name: displayUserName(user),
      login: user.login_name,
      email: user.candidate_email,
      category: user.category_name,
      blocked: Boolean(user.blocked_at),
    }));

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 py-1 2xl:max-w-none">
      <PageHeader
        title="Workspace overview"
      />

      <section aria-label="Workspace summary" className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={<Users />} label="Team members" value={staffCount} />
        <StatTile icon={<BriefcaseBusiness />} label="Candidate profiles" value={candidateCount} />
        <StatTile icon={<Tags />} label="Categories" value={categoryCount} />
      </section>

      <Card flush className="overflow-hidden">
        <CardHeader
          actions={<Badge tone="primary">{peopleTreeSummary(treeUsers)}</Badge>}
          className="border-b border-line-soft px-5 py-4 sm:px-6"
          icon={<Users />}
          title="People in your workspace"
        />
        <PeopleTree profileLinks={canViewBlocked} users={treeUsers} />
        {canViewBlocked && (
          <div className="border-t border-line-soft px-6 py-3 text-[11px] text-fg-muted">{blockedCount} blocked</div>
        )}
      </Card>

      {canViewBlocked ? (
        <Card flush className="overflow-hidden">
          <CardHeader className="border-b border-line-soft px-5 py-4" description="The last five sign-ins of each staff member." icon={<History />} title="Recent sign-ins" />
          <PaginatedTable
            embedded
            columns={[
              { label: "Name", className: "w-[35%]" },
              { label: "Login", className: "w-[25%]" },
              { label: "Signed in", className: "w-[40%]" },
            ]}
            emptyMessage="No sign-ins"
            rows={recentLogins.map((login, index) => ({
              id: `${login.user_id}-${asDate(login.logged_in_at).getTime()}-${index}`,
              cells: [
                login.display_name ?? "Staff user",
                `@${login.login_name ?? "unknown"}`,
                <time key="signed-in">{formatDateTime(login.logged_in_at)}</time>,
              ],
            }))}
          />
        </Card>
      ) : null}
    </main>
  );
}
