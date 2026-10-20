import {
  BriefcaseBusiness,
  FileText,
  Users,
} from "lucide-react";
import { sql } from "drizzle-orm";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

type WorkspaceUserRow = {
  id: string;
  role: string;
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

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  account: "Candidate",
};

function displayUserName(user: WorkspaceUserRow): string {
  if (user.role !== "account") return user.display_name ?? "Staff user";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name || "Incomplete candidate profile";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDate(value: Date | string): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value: Date | string): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default async function Home() {
  const currentUser = await requireUser();
  const canViewBlocked = currentUser.role === "super_admin";

  const visibleResult = await db.execute<WorkspaceUserRow>(sql`
    with recursive visible_users as (
      select
        id, role, parent_user_id, display_name, login_name, blocked_at, created_at
      from users
      where id = ${currentUser.id}

      union all

      select
        child.id, child.role, child.parent_user_id, child.display_name,
        child.login_name, child.blocked_at, child.created_at
      from users as child
      inner join visible_users as parent on child.parent_user_id = parent.id
      where ${canViewBlocked} or child.blocked_at is null
    )
    select
      visible_users.id,
      visible_users.role,
      visible_users.display_name,
      visible_users.login_name,
      visible_users.blocked_at,
      visible_users.created_at,
      profiles.first_name,
      profiles.last_name,
      profiles.candidate_email,
      categories.name as category_name
    from visible_users
    left join profiles on profiles.user_id = visible_users.id
    left join categories on categories.id = profiles.category_id
    order by visible_users.created_at desc
  `);
  const workspaceUsers = visibleResult.rows;
  const activeUsers = workspaceUsers.filter((user) => !user.blocked_at);
  const candidateCount = activeUsers.filter(
    (user) => user.role === "account",
  ).length;
  const staffCount = activeUsers.filter((user) => user.role !== "account").length;
  const blockedCount = workspaceUsers.filter((user) => user.blocked_at).length;

  const categoryResult = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from categories`,
  );
  const categoryCount = categoryResult.rows[0]?.count ?? 0;

  let recentLogins: LoginHistoryRow[] = [];
  if (canViewBlocked) {
    const loginResult = await db.execute<LoginHistoryRow>(sql`
      select user_id, display_name, login_name, logged_in_at
      from (
        select
          users.id as user_id,
          users.display_name,
          users.login_name,
          login_history.logged_in_at,
          row_number() over (
            partition by users.id
            order by login_history.logged_in_at desc, login_history.id desc
          ) as login_rank
        from users
        inner join login_history on login_history.user_id = users.id
        where users.role <> 'account'
      ) as ranked_logins
      where login_rank <= 5
      order by logged_in_at desc
    `);
    recentLogins = loginResult.rows;
  }

  const stats = [
    {
      label: "Team members",
      value: staffCount,
      icon: Users,
    },
    {
      label: "Candidate profiles",
      value: candidateCount,
      icon: BriefcaseBusiness,
    },
    {
      label: "Categories",
      value: categoryCount,
      icon: FileText,
    },
  ];

  return (
    <WorkspaceShell activeHref="/" user={currentUser}>
      <main className="mx-auto max-w-[1440px] py-1">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Workspace overview
              </h1>
            </div>
          </div>

          <section aria-label="Workspace summary" className="grid gap-4 md:grid-cols-3">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <article
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow-md"
                  key={stat.label}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {stat.label}
                      </p>
                      <p className="mt-3 text-[28px] font-semibold tracking-[-0.05em]">
                        {stat.value}
                      </p>
                    </div>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <Icon className="size-[17px]" strokeWidth={1.8} />
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="mt-7 grid grid-cols-1 items-start gap-5">
            <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                    People in your workspace
                  </h2>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                  {workspaceUsers.length} total
                </span>
              </div>
              <PaginatedTable
                columns={[
                  { label: "Name", className: "min-w-52" },
                  { label: "Role", className: "min-w-28" },
                  { label: "Category / added", className: "min-w-36" },
                ]}
                emptyMessage="No team members"
                rows={workspaceUsers.map((user) => {
                  const name = displayUserName(user);
                  return {
                    id: user.id,
                    cells: [
                      <div className="flex items-center gap-3" key="name">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
                          {initials(name) || "?"}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {name}
                            {user.blocked_at && (
                              <span className="ml-2 text-xs font-medium text-rose-600">
                                Blocked
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block truncate text-xs text-slate-500">
                            {user.role === "account"
                              ? user.candidate_email || "—"
                              : `@${user.login_name}`}
                          </span>
                        </span>
                      </div>,
                      roleLabels[user.role] ?? user.role,
                      user.category_name || formatDate(user.created_at),
                    ],
                  };
                })}
              />
              {canViewBlocked && (
                <div className="border-t border-slate-100 px-6 py-3 text-[11px] text-slate-500">
                  {blockedCount} blocked
                </div>
              )}
            </article>

            <div className="grid gap-5">
              {canViewBlocked ? (
                <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                      Recent sign-ins
                    </h2>
                  </div>
                  <PaginatedTable
                    columns={[
                      { label: "Name", className: "min-w-48" },
                      { label: "Login", className: "min-w-40" },
                      { label: "Signed in", className: "min-w-44" },
                    ]}
                    emptyMessage="No sign-ins"
                    rows={recentLogins.map((login, index) => ({
                      id: `${login.user_id}-${asDate(login.logged_in_at).getTime()}-${index}`,
                      cells: [
                        login.display_name ?? "Staff user",
                        `@${login.login_name ?? "unknown"}`,
                        <time
                          key="signed-in"
                        >
                          {formatDateTime(login.logged_in_at)}
                        </time>,
                      ],
                    }))}
                  />
                </article>
              ) : null}
            </div>
          </section>

        </main>
    </WorkspaceShell>
  );
}
