import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { WorkspaceShellClient } from "@/app/components/workspace-shell-client";
import { settings } from "@/db/schema";
import { db } from "@/lib/db";
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
  const modeRows =
    user.role === "manager"
      ? await db
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, "prompt_mode"))
          .limit(1)
      : [];

  return (
    <WorkspaceShellClient
      activeHref={activeHref}
      managerPromptEnabled={modeRows[0]?.value === "private"}
      user={user}
    >
      {children}
    </WorkspaceShellClient>
  );
}
