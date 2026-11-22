"use client";

import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  Database,
  FileCheck2,
  FileText,
  Globe,
  Headset,
  X,
  LayoutDashboard,
  LogOut,
  Menu,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { logoutAction } from "@/app/login/actions";
import { LoadingIcon } from "@/app/components/loading-icon";
import { ThemeSwitch } from "@/app/components/theme-switch";
import { WorkspaceClocks } from "@/app/components/workspace-clocks";
import type { StaffSession } from "@/lib/session";

const roleLabels: Record<StaffSession["role"], string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
};

type NavigationItem = { label: string; href: string; icon: typeof Users };

const overviewItem: NavigationItem = { label: "Overview", href: "/", icon: LayoutDashboard };
const peopleItem: NavigationItem = { label: "People", href: "/users", icon: Users };
const profileItem: NavigationItem = { label: "My profile", href: "/profile", icon: UserRound };
const remoteCompaniesItem: NavigationItem = { label: "Companies", href: "/remote-companies", icon: Globe };

// Pages that show without the sidebar even when signed in: the resume preview is loaded in a frame.
const barePaths = new Set(["/login", "/resume-template"]);

export function WorkspaceShellClient({
  user,
  alert,
  counts = {},
  remoteCompanies = false,
  children,
}: {
  user: StaffSession;
  alert?: ReactNode;
  // A number shown beside a menu item, by its address (e.g. today's interviews).
  counts?: Record<string, number>;
  // Remote companies is in the menu: the Super Admin, or a Manager the Super Admin turned it on for.
  remoteCompanies?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Collapsed, the sidebar is a rail of icons; hovering it (or tabbing into it) slides the full menu
  // out over the page, which does not move. Short delays keep a pointer passing by from opening it.
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function schedulePeek(open: boolean, delay: number) {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setSidebarPeek(open), delay);
  }
  function closePeek() {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setSidebarPeek(false);
  }
  useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current); }, []);
  useEffect(() => {
    if (!sidebarPeek) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closePeek(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarPeek]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSidebarCollapsed(localStorage.getItem("qts-sidebar-collapsed") === "true");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleSidebar() {
    closePeek();
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem("qts-sidebar-collapsed", String(next));
      return next;
    });
  }
  const workspaceItems: NavigationItem[] =
    user.role === "manager"
      ? [
          overviewItem,
          { label: "Jobs", href: "/jobs", icon: BriefcaseBusiness },
          ...(remoteCompanies ? [remoteCompaniesItem] : []),
          { label: "Bids", href: "/bids", icon: FileCheck2 },
          { label: "Interviews", href: "/interviews", icon: CalendarClock },
          { label: "Resume", href: "/pdf", icon: FileText },
          peopleItem,
        ]
      : user.role === "admin"
        ? [overviewItem, peopleItem, { label: "Callers", href: "/callers", icon: Headset }]
        : [overviewItem, peopleItem, ...(remoteCompanies ? [remoteCompaniesItem] : [])];
  const adminItems: NavigationItem[] =
    user.role === "super_admin"
      ? [
          { label: "Categories", href: "/categories", icon: Tags },
          { label: "AI settings", href: "/settings", icon: Settings2 },
          { label: "Gemini usage", href: "/settings/gemini-usage", icon: Activity },
          { label: "Database usage", href: "/settings/database-usage", icon: Database },
          { label: "System guide", href: "/settings/system-guide", icon: BookOpen },
        ]
      : user.role === "manager"
        ? [
            { label: "My AI prompts", href: "/prompts", icon: Sparkles },
            { label: "Useful prompts", href: "/useful-prompts", icon: NotebookPen },
            { label: "Auto Apply settings", href: "/settings", icon: Settings2 },
          ]
        : [];
  const navigationGroups = [
    { label: "Workspace", items: workspaceItems },
    { label: user.role === "super_admin" ? "Administration" : "AI", items: adminItems },
    { label: "Account", items: [profileItem] },
  ].filter((group) => group.items.length > 0);
  const navigation = navigationGroups.flatMap((group) => group.items);
  // The menu item whose address is the longest start of this page's (/users/new → People); Overview only on /.
  const activeHref = navigation
    .map((item) => item.href)
    .filter((href) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0] ?? "";
  const pageLabel = navigation.find((item) => item.href === activeHref)?.label || "Overview";
  const initials = user.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "Q";
  // Managers and admins see two time-zone clocks; Super Admins have their own clock on Gemini usage.
  const showClocks = user.role !== "super_admin";

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

  if (barePaths.has(pathname)) return children;

  return (
    <div className={`workspace-shell ${sidebarCollapsed ? "workspace-shell--collapsed" : ""}`}>
      <a className="workspace-skip" href="#workspace-content">Skip to content</a>
      <header className="workspace-header">
        <div className="workspace-header__location">
          <button aria-controls="workspace-sidebar" aria-expanded={mobileNavigationOpen} aria-label={mobileNavigationOpen ? "Close navigation" : "Open navigation"} className="workspace-icon-button workspace-mobile-toggle" onClick={() => setMobileNavigationOpen((open) => !open)} type="button">
            {mobileNavigationOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="workspace-header__crumbs">
            <span className="workspace-header__eyebrow">{roleLabels[user.role]} workspace</span>
            <span className="workspace-header__page">{pageLabel}</span>
          </span>
        </div>
        {showClocks ? <div className="hidden xl:block"><WorkspaceClocks compact /></div> : null}
        <div className="workspace-header__actions">
          <span className="workspace-status"><span aria-hidden="true" />Connected</span>
          <details className="workspace-account">
            <summary className="workspace-account__trigger">
              <span className="workspace-avatar" aria-hidden="true">{initials}</span>
              <span className="workspace-account__identity"><strong>{user.displayName}</strong><span>{roleLabels[user.role]}</span></span>
              <ChevronDown size={15} className="workspace-account__chevron" aria-hidden="true" />
            </summary>
            <div className="workspace-account__menu">
              <div className="workspace-account__heading"><span className="workspace-avatar" aria-hidden="true">{initials}</span><div><strong>{user.displayName}</strong><span>{roleLabels[user.role]} · @{user.loginName}</span></div></div>
              <Link href="/profile"><UserRound size={16} aria-hidden="true" />My profile</Link>
              <form action={logoutAction}><LogoutButton /></form>
            </div>
          </details>
        </div>
      </header>
      {mobileNavigationOpen && <button className="workspace-backdrop" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)} type="button" />}
      <aside
        id="workspace-sidebar"
        className={`workspace-sidebar ${mobileNavigationOpen ? "workspace-sidebar--open" : ""} ${sidebarCollapsed && sidebarPeek ? "workspace-sidebar--peek" : ""}`}
        onPointerEnter={(event) => { if (sidebarCollapsed && event.pointerType === "mouse") schedulePeek(true, 120); }}
        onPointerLeave={(event) => { if (sidebarCollapsed && event.pointerType === "mouse") schedulePeek(false, 280); }}
        // Keyboard focus only (Tab): a mouse click focuses too, and must not swap the menu under the pointer.
        onFocus={(event) => { if (sidebarCollapsed && (event.target as HTMLElement).matches(":focus-visible")) schedulePeek(true, 0); }}
        onBlur={(event) => { if (sidebarCollapsed && !event.currentTarget.contains(event.relatedTarget as Node | null)) schedulePeek(false, 0); }}
      >
        <div className="workspace-brand-row">
          <Link href="/" className="workspace-brand" aria-label="QTS home" onClick={() => { setMobileNavigationOpen(false); closePeek(); }}>
            <span className="workspace-brand__mark"><BriefcaseBusiness size={19} strokeWidth={2} aria-hidden="true" /></span>
            <span className="workspace-brand__text"><strong>QTS</strong><span>Job workspace</span></span>
          </Link>
          <button type="button" className="workspace-collapse" aria-controls="workspace-sidebar" aria-expanded={!sidebarCollapsed} onClick={toggleSidebar} title={sidebarCollapsed ? "Keep the sidebar open" : "Collapse to icons"} aria-label={sidebarCollapsed ? "Keep the sidebar open" : "Collapse to icons"}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button type="button" className="workspace-drawer-close" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Main navigation" className="workspace-navigation">
          {navigationGroups.map((group) => (
            <div className="workspace-nav-group" key={group.label}>
              <span className="workspace-nav-group__label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeHref === item.href;
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} aria-label={item.label} className={`workspace-nav-link ${active ? "workspace-nav-link--active" : ""}`} onClick={() => { setMobileNavigationOpen(false); closePeek(); }}>
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    <span>{item.label}</span>
                    <NavPending />
                    {counts[item.href] ? (
                      <span className="ml-auto min-w-5 rounded-full bg-indigo-600 px-1.5 text-center text-[11px] font-semibold text-white" title={`${counts[item.href]} today`}>{counts[item.href]}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <ThemeSwitch />
        <Link className="workspace-sidebar__footer" href="/profile" onClick={() => { setMobileNavigationOpen(false); closePeek(); }}>
          <span className="workspace-avatar" aria-hidden="true">{initials}</span>
          <div><strong>{user.displayName}</strong><span>{roleLabels[user.role]}</span></div>
        </Link>
      </aside>
      <div className="workspace-body"><div id="workspace-content" tabIndex={-1} className="workspace-content">
        {/* Below 1280px the header has no room for the clocks, so they stay under it while the page scrolls.
            The Resume page keeps them in its own header instead, since its panels fill the window and never scroll. */}
        {showClocks && pathname !== "/pdf" ? (
          <div className="sticky top-(--header-height) z-30 -mx-1 mb-4 flex justify-center bg-surface/95 px-1 py-2 backdrop-blur xl:hidden">
            <WorkspaceClocks />
          </div>
        ) : null}
        {alert}
        {children}
      </div></div>
    </div>
  );
}

// A small spinner on the menu item just clicked, until its page starts to show.
function NavPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`workspace-nav-pending ${pending ? "is-pending" : ""}`} />;
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
