"use client";

// Everyone below the viewer as a tree (2026-11-28): each Admin with their Managers, each Manager with
// their candidates (closed until clicked). Used by the Super Admin / Admin Overview and People pages.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Badge } from "@/app/ui/badge";
import { cn } from "@/app/ui/cn";

export type PeopleTreeUser = {
  id: string;
  role: string;
  parentId: string | null;
  name: string;
  login: string | null;
  email: string | null;
  category: string | null;
  blocked: boolean;
  deleted?: boolean;
};

const byName = (a: PeopleTreeUser, b: PeopleTreeUser) => a.name.localeCompare(b.name);

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
}

function Avatar({ name, tone }: { name: string; tone: "admin" | "manager" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        tone === "admin" ? "size-9 bg-primary text-xs text-white" : "size-8 bg-primary-soft text-[11px] text-primary-text",
      )}
    >
      {initials(name)}
    </span>
  );
}

function StaffName({ user }: { user: PeopleTreeUser }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="truncate font-semibold text-fg">{user.name}</span>
        {user.blocked ? <Badge tone="danger">Blocked</Badge> : null}
      </span>
      <span className="block truncate text-xs text-fg-muted">{user.login ? `@${user.login}` : "No login name"}</span>
    </span>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

/** profileLinks: candidate names open their profile in a new tab (the Super Admin's read-only view). */
export function PeopleTree({
  users,
  actions = {},
  profileLinks = false,
}: {
  users: PeopleTreeUser[];
  actions?: Record<string, ReactNode>;
  profileLinks?: boolean;
}) {
  const children = new Map<string, PeopleTreeUser[]>();
  for (const user of users) {
    if (!user.parentId) continue;
    const list = children.get(user.parentId) ?? [];
    list.push(user);
    children.set(user.parentId, list);
  }
  const below = (id: string, role: string) => (children.get(id) ?? []).filter((user) => user.role === role).sort(byName);
  const admins = users.filter((user) => user.role === "admin").sort(byName);
  const adminIds = new Set(admins.map((admin) => admin.id));
  const managerIds = new Set(users.filter((user) => user.role === "manager").map((user) => user.id));
  // Managers not under a listed Admin (created by the Super Admin) and candidates without a listed Manager.
  const looseManagers = users.filter((user) => user.role === "manager" && !(user.parentId && adminIds.has(user.parentId))).sort(byName);
  const looseCandidates = users.filter((user) => user.role === "account" && !(user.parentId && managerIds.has(user.parentId))).sort(byName);

  if (!admins.length && !looseManagers.length && !looseCandidates.length) {
    return <p className="px-6 py-12 text-center text-sm text-fg-muted">No people yet</p>;
  }

  const managerRows = (managers: PeopleTreeUser[]) => (
    <ul className="space-y-1">
      {managers.map((manager) => (
        <ManagerRow action={actions[manager.id]} candidates={below(manager.id, "account")} key={manager.id} manager={manager} profileLinks={profileLinks} />
      ))}
    </ul>
  );

  return (
    <div className="divide-y divide-line">
      {admins.map((admin) => {
        const managers = below(admin.id, "manager");
        const candidateCount = managers.reduce((sum, manager) => sum + below(manager.id, "account").length, 0);
        return (
          <Group
            action={actions[admin.id]}
            header={<StaffName user={admin} />}
            key={admin.id}
            meta={`${plural(managers.length, "manager")} · ${plural(candidateCount, "candidate")}`}
            name={admin.name}
            role="Admin"
          >
            {managers.length ? managerRows(managers) : <p className="py-2 text-sm text-fg-muted">No managers yet</p>}
          </Group>
        );
      })}
      {looseManagers.length ? (
        <Group meta={plural(looseManagers.length, "manager")} title="Managers without an Admin">
          {managerRows(looseManagers)}
        </Group>
      ) : null}
      {looseCandidates.length ? (
        <Group meta={plural(looseCandidates.length, "candidate")} title="Candidates without a listed Manager">
          <CandidateList candidates={looseCandidates} profileLinks={profileLinks} />
        </Group>
      ) : null}
    </div>
  );
}

// An Admin (or a group without one) with what sits under it; open at first.
function Group({
  header,
  title,
  name,
  role,
  meta,
  action,
  children,
}: {
  header?: ReactNode;
  title?: string;
  name?: string;
  role?: string;
  meta: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          aria-expanded={open}
          aria-label={open ? `Hide ${name ?? title}` : `Show ${name ?? title}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition hover:bg-line-soft hover:text-fg"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
        </button>
        {header && name ? <Avatar name={name} tone="admin" /> : null}
        <div className="min-w-0 flex-1">
          {header ?? <span className="text-sm font-semibold text-fg-soft">{title}</span>}
        </div>
        {role ? <Badge tone="primary">{role}</Badge> : null}
        <span className="text-xs tabular-nums text-fg-muted">{meta}</span>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {open ? <div className="mt-2 ml-3.5 border-l border-line pl-5 sm:ml-[1.4rem]">{children}</div> : null}
    </section>
  );
}

// A Manager with a button that opens their candidates.
function ManagerRow({
  manager,
  candidates,
  action,
  profileLinks,
}: {
  manager: PeopleTreeUser;
  candidates: PeopleTreeUser[];
  action?: ReactNode;
  profileLinks: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = candidates.filter((candidate) => !candidate.blocked && !candidate.deleted).length;
  const inactive = candidates.length - active;
  return (
    <li className="rounded-xl transition-colors hover:bg-subtle">
      <div className="flex flex-wrap items-center gap-3 px-2 py-2">
        <Avatar name={manager.name} tone="manager" />
        <div className="min-w-0 flex-1">
          <StaffName user={manager} />
        </div>
        <Badge>Manager</Badge>
        <button
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
            open ? "border-primary-ring bg-primary-soft text-primary-text" : "border-line text-fg-soft hover:bg-line-soft",
            !candidates.length && "pointer-events-none opacity-60",
          )}
          disabled={!candidates.length}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? <ChevronDown aria-hidden="true" className="size-3.5" /> : <ChevronRight aria-hidden="true" className="size-3.5" />}
          {plural(candidates.length, "candidate")}
          {candidates.length ? (
            <span className="font-normal text-fg-muted">
              <span className="text-success-text">{active} active</span>
              {inactive ? <> · {inactive} inactive</> : null}
            </span>
          ) : null}
        </button>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {open ? (
        <div className="pb-2 pl-11 pr-2">
          <CandidateList candidates={candidates} profileLinks={profileLinks} />
        </div>
      ) : null}
    </li>
  );
}

function CandidateList({ candidates, profileLinks }: { candidates: PeopleTreeUser[]; profileLinks: boolean }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
      {candidates.map((candidate) => (
        <li className="grid grid-cols-1 gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3" key={candidate.id}>
          {profileLinks ? (
            <a
              className={cn("inline-flex min-w-0 items-center gap-1.5 font-medium hover:text-primary-text hover:underline", candidate.blocked || candidate.deleted ? "text-fg-muted" : "text-fg")}
              href={`/users/${candidate.id}/edit`}
              rel="noopener"
              target="_blank"
              title="Open the profile (view only) in a new tab"
            >
              <span className="truncate">{candidate.name}</span>
              <ExternalLink aria-hidden="true" className="size-3 shrink-0 opacity-60" />
            </a>
          ) : (
            <span className={cn("truncate font-medium", candidate.blocked || candidate.deleted ? "text-fg-muted" : "text-fg")}>{candidate.name}</span>
          )}
          <span className="truncate text-xs text-fg-muted">{candidate.email || "No email"}</span>
          <span className="truncate text-xs text-fg-muted">{candidate.category || "Global"}</span>
          <span className="justify-self-start sm:justify-self-end">
            {candidate.deleted ? (
              <Badge tone="danger">Deleted</Badge>
            ) : candidate.blocked ? (
              <Badge dot>Inactive</Badge>
            ) : (
              <Badge dot tone="success">Active</Badge>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
