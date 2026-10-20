import {
  Activity,
  BriefcaseBusiness,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";
import type { StaffSession } from "@/lib/session";

const roleLabels: Record<StaffSession["role"], string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
};

const baseNavigation = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "People", href: "/users", icon: Users },
  { label: "My profile", href: "/profile", icon: UserRound },
];

export function WorkspaceShell({
  user,
  activeHref,
  children,
}: {
  user: StaffSession;
  activeHref: string;
  children: ReactNode;
}) {
  const navigation = [
    ...baseNavigation.slice(0, 2),
    ...(user.role === "super_admin"
      ? [
          { label: "Categories", href: "/categories", icon: Tags },
          { label: "AI settings", href: "/settings", icon: Settings2 },
          { label: "Gemini usage", href: "/settings/gemini-usage", icon: Activity },
        ]
      : user.role === "manager"
        ? [{ label: "My AI prompt", href: "/prompts", icon: BriefcaseBusiness }]
        : []),
    baseNavigation[2],
  ];
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-6" href="/">
          <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm shadow-indigo-200">
            q
          </span>
          <span className="text-lg font-bold tracking-tight">
            qts<span className="text-indigo-600">.</span>
          </span>
        </Link>

        <div className="mx-4 mt-5 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
            {initials || "Q"}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{user.displayName}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {roleLabels[user.role]}
            </span>
          </span>
        </div>

        <nav aria-label="Main navigation" className="px-3 pt-7">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <div className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = activeHref === item.href ||
                (item.href === "/settings" && activeHref === "/settings/gemini-usage");
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${
                    active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="size-[18px]" strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <form action={logoutAction} className="mt-auto border-t border-slate-100 p-4">
          <button
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-700"
            type="submit"
          >
            <LogOut className="size-[18px]" />
            Sign out
          </button>
        </form>
      </aside>

      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-[68px] items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-7">
          <Link className="flex items-center gap-2.5 lg:hidden" href="/">
            <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              q
            </span>
            <span className="font-bold tracking-tight">
              qts<span className="text-indigo-600">.</span>
            </span>
          </Link>
          <p className="hidden text-sm font-medium text-slate-500 lg:block">
            {navigation.find((item) => item.href === activeHref)?.label ?? "Workspace"}
          </p>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-right sm:block">
              <span className="block text-sm font-semibold">{user.displayName}</span>
              <span className="block text-xs text-slate-500">@{user.loginName}</span>
            </span>
            <span className="flex size-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
              {initials || "Q"}
            </span>
            <details className="relative lg:hidden">
              <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <span className="sr-only">Open navigation</span>
                <Menu aria-hidden="true" className="size-4" />
              </summary>
              <div className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                {navigation.map((item) => {
                  const Icon = item.icon;
                  const active =
                    activeHref === item.href ||
                    (item.href === "/settings" &&
                      activeHref === "/settings/gemini-usage");
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                        active
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                      href={item.href}
                      key={item.href}
                    >
                      <Icon className="size-[18px]" />
                      {item.label}
                    </Link>
                  );
                })}
                <form action={logoutAction} className="mt-1 border-t border-slate-100 pt-1">
                  <button className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-rose-700 hover:bg-rose-50" type="submit">
                    <LogOut className="size-[18px]" />
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
