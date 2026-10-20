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
    <div className="min-h-screen bg-[#f8f9fa] text-[#212529]">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between bg-[#212529] px-4 text-white shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <details className="relative lg:hidden">
            <summary className="flex size-9 cursor-pointer list-none items-center justify-center rounded text-white/75 hover:bg-white/10 hover:text-white">
              <span className="sr-only">Open navigation</span>
              <Menu aria-hidden="true" className="size-5" />
            </summary>
            <nav
              aria-label="Main navigation"
              className="absolute left-0 top-11 z-50 w-64 rounded border border-[#343a40] bg-[#212529] p-2 shadow-xl"
            >
              {navigation.map((item) => {
                const Icon = item.icon;
                const active =
                  activeHref === item.href ||
                  (item.href === "/settings" &&
                    activeHref === "/settings/gemini-usage");
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-10 items-center gap-3 rounded px-3 text-sm ${
                      active
                        ? "bg-[#0d6efd] text-white"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
              <form action={logoutAction} className="mt-2 border-t border-white/10 pt-2">
                <button className="flex min-h-10 w-full items-center gap-3 rounded px-3 text-sm text-white/70 hover:bg-white/10 hover:text-white" type="submit">
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </form>
            </nav>
          </details>
          <Link className="truncate text-base font-semibold text-white" href="/">
            QTS Job System
          </Link>
          <span className="hidden border-l border-white/20 pl-3 text-sm text-white/60 sm:block">
            {navigation.find((item) => item.href === activeHref)?.label ??
              "Workspace"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex size-8 items-center justify-center rounded-full bg-[#0d6efd] text-xs font-semibold text-white">
            {initials || "Q"}
          </span>
          <span className="hidden max-w-48 truncate text-white/85 sm:block">
            {user.displayName}
          </span>
        </div>
      </header>

      <aside className="fixed inset-y-14 left-0 z-30 hidden w-56 flex-col bg-[#212529] text-white lg:flex">
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Workspace
          </p>
          <div className="space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active =
                activeHref === item.href ||
                (item.href === "/settings" &&
                  activeHref === "/settings/gemini-usage");
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-10 items-center gap-3 rounded px-3 text-[13px] transition ${
                    active
                      ? "bg-[#0d6efd] text-white"
                      : "text-white/65 hover:bg-white/10 hover:text-white"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="size-4" strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <div className="truncate text-xs font-medium text-white/85">
            {user.displayName}
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            {roleLabels[user.role]}
          </div>
          <form action={logoutAction} className="mt-3">
            <button className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-xs text-white/60 hover:bg-white/10 hover:text-white" type="submit">
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-h-screen pt-14 lg:pl-56">
        <div className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}
