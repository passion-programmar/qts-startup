import {
  Activity,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  CircleHelp,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  Tags,
  Users,
  UserRound,
} from "lucide-react";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { settings } from "@/db/schema";

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
  let managerCanEditPrompt = false;
  if (currentUser.role === "manager") {
    const [promptMode] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "prompt_mode"))
      .limit(1);
    managerCanEditPrompt = promptMode?.value === "private";
  }

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
      detail: "Staff accounts in your workspace",
      icon: Users,
    },
    {
      label: "Candidate profiles",
      value: candidateCount,
      detail: "Candidate Accounts you can access",
      icon: BriefcaseBusiness,
    },
    {
      label: "Categories",
      value: categoryCount,
      detail: "Available candidate categories",
      icon: FileText,
    },
  ];

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-slate-200/80 bg-white lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-6">
          <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold tracking-tight text-white shadow-sm shadow-indigo-200">
            q
          </div>
          <span className="text-[17px] font-semibold tracking-tight">
            qts<span className="text-indigo-600">.</span>
          </span>
          <span className="ml-auto rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Beta
          </span>
        </div>

        <div className="px-4 pt-6">
          <div className="rounded-xl border border-slate-200 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-slate-800">
                {currentUser.displayName}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                @{currentUser.loginName}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {roleLabels[currentUser.role]}
              </p>
            </div>
          </div>
        </div>

        <nav aria-label="Main navigation" className="px-3 pt-7">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
            Workspace
          </p>
          <div className="space-y-1">
            <Link
              aria-current="page"
              className="flex items-center gap-3 rounded-lg bg-indigo-50 px-3 py-2.5 text-[13px] font-medium text-indigo-700"
              href="/"
            >
              <LayoutDashboard className="size-[17px]" strokeWidth={1.8} />
              Overview
            </Link>
            {[
              { label: "Users", icon: Users, href: "/users" },
              ...(currentUser.role === "super_admin"
                ? [{ label: "Categories", icon: Tags, href: "/categories" }]
                : []),
              { label: "Applications", icon: BriefcaseBusiness },
              ...(managerCanEditPrompt
                ? [{ label: "My AI Prompt", icon: FileText, href: "/prompts" }]
                : []),
              { label: "Profile", icon: UserRound, href: "/profile" },
              ...(currentUser.role === "super_admin"
                ? [{ label: "Settings", icon: Settings2, href: "/settings" }]
                : []),
            ].map((item) => {
              const Icon = item.icon;
              if ("href" in item && item.href) {
                return (
                  <Link
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                    href={item.href}
                    key={item.label}
                  >
                    <Icon className="size-[17px]" strokeWidth={1.8} />
                    {item.label}
                  </Link>
                );
              }
              return (
                <span
                  aria-disabled="true"
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-400"
                  key={item.label}
                  title="Available in a later milestone"
                >
                  <Icon className="size-[17px]" strokeWidth={1.8} />
                  {item.label}
                </span>
              );
            })}
          </div>
        </nav>

        <div className="mt-auto px-4 pb-5">
          <div className="rounded-xl bg-slate-50 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ShieldCheck className="size-3.5 text-indigo-600" />
              Signed in securely
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
              Your workspace is scoped to your role and reporting hierarchy.
            </p>
          </div>
          <form action={logoutAction}>
            <button
              className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              type="submit"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-10 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              q
            </div>
            <span className="text-base font-semibold tracking-tight">
              qts<span className="text-indigo-600">.</span>
            </span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
            <span>Workspace</span>
            <ChevronRight className="size-3.5" />
            <span className="font-medium text-slate-700">Overview</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-medium text-slate-700">
                {currentUser.displayName}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                @{currentUser.loginName}
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-400">
                {roleLabels[currentUser.role]} workspace
              </p>
              <h1 className="text-[26px] font-semibold tracking-[-0.04em] sm:text-[30px]">
                Welcome, {currentUser.displayName}
              </h1>
              <p className="mt-1 text-[13px] text-slate-500">
                Here&apos;s an overview of the people and resources you can
                access.
              </p>
            </div>
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600">
              <Activity className="size-3.5 text-emerald-600" />
              Connected to Neon
            </span>
          </div>

          <section aria-label="Workspace summary" className="grid gap-4 md:grid-cols-3">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <article
                  className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
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
                  <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                    {stat.detail}
                  </p>
                </article>
              );
            })}
          </section>

          <section className="mt-7 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <article className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                    People in your workspace
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Visible users follow your role hierarchy
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                  {workspaceUsers.length} total
                </span>
              </div>
              {workspaceUsers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left sm:min-w-[560px]">
                    <thead>
                      <tr className="bg-slate-50/70 text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">
                        <th className="px-4 py-3 sm:px-6">Name</th>
                        <th className="px-3 py-3">Role</th>
                        <th className="hidden px-4 py-3 sm:table-cell">
                          Category / added
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspaceUsers.slice(0, 12).map((user) => {
                        const name = displayUserName(user);
                        return (
                          <tr
                            className="border-t border-slate-100"
                            key={user.id}
                          >
                            <td className="px-4 py-3.5 sm:px-6">
                              <div className="flex items-center gap-3">
                                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[10px] font-semibold text-indigo-700">
                                  {initials(name) || "?"}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-slate-800">
                                    {name}
                                    {user.blocked_at && (
                                      <span className="ml-2 text-[9px] font-medium text-rose-600">
                                        Blocked
                                      </span>
                                    )}
                                  </p>
                                  <p className="mt-0.5 truncate text-[10px] text-slate-400">
                                    {user.role === "account"
                                      ? user.candidate_email || "No candidate email"
                                      : `@${user.login_name}`}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3.5 text-[10px] text-slate-500">
                              {roleLabels[user.role] ?? user.role}
                            </td>
                            <td className="hidden px-4 py-3.5 text-[10px] text-slate-500 sm:table-cell">
                              {user.category_name || formatDate(user.created_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-6 py-12 text-center">
                  <Users className="mx-auto size-8 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-700">
                    No team members yet
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Your workspace is ready for its first users.
                  </p>
                </div>
              )}
              <div className="border-t border-slate-100 px-6 py-3 text-[10px] text-slate-400">
                {canViewBlocked
                  ? `${blockedCount} blocked user${blockedCount === 1 ? "" : "s"} visible to Super Admin`
                  : "Blocked users are hidden from this workspace"}
              </div>
            </article>

            <div className="grid gap-5">
              {canViewBlocked ? (
                <article className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                      Recent sign-ins
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Latest five successful logins per staff user
                    </p>
                  </div>
                  {recentLogins.length > 0 ? (
                    <ul className="divide-y divide-slate-100">
                      {recentLogins.map((login, index) => (
                        <li
                          className="flex items-center justify-between gap-3 px-5 py-3"
                          key={`${login.user_id}-${asDate(login.logged_in_at).getTime()}-${index}`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-slate-700">
                              {login.display_name}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">
                              @{login.login_name}
                            </p>
                          </div>
                          <time className="shrink-0 text-[10px] text-slate-500">
                            {formatDateTime(login.logged_in_at)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-5 py-8 text-center text-xs text-slate-400">
                      Successful sign-ins will appear here.
                    </div>
                  )}
                  <div className="border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400">
                    Login history is visible only to Super Admin.
                  </div>
                </article>
              ) : (
                <article className="rounded-xl bg-slate-900 p-5 text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)]">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <ShieldCheck className="size-4 text-indigo-300" />
                    Your access
                  </div>
                  <p className="mt-3 text-sm font-semibold tracking-tight">
                    Scoped to your team
                  </p>
                  <p className="mt-1.5 text-[11px] leading-5 text-slate-300">
                    You can see your own account and users beneath you in the
                    organization hierarchy. Login history is restricted to
                    Super Admin.
                  </p>
                </article>
              )}

              <article className="rounded-xl border border-slate-200/80 bg-white p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  <CircleHelp className="size-4 text-indigo-600" />
                  Getting started
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  User management, profile editing, and application workflows
                  will be added in upcoming milestones.
                </p>
                <div className="mt-4 flex items-center gap-1.5 text-[10px] font-medium text-emerald-600">
                  <ArrowUpRight className="size-3.5" />
                  Connected to your Neon workspace
                </div>
              </article>
            </div>
          </section>

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-slate-400">
            <p>QTS workspace · Data loaded from Neon</p>
            <p>Candidate account details follow your role permissions.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
