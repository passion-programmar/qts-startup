import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GlobalPromptForm, PromptAssignmentForm, PromptModeForm } from "@/app/settings/prompt-forms";
import {
  managerPromptAssignments,
  prompts,
  settings,
  users,
} from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

const promptGroups = [
  {
    provider: "openai",
    purpose: "document_generation",
    heading: "ChatGPT · Resume and cover-letter generation",
  },
  {
    provider: "gemini",
    purpose: "job_description_evaluation",
    heading: "Gemini · Job-description evaluation",
  },
  {
    provider: "gemini",
    purpose: "application_answer",
    heading: "Gemini · Application-answer generation",
  },
] as const;

export default async function SettingsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "super_admin") redirect("/");

  const [modeRows, activePrompts, managerRows] = await Promise.all([
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "prompt_mode"))
      .limit(1),
    db
      .select({
        id: prompts.id,
        promptGroupId: prompts.promptGroupId,
        provider: prompts.provider,
        purpose: prompts.purpose,
        name: prompts.name,
        promptTemplate: prompts.promptTemplate,
        version: prompts.version,
        isDefault: prompts.isDefault,
      })
      .from(prompts)
      .where(eq(prompts.isActive, true))
      .orderBy(asc(prompts.provider), asc(prompts.purpose), asc(prompts.name)),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        loginName: users.loginName,
        assignedPromptName: prompts.name,
      })
      .from(users)
      .leftJoin(
        managerPromptAssignments,
        eq(managerPromptAssignments.managerId, users.id),
      )
      .leftJoin(prompts, eq(prompts.id, managerPromptAssignments.promptId))
      .where(
        and(eq(users.role, "manager"), isNull(users.blockedAt)),
      )
      .orderBy(asc(users.displayName), asc(users.loginName)),
  ]);

  const mode = modeRows[0]?.value === "private" ? "private" : "global";
  const chatGptPrompts = activePrompts.filter(
    (prompt) =>
      prompt.provider === "openai" &&
      prompt.purpose === "document_generation",
  );
  const promptsByPurpose = (provider: string, purpose: string) =>
    activePrompts.filter(
      (prompt) => prompt.provider === provider && prompt.purpose === purpose,
    );

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">
              Super Admin workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              AI prompt settings
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Manage global prompt versions, choose the Manager prompt mode, and
              assign stable ChatGPT prompt overrides.
            </p>
          </div>
          <Link
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            href="/"
          >
            Back to dashboard
          </Link>
        </header>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">
            Prompt mode
          </h2>
          <PromptModeForm mode={mode} />
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">
              Global prompt library
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Saving an existing prompt creates a new version and preserves its
              earlier revisions. Only one active version per prompt group is
              used.
            </p>
          </div>
          <div className="space-y-7">
            {promptGroups.map((group) => {
              const groupPrompts = promptsByPurpose(
                group.provider,
                group.purpose,
              );
              return (
                <div className="border-t border-slate-100 pt-5" key={group.purpose}>
                  <h3 className="mb-4 text-xs font-semibold text-slate-700">
                    {group.heading}
                  </h3>
                  {groupPrompts.length > 0 ? (
                    <div className="space-y-5">
                      {groupPrompts.map((prompt) => (
                        <GlobalPromptForm
                          isDefault={prompt.isDefault}
                          key={prompt.id}
                          name={prompt.name}
                          promptGroupId={prompt.promptGroupId}
                          promptTemplate={prompt.promptTemplate}
                          provider={prompt.provider}
                          purpose={prompt.purpose}
                          version={prompt.version}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700">
                      No active prompt exists for this task. Create one below.
                    </p>
                  )}
                  <details className="mt-5 rounded-lg border border-dashed border-slate-300 p-4">
                    <summary className="cursor-pointer text-xs font-semibold text-indigo-700">
                      Create another prompt group
                    </summary>
                    <div className="mt-4">
                      <GlobalPromptForm
                        name=""
                        promptTemplate=""
                        provider={group.provider}
                        purpose={group.purpose}
                      />
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">
              Manager prompt assignments
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Assign a specific active ChatGPT prompt or select random once.
              Random assignments are saved and remain stable until unassigned
              or replaced.
            </p>
          </div>
          {managerRows.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {managerRows.map((manager) => (
                <PromptAssignmentForm
                  assignedPromptName={manager.assignedPromptName}
                  key={manager.id}
                  managerId={manager.id}
                  managerName={`${manager.displayName ?? "Manager"} (@${manager.loginName ?? "unknown"})`}
                  prompts={chatGptPrompts.map((prompt) => ({
                    id: prompt.id,
                    name: prompt.name,
                    version: prompt.version,
                  }))}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-4 py-5 text-center text-xs text-slate-500">
              No active Managers are available for assignment.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
