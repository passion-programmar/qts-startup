import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ManagerPromptForm } from "@/app/settings/prompt-forms";
import {
  managerPromptAssignments,
  managerPromptOverrides,
  prompts,
  settings,
} from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { WorkspaceShell } from "@/app/components/workspace-shell";

export const instant = false;

export default async function ManagerPromptsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const [modeRows, globalPromptRows, overrideRows, assignmentRows] =
    await Promise.all([
      db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, "prompt_mode"))
        .limit(1),
      db
        .select({ promptTemplate: prompts.promptTemplate })
        .from(prompts)
        .where(
          and(
            eq(prompts.provider, "openai"),
            eq(prompts.purpose, "document_generation"),
            eq(prompts.isActive, true),
            eq(prompts.isDefault, true),
          ),
        )
        .limit(1),
      db
        .select({ promptTemplate: managerPromptOverrides.promptTemplate })
        .from(managerPromptOverrides)
        .where(eq(managerPromptOverrides.managerId, currentUser.id))
        .limit(1),
      db
        .select({ name: prompts.name })
        .from(managerPromptAssignments)
        .innerJoin(prompts, eq(prompts.id, managerPromptAssignments.promptId))
        .where(eq(managerPromptAssignments.managerId, currentUser.id))
        .limit(1),
    ]);

  const privateMode = modeRows[0]?.value === "private";
  const defaultPrompt = globalPromptRows[0]?.promptTemplate;
  const assignedPromptName = assignmentRows[0]?.name ?? null;
  const savedPrivatePrompt = overrideRows[0]?.promptTemplate;

  return (
    <WorkspaceShell activeHref="/prompts" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <header className="mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My AI prompt</h1>
          </div>
        </header>

        {!privateMode ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800">
              Global prompt active
              {assignedPromptName ? ` · ${assignedPromptName}` : ""}
            </h2>
          </section>
        ) : defaultPrompt ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold text-slate-800">
                Private ChatGPT prompt
              </h2>
            </div>
            <ManagerPromptForm
              assignedPromptName={assignedPromptName}
              promptTemplate={savedPrivatePrompt ?? defaultPrompt}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Global ChatGPT prompt not configured
          </section>
        )}
      </div>
    </main>
    </WorkspaceShell>
  );
}
