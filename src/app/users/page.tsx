import type { Metadata } from "next";
import {
  ChevronRight,
  CircleHelp,
  FolderTree,
  ShieldCheck,
  Users,
} from "lucide-react";
import { sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { categories } from "@/db/schema";
import {
  CreateUserForm,
  CredentialResetForm,
  DeleteStaffUserForm,
  EditCandidateProfileForm,
} from "@/app/users/user-forms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

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
  category_name: string | null;
};

type UserNode = UserRow & { children: UserNode[] };

function userName(user: UserRow): string {
  if (user.role !== "account") return user.display_name ?? "Staff user";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    "Incomplete candidate profile"
  );
}

function buildTree(rows: UserRow[], rootId: string): UserNode | null {
  const nodes = new Map<string, UserNode>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  for (const node of nodes.values()) {
    if (node.parent_user_id) {
      nodes.get(node.parent_user_id)?.children.push(node);
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((left, right) =>
      userName(left).localeCompare(userName(right)),
    );
  }

  return nodes.get(rootId) ?? null;
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
      categories.name as category_name
    from visible_users
    left join profiles on profiles.user_id = visible_users.id
    left join categories on categories.id = profiles.category_id
  `);

  const tree = buildTree(result.rows, actor.id);
  if (!tree) throw new Error("The signed-in user is missing from the workspace.");

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

  const visibleCount = result.rows.length;
  const staffCount = result.rows.filter((user) => user.role !== "account").length;
  const candidateCount = visibleCount - staffCount;

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <span>Workspace</span>
              <ChevronRight className="size-3.5" />
              <span className="font-medium text-slate-700">Users</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {actor.role === "manager"
                ? "Candidate Accounts"
                : "Users & hierarchy"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {actor.role === "manager"
                ? "Manage candidate profiles assigned to you."
                : "View people within your organization branch and add the next role in the hierarchy."}
            </p>
          </div>
          <Link
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            href="/"
          >
            Back to dashboard
          </Link>
        </div>
        {actor.role === "super_admin" && (
          <Link
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
            href="/categories"
          >
            <FolderTree className="size-3.5" />
            Manage candidate categories
          </Link>
        )}

        <section
          aria-label="Visible user totals"
          className="mt-7 grid gap-3 sm:grid-cols-3"
        >
          {[
            { label: "Visible users", value: visibleCount, icon: Users },
            { label: "Staff accounts", value: staffCount, icon: ShieldCheck },
            { label: "Candidate Accounts", value: candidateCount, icon: Users },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <article
                className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-4"
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

        <div
          className={`mt-5 grid items-start gap-5 ${
            createRole === "account"
              ? "lg:grid-cols-1"
              : "lg:grid-cols-[minmax(0,1fr)_360px]"
          }`}
        >
          <section
            className={`rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6 ${
              createRole === "account" ? "order-2" : ""
            }`}
          >
            <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-4">
              <FolderTree className="mt-0.5 size-4 text-indigo-600" />
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  {actor.role === "manager"
                    ? "Candidate Accounts"
                    : "Organization tree"}
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  {actor.role === "manager"
                    ? "View and edit candidate profile details. Education and experience records are managed separately."
                    : actor.role === "super_admin"
                      ? "All users and descendants, including blocked records."
                      : "Your account and the users managed below you."}
                </p>
              </div>
            </div>
            {actor.role === "manager" ? (
              <div className="overflow-x-auto">
                {result.rows.filter((user) => user.role === "account").length ? (
                  <table className="w-full min-w-[980px] text-left text-xs">
                    <thead className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-3 font-semibold">Candidate</th>
                        <th className="px-3 py-3 font-semibold">Category</th>
                        <th className="px-3 py-3 font-semibold">Contact</th>
                        <th className="px-3 py-3 font-semibold">Location</th>
                        <th className="px-3 py-3 font-semibold">Headline</th>
                        <th className="px-3 py-3 font-semibold">LinkedIn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.rows
                        .filter((user) => user.role === "account")
                        .map((candidate) => (
                          <tr key={candidate.id}>
                            <td className="px-3 py-4 align-top">
                              <p className="font-semibold text-slate-800">
                                {userName(candidate)}
                              </p>
                              <EditCandidateProfileForm
                                candidate={{
                                  userId: candidate.id,
                                  firstName: candidate.first_name,
                                  lastName: candidate.last_name,
                                  candidateEmail: candidate.candidate_email,
                                  phone: candidate.phone,
                                  headline: candidate.headline,
                                  linkedinUrl: candidate.linkedin_url,
                                  country: candidate.country,
                                  city: candidate.city,
                                  province: candidate.province,
                                  addressLine1: candidate.address_line_1,
                                  postalCode: candidate.postal_code,
                                  categoryId: candidate.category_id,
                                }}
                                categories={categoryOptions}
                              />
                            </td>
                            <td className="px-3 py-4 align-top text-slate-600">
                              {candidate.category_name ?? "Uncategorized"}
                            </td>
                            <td className="px-3 py-4 align-top text-slate-600">
                              <p>{candidate.candidate_email ?? "—"}</p>
                              <p className="mt-1 text-slate-400">
                                {candidate.phone ?? "—"}
                              </p>
                            </td>
                            <td className="px-3 py-4 align-top text-slate-600">
                              {[
                                candidate.address_line_1,
                                candidate.city,
                                candidate.province,
                                candidate.country,
                                candidate.postal_code,
                              ]
                                .filter(Boolean)
                                .join(", ") || "—"}
                            </td>
                            <td className="max-w-56 px-3 py-4 align-top text-slate-600">
                              {candidate.headline ?? "—"}
                            </td>
                            <td className="px-3 py-4 align-top">
                              {candidate.linkedin_url ? (
                                <a
                                  className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
                                  href={candidate.linkedin_url}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Open profile
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    No candidate Accounts yet. Use Add candidate Account to
                    create the first profile.
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                <UserTreeNode
                  canEditCredentials={actor.role === "super_admin"}
                  allUsers={result.rows}
                  user={tree}
                />
              </ul>
            )}
          </section>

          <div className={`grid gap-5 ${createRole === "account" ? "order-1" : ""}`}>
            <CreateUserForm categories={categoryOptions} role={createRole} />
            <section className="rounded-xl border border-slate-200/80 bg-white p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <CircleHelp className="size-4 text-indigo-600" />
                Creation permissions
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                {actor.role === "super_admin"
                  ? "Super Admin creates Admin accounts. Admins add Managers; Managers add candidate Accounts."
                  : actor.role === "admin"
                    ? "You can add Managers who report directly to you."
                    : "You can create candidate profiles assigned to your management branch."}
              </p>
              <p className="mt-3 border-t border-slate-100 pt-3 text-[10px] leading-4 text-slate-400">
                Passwords are never readable after creation. Super Admin can
                replace staff login credentials, which invalidates their
                existing sessions.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function UserTreeNode({
  user,
  canEditCredentials,
  allUsers,
}: {
  user: UserNode;
  canEditCredentials: boolean;
  allUsers: UserRow[];
}) {
  const name = userName(user);
  const blocked = Boolean(user.blocked_at);
  const replacementUsers = allUsers
    .filter(
      (candidate) =>
        candidate.id !== user.id &&
        candidate.role === user.role &&
        candidate.parent_user_id === user.parent_user_id &&
        !candidate.blocked_at,
    )
    .map((candidate) => ({
      id: candidate.id,
      name: `${userName(candidate)} (@${candidate.login_name ?? "no username"})`,
    }));

  return (
    <li>
      <div
        className={`rounded-lg border px-3 py-3 ${
          blocked
            ? "border-rose-200 bg-rose-50/50"
            : "border-slate-100 bg-slate-50/60"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold ${
                blocked
                  ? "bg-rose-100 text-rose-700"
                  : "bg-indigo-100 text-indigo-700"
              }`}
            >
              {name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join("") || "?"}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-slate-800">
                {name}
                {blocked && (
                  <span className="ml-2 font-medium text-rose-600">Blocked</span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                {user.role === "account"
                  ? user.candidate_email || "No candidate email"
                  : `@${user.login_name}`}
              </span>
            </span>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-slate-500">
            {roleLabels[user.role] ?? user.role}
          </span>
        </div>
        {canEditCredentials &&
          user.role !== "account" &&
          user.login_name && (
            <div className="ml-11">
              <CredentialResetForm
                loginName={user.login_name}
                userId={user.id}
              />
              {(user.role === "admin" || user.role === "manager") && (
                <DeleteStaffUserForm
                  reportsCount={user.children.length}
                  replacementUsers={replacementUsers}
                  userId={user.id}
                />
              )}
            </div>
          )}
      </div>
      {user.children.length > 0 && (
        <ul className="ml-4 mt-2 space-y-2 border-l border-slate-200 pl-3 sm:ml-5 sm:pl-4">
          {user.children.map((child) => (
            <UserTreeNode
              canEditCredentials={canEditCredentials}
              allUsers={allUsers}
              key={child.id}
              user={child}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
