import {
  Activity,
  BriefcaseBusiness,
  ChevronDown,
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
  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#212529]">
      <header className="fixed inset-x-0 top-0 z-40 flex h-[72px] items-center justify-between bg-[#212529] px-4 text-white shadow-sm sm:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <details className="relative">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-white/20 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Open navigation</span>
              <Menu aria-hidden="true" className="size-4" />
            </summary>
            <nav
              aria-label="Main navigation"
              className="absolute left-0 top-12 z-50 w-64 rounded-md border border-[#343a40] bg-[#212529] p-2 shadow-xl"
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
          <Link className="truncate text-base font-bold text-white" href="/">
            Jobs
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 text-xs text-white sm:flex">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#20c975]" />
            Connected
          </span>
          <details className="relative">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-white/20 px-2.5 text-sm text-white hover:bg-white/5 [&::-webkit-details-marker]:hidden sm:px-3">
              <UserRound aria-hidden="true" className="size-4 shrink-0" />
              <span className="max-w-24 truncate sm:max-w-32">{user.displayName}</span>
              <span className="rounded-full bg-[#0d6efd]/30 px-2 py-1 text-[10px] font-semibold text-[#9ec5fe]">
                {roleLabels[user.role]}
              </span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
            </summary>
            <div className="absolute right-0 top-12 z-50 min-w-48 rounded-md border border-[#343a40] bg-[#212529] p-2 shadow-xl">
              <Link
                className="flex min-h-10 items-center gap-3 rounded px-3 text-sm text-white/75 hover:bg-white/10 hover:text-white"
                href="/profile"
              >
                <UserRound className="size-4" />
                My profile
              </Link>
              <form action={logoutAction} className="mt-2 border-t border-white/10 pt-2">
                <button className="flex min-h-10 w-full items-center gap-3 rounded px-3 text-sm text-white/75 hover:bg-white/10 hover:text-white" type="submit">
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <div className="min-h-screen pt-[72px]">
        <div className="mx-auto min-h-[calc(100vh-4.5rem)] max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}
