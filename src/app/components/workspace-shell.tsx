import type { ReactNode } from "react";
import type { StaffSession } from "@/lib/session";

/**
 * The sidebar and top bar now come from the root layout (AppShell), so this only passes the page
 * through. Pages still wrap themselves in it until each one is rebuilt (docs/ui-rebuild-plan.md).
 */
export function WorkspaceShell({ children }: { user: StaffSession; activeHref: string; children: ReactNode }) {
  return children;
}
