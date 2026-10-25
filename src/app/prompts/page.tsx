import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { managerPromptAssignments, prompts, settings } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

export default async function ManagerPromptsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const [modeRows, assignedRows] = await Promise.all([
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "prompt_mode"))
      .limit(1),
    db
      .select({
        name: prompts.name,
        promptTemplate: prompts.promptTemplate,
        version: prompts.version,
      })
      .from(managerPromptAssignments)
      .innerJoin(prompts, eq(prompts.id, managerPromptAssignments.promptId))
      .where(eq(managerPromptAssignments.managerId, currentUser.id))
      .limit(1),
  ]);

  if (modeRows[0]?.value !== "private") redirect("/jobs");
  const assignedPrompt = assignedRows[0];

  return (
    <WorkspaceShell activeHref="/prompts" user={currentUser}>
      <main className="py-1 text-slate-900">
        <div className="mx-auto max-w-4xl">
          <PageHeader
            description="This saved prompt is selected and managed by your Super Admin."
            title="My AI prompt"
          />

          {assignedPrompt ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-base font-semibold text-slate-800">
                {assignedPrompt.name}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Resume and cover-letter generation · Version {assignedPrompt.version}
              </p>
              <pre className="mt-5 max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-700">
                {assignedPrompt.promptTemplate}
              </pre>
            </section>
          ) : (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              No prompt is assigned yet. Ask your Super Admin to assign a saved
              document-generation prompt.
            </section>
          )}
        </div>
      </main>
    </WorkspaceShell>
  );
}
