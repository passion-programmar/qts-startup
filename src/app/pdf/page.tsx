import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PdfWorkspace } from "@/app/pdf/pdf-workspace";
import { requireUser } from "@/lib/session";
import { loadTemplateStyles } from "@/server/pdf/template-styles";

export const instant = false;

export const metadata: Metadata = {
  title: "Resume",
};

export default async function PdfPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  // The Manager's saved template styles: the layout settings start from them.
  const savedStyles = await loadTemplateStyles(currentUser.id);
  return (
    <WorkspaceShell activeHref="/pdf" user={currentUser}>
      <PdfWorkspace managerName={currentUser.displayName} savedStyles={savedStyles} />
    </WorkspaceShell>
  );
}
