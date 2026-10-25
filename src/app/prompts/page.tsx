import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { ManagerOwnPromptForm } from "@/app/settings/prompt-forms";
import {
  categories,
  managerPromptAssignments,
  managerPromptOverrides,
  prompts,
  settings,
} from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

export default async function ManagerPromptsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const [modeRows, assignedPrompts, ownRows] = await Promise.all([
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "prompt_mode"))
      .limit(1),
    db
      .select({
        id: prompts.id,
        name: prompts.name,
        promptTemplate: prompts.promptTemplate,
        version: prompts.version,
        categoryName: categories.name,
      })
      .from(managerPromptAssignments)
      .innerJoin(prompts, eq(prompts.id, managerPromptAssignments.promptId))
      .leftJoin(categories, eq(categories.id, prompts.categoryId))
      .where(eq(managerPromptAssignments.managerId, currentUser.id))
      .orderBy(asc(categories.name), asc(prompts.name)),
    db
      .select({ promptTemplate: managerPromptOverrides.promptTemplate })
      .from(managerPromptOverrides)
      .where(eq(managerPromptOverrides.managerId, currentUser.id))
      .limit(1),
  ]);

  // In "private" mode Managers may read the prompts assigned to them; otherwise only their names.
  const showAssignedText = modeRows[0]?.value === "private";
  const ownPrompt = ownRows[0]?.promptTemplate ?? null;
  const isAssigned = assignedPrompts.length > 0;

  return (
    <WorkspaceShell activeHref="/prompts" user={currentUser}>
      <main className="py-1 text-slate-900">
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader
            description="Generation uses the prompts your Super Admin assigns to you for each candidate category, in rotation. Without assignments, it uses your own prompt."
            title="My AI prompt"
          />

          {isAssigned ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-semibold text-slate-800">
                Assigned prompts
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {assignedPrompts.length === 1
                  ? "Generation uses this prompt for candidates in its category. Your own prompt is not used while it is assigned."
                  : "Each candidate gets the prompts for their category, in rotation. Candidates in a category with no prompt here cannot be generated. Your own prompt is not used while prompts are assigned."}
              </p>
              <div className="mt-5 space-y-5">
                {assignedPrompts.map((prompt) => (
                  <div key={prompt.id}>
                    <h3 className="text-xs font-semibold text-slate-800">
                      {prompt.name}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {prompt.categoryName ?? "No category (not used)"} · Version {prompt.version}
                    </p>
                    {showAssignedText && (
                      <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-700">
                        {prompt.promptTemplate}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : !ownPrompt && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Write and save your prompt below. Generation cannot start until you do.
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800">My prompt</h2>
            <p className="mb-4 mt-1 text-xs text-slate-500">
              {isAssigned
                ? "Kept for when no prompts are assigned to you."
                : "Generation uses this prompt for every resume and cover letter."}
            </p>
            <ManagerOwnPromptForm promptTemplate={ownPrompt} />
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
