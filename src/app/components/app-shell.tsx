import { AlertOctagon, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { WorkspaceShellClient } from "@/app/components/workspace-shell-client";
import { dismissAlertsAction } from "@/app/settings/database-usage/actions";
import { getCurrentUser } from "@/lib/session";
import { countTodayInterviews } from "@/server/interviews/interviews-list";
import { canViewRemoteCompanies } from "@/server/remote-companies/remote-companies";
import { appLevels, type BannerLevels, readBannerLevels, readSavedState, scheduleDailyCleanup } from "@/server/database/database-usage";
import { levelRank, quotasToAlert } from "@/server/database/database-usage-values";

const QUOTA_NAMES = { storage: "Storage", compute: "Compute", transfer: "Network transfer" } as const;
const LEVEL_NAMES = { ok: "OK", warning: "warning", high: "high", critical: "critical", reached: "limit reached" } as const;

/**
 * The sidebar and top bar, drawn once in the root layout so they stay on screen while pages change;
 * only the content area shows a loading skeleton. Signed out, pages (the sign-in page) show bare.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return children;

  // Super Admin is warned on every page when a database quota passes a level, from what the last
  // Check quota or clean-up saved (no measuring here). Dismiss hides it until a level gets worse.
  // A Manager sees today's interview count beside Interviews (one small indexed count). It updates
  // when a page reloads or an interview is saved. Remote companies shows for a Manager the Super
  // Admin turned it on for (one small lookup at the same time; a failure only hides the item).
  // The day's clean-up and quota check (once a Romania day, after the page is sent, never slowing it),
  // so the warning is current even on a day nobody uses the extension.
  scheduleDailyCleanup();
  const seesDatabaseWarning = user.role === "super_admin" || user.role === "manager";
  // The bar reads only the levels the last quota check saved (one small row, 2026-11-28); before the
  // first such check, Super Admin's bar works from the whole saved state as before.
  const bannerLevels = async (): Promise<BannerLevels | null> => {
    const saved = await readBannerLevels();
    if (saved || user.role !== "super_admin") return saved;
    const state = await readSavedState();
    return { levels: appLevels(state), dismissed: state.dismissed };
  };
  const [state, todayInterviews, remoteCompanies] = await Promise.all([
    seesDatabaseWarning ? bannerLevels().catch(() => null) : null,
    user.role === "manager" ? countTodayInterviews(user.id).catch(() => 0) : 0,
    user.role === "manager" ? canViewRemoteCompanies(user).catch(() => false) : user.role === "super_admin",
  ]);
  const levels = state ? state.levels : {};
  // Super Admin: from the first level, until dismissed. A Manager (2026-11-28): from "high" on, not
  // dismissable, without the Super Admin page link, so the people using the database know to slow down.
  const isSuperAdmin = user.role === "super_admin";
  const alerts = !state ? [] : isSuperAdmin
    ? quotasToAlert(levels, state.dismissed)
    : (Object.keys(levels) as (keyof typeof levels)[]).filter((key) => levelRank(levels[key] ?? "ok") >= levelRank("high"));
  const severe = alerts.some((key) => levelRank(levels[key] ?? "ok") >= levelRank("critical"));
  const alert = alerts.length > 0 ? (
    <div
      className={`mb-4 flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ring-1 ${
        severe ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200"
      }`}
      role="alert"
    >
      {severe ? <AlertOctagon className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        Database: {alerts.map((key) => `${QUOTA_NAMES[key]} ${LEVEL_NAMES[levels[key] ?? "ok"]}`).join(", ")}.{" "}
        {isSuperAdmin ? (
          <Link className="underline underline-offset-2" href="/settings/database-usage">See what to do</Link>
        ) : severe ? (
          "This month's free database limit is almost used: do only important work until the 1st."
        ) : (
          "Most of this month's free database limit is used: avoid leaving QTS working when nobody needs it."
        )}
      </span>
      {isSuperAdmin ? (
        <form action={dismissAlertsAction}>
          <button className="rounded-lg px-2 py-1 font-semibold hover:bg-white/60" type="submit">Dismiss</button>
        </form>
      ) : null}
    </div>
  ) : null;

  return (
    <WorkspaceShellClient alert={alert} counts={{ "/interviews": todayInterviews }} remoteCompanies={remoteCompanies} user={user}>
      {children}
    </WorkspaceShellClient>
  );
}
