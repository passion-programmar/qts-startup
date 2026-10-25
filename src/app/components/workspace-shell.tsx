import type { ReactNode } from "react";
import { WorkspaceShellClient } from "@/app/components/workspace-shell-client";
import type { StaffSession } from "@/lib/session";

export async function WorkspaceShell({
  user,
  activeHref,
  children,
}: {
  user: StaffSession;
  activeHref: string;
  children: ReactNode;
}) {
  return (
    <WorkspaceShellClient activeHref={activeHref} user={user}>
      {children}
    </WorkspaceShellClient>
  );
}
