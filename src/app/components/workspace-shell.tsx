import { AlertOctagon, AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { WorkspaceShellClient } from "@/app/components/workspace-shell-client";
import { dismissAlertsAction } from "@/app/settings/database-usage/actions";
import type { StaffSession } from "@/lib/session";
import { appLevels, readSavedState } from "@/server/database/database-usage";
import { levelRank, quotasToAlert } from "@/server/database/database-usage-values";

const QUOTA_NAMES = { storage: "Storage", compute: "Compute", transfer: "Network transfer" } as const;
const LEVEL_NAMES = { ok: "OK", warning: "warning", high: "high", critical: "critical", reached: "limit reached" } as const;

export async function WorkspaceShell({
  user,
  activeHref,
  children,
}: {
  user: StaffSession;
  activeHref: string;
  children: ReactNode;
}) {
  // Super Admin is warned on every page when a database quota passes a level, from what the last
  // Check quota or clean-up saved (no measuring here). Dismiss hides it until a level gets worse.
  const state = user.role === "super_admin" ? await readSavedState().catch(() => null) : null;
  const levels = state ? appLevels(state) : {};
  const alerts = state ? quotasToAlert(levels, state.dismissed) : [];
  const severe = alerts.some((key) => levelRank(levels[key] ?? "ok") >= levelRank("critical"));
  return (
    <WorkspaceShellClient activeHref={activeHref} user={user}>
      {alerts.length > 0 && (
        <div
          className={`mb-4 flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ring-1 ${
            severe ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-amber-50 text-amber-700 ring-amber-200"
          }`}
          role="alert"
        >
          {severe ? <AlertOctagon className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1">
            Database: {alerts.map((key) => `${QUOTA_NAMES[key]} ${LEVEL_NAMES[levels[key] ?? "ok"]}`).join(", ")}.{" "}
            <Link className="underline underline-offset-2" href="/settings/database-usage">See what to do</Link>
          </span>
          <form action={dismissAlertsAction}>
            <button className="rounded-lg px-2 py-1 font-semibold hover:bg-white/60" type="submit">Dismiss</button>
          </form>
        </div>
      )}
      {children}
    </WorkspaceShellClient>
  );
}
