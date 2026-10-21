import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PdfWorkspace } from "@/app/pdf/pdf-workspace";
import { requireUser } from "@/lib/session";
import { profiles, users } from "@/db/schema";
import { db } from "@/lib/db";

export const instant = false;

export default async function PdfPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  const accounts = await db
    .select({
      id: profiles.userId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      pdfTemplate: profiles.pdfTemplate,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        eq(users.parentUserId, currentUser.id),
        eq(users.role, "account"),
        isNull(users.blockedAt),
      ),
    )
    .orderBy(asc(profiles.firstName), asc(profiles.lastName));
  return (
    <WorkspaceShell activeHref="/pdf" user={currentUser}>
      <PdfWorkspace
        managerName={currentUser.displayName}
        accounts={accounts.map((account) => ({
          id: account.id,
          fullName:
            [account.firstName, account.lastName].filter(Boolean).join(" ") ||
            "Candidate",
          pdfTemplate: account.pdfTemplate as "professional" | "modern" | "compact",
        }))}
      />
    </WorkspaceShell>
  );
}
