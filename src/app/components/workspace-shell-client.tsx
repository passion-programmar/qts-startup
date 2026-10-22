"use client";

import {
  Activity,
  BriefcaseBusiness,
  ChevronDown,
  FileCheck2,
  FileText,
  X,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { logoutAction } from "@/app/login/actions";
import { LoadingIcon } from "@/app/components/loading-icon";
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

export function WorkspaceShellClient({
  user,
  activeHref,
  managerPromptEnabled,
  children,
}: {
  user: StaffSession;
  activeHref: string;
  managerPromptEnabled: boolean;
  children: ReactNode;
}) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSidebarCollapsed(localStorage.getItem("qts-sidebar-collapsed") === "true");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem("qts-sidebar-collapsed", String(next));
      return next;
    });
  }
  const navigation = [
    ...(user.role === "manager"
      ? [
          { label: "Jobs", href: "/jobs", icon: BriefcaseBusiness },
          { label: "Bids", href: "/bids", icon: FileCheck2 },
          { label: "PDF", href: "/pdf", icon: FileText },
          baseNavigation[1],
        ]
      : baseNavigation.slice(0, 2)),
    ...(user.role === "super_admin"
      ? [
          { label: "Categories", href: "/categories", icon: Tags },
          { label: "AI settings", href: "/settings", icon: Settings2 },
          { label: "Gemini usage", href: "/settings/gemini-usage", icon: Activity },
        ]
      : user.role === "manager" && managerPromptEnabled
        ? [{ label: "My AI prompt", href: "/prompts", icon: BriefcaseBusiness }]
        : []),
    baseNavigation[2],
  ];
  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#212529]">
      <header className="fixed inset-x-0 top-0 z-40 flex h-[72px] items-center justify-between bg-[#212529] px-4 text-white shadow-sm sm:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <button
            aria-controls="workspace-sidebar"
            aria-expanded={mobileNavigationOpen}
            aria-label={mobileNavigationOpen ? "Close navigation" : "Open navigation"}
            className="flex size-10 items-center justify-center rounded-md border border-white/20 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMobileNavigationOpen((open) => !open)}
            type="button"
          >
            {mobileNavigationOpen ? (
              <X aria-hidden="true" className="size-4" />
            ) : (
              <Menu aria-hidden="true" className="size-4" />
            )}
          </button>
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
                <LogoutButton />
              </form>
            </div>
          </details>
        </div>
      </header>

      {mobileNavigationOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-x-0 bottom-0 top-[72px] z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileNavigationOpen(false)}
          type="button"
        />
      )}
      <aside
        className={`invisible fixed bottom-0 left-0 top-[72px] z-50 flex w-60 -translate-x-full flex-col bg-[#050819] text-white shadow-xl transition-[width,transform] duration-200 lg:visible lg:translate-x-0 ${
          sidebarCollapsed ? "lg:w-16" : "lg:w-60"
        } ${
          mobileNavigationOpen ? "visible translate-x-0" : ""
        }`}
        id="workspace-sidebar"
      >
        <div className={`hidden border-b border-white/10 p-2 lg:flex ${sidebarCollapsed ? "justify-center" : "justify-end"}`}>
          <button
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex size-9 items-center justify-center rounded-md text-slate-300 transition hover:bg-white/10 hover:text-white"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2.5 py-3">
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
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3.5 text-sm transition-colors ${
                    sidebarCollapsed ? "lg:justify-center lg:px-0" : ""
                  } ${
                    active
                      ? "bg-[#0d6efd] font-medium text-white shadow-sm"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                  href={item.href}
                  key={item.href}
                  onClick={() => setMobileNavigationOpen(false)}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                  <span className={sidebarCollapsed ? "lg:hidden" : undefined}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>

      <div className={`min-h-screen pt-[72px] transition-[padding] duration-200 ${sidebarCollapsed ? "lg:pl-16" : "lg:pl-60"}`}>
        <div className="mx-auto min-h-[calc(100vh-4.5rem)] max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="flex min-h-10 w-full items-center gap-3 rounded px-3 text-sm text-white/75 hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? <LoadingIcon className="size-4" /> : <LogOut className="size-4" />}
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
