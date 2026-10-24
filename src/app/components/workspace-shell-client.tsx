"use client";

import {
  Activity,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const pageLabel = navigation.find((item) => item.href === activeHref)?.label || "Overview";
  const initials = user.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "Q";

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileNavigationOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileNavigationOpen]);

  return (
    <div className={`workspace-shell ${sidebarCollapsed ? "workspace-shell--collapsed" : ""}`}>
      <a className="workspace-skip" href="#workspace-content">Skip to content</a>
      <header className="workspace-header">
        <div className="workspace-header__location">
          <button aria-controls="workspace-sidebar" aria-expanded={mobileNavigationOpen} aria-label={mobileNavigationOpen ? "Close navigation" : "Open navigation"} className="workspace-icon-button workspace-mobile-toggle" onClick={() => setMobileNavigationOpen((open) => !open)} type="button">
            {mobileNavigationOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="workspace-header__eyebrow">Workspace</span>
          <ChevronRight className="workspace-header__divider" size={14} aria-hidden="true" />
          <span className="workspace-header__page">{pageLabel}</span>
        </div>
        <div className="workspace-header__actions">
          <span className="workspace-status"><span aria-hidden="true" />Connected</span>
          <details className="workspace-account">
            <summary className="workspace-account__trigger">
              <span className="workspace-avatar" aria-hidden="true">{initials}</span>
              <span className="workspace-account__identity"><strong>{user.displayName}</strong><span>{roleLabels[user.role]}</span></span>
              <ChevronDown size={15} className="workspace-account__chevron" aria-hidden="true" />
            </summary>
            <div className="workspace-account__menu">
              <div className="workspace-account__heading"><strong>{user.displayName}</strong><span>{roleLabels[user.role]} workspace</span></div>
              <Link href="/profile"><UserRound size={16} aria-hidden="true" />My profile</Link>
              <form action={logoutAction}><LogoutButton /></form>
            </div>
          </details>
        </div>
      </header>
      {mobileNavigationOpen && <button className="workspace-backdrop" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)} type="button" />}
      <aside id="workspace-sidebar" className={`workspace-sidebar ${mobileNavigationOpen ? "workspace-sidebar--open" : ""}`}>
        <Link href="/" className="workspace-brand" aria-label="QTS home" onClick={() => setMobileNavigationOpen(false)}>
          <span className="workspace-brand__mark"><BriefcaseBusiness size={22} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="workspace-brand__text"><strong>QTS<span>Workspace</span></strong><span>Your next opportunity.</span></span>
        </Link>
        <div className="workspace-sidebar__section">
          <span>WORKSPACE</span>
          <button type="button" className="workspace-collapse" aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} onClick={toggleSidebar} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <nav aria-label="Main navigation" className="workspace-navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = activeHref === item.href;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} aria-label={item.label} className={`workspace-nav-link ${active ? "workspace-nav-link--active" : ""}`} onClick={() => setMobileNavigationOpen(false)} title={sidebarCollapsed ? item.label : undefined}>
                <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
                <span>{item.label}</span>
                {active && <span className="workspace-nav-link__dot" aria-hidden="true" />}
              </Link>
            );
          })}
        </nav>
        <div className="workspace-sidebar__footer">
          <span className="workspace-footer-avatar" aria-hidden="true">{initials}</span>
          <div><strong>{roleLabels[user.role]} workspace</strong><span>Manage your next move.</span></div>
        </div>
      </aside>
      <div className="workspace-body"><div id="workspace-content" tabIndex={-1} className="workspace-content">{children}</div></div>
    </div>
  );
}

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button className="workspace-logout" disabled={pending} type="submit">
      {pending ? <LoadingIcon className="size-4" /> : <LogOut size={16} aria-hidden="true" />}
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
