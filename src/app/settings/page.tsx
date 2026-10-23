import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  GlobalPromptForm,
  GetJdMatchingModeForm,
  GeminiTokenCountModeForm,
  ManagerTextHighlightAccessForm,
  ManagerPageExclusionAccessForm,
  ManagerJobDetectionUrlAccessForm,
  PromptAssignmentForm,
  PromptModeForm,
} from "@/app/settings/prompt-forms";
import {
  managerPromptAssignments,
  prompts,
  settings,
  users,
} from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";

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

  const [modeRows, getJdModeRows, tokenModeRows, activePrompts, managerRows] = await Promise.all([
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "prompt_mode"))
      .limit(1),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "get_jd_matching_mode")).limit(1),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "gemini_token_count_mode")).limit(1),
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
        assignedPromptId: managerPromptAssignments.promptId,
        assignedPromptName: prompts.name,
        canManageTextHighlights: users.canManageTextHighlights,
        canManagePageExclusions: users.canManagePageExclusions,
        canManageJobDetectionUrlRules: users.canManageJobDetectionUrlRules,
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
  const getJdMode = getJdModeRows[0]?.value === "gemini" ? "gemini" : "manual";
  const tokenMode = tokenModeRows[0]?.value === "gemini" ? "gemini" : "local";
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
    <WorkspaceShell activeHref="/settings" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <header className="mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              AI prompt settings
            </h1>
          </div>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">
            Prompt mode
          </h2>
          <PromptModeForm mode={mode} />
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Get JD candidate matching</h2>
          <GetJdMatchingModeForm mode={getJdMode} />
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Gemini token accounting</h2>
          <GeminiTokenCountModeForm mode={tokenMode} />
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">
              Global prompt library
            </h2>
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">
              Manager prompt assignments
            </h2>
          </div>
          <PaginatedTable
            columns={[
              { label: "Manager", className: "w-[20%]" },
              { label: "Prompt assignment", className: "w-[28%]" },
              { label: "Text highlight access", className: "w-[17%]" },
              { label: "Excluded rules · job match", className: "w-[17%]" },
              { label: "Job-detection rules · block", className: "w-[18%]" },
            ]}
            emptyMessage="No active managers"
            rows={managerRows.map((manager) => ({
              id: manager.id,
              cells: [
                <div key="manager">
                  <div className="font-semibold">
                    {manager.displayName ?? "Manager"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    @{manager.loginName ?? "unknown"}
                  </div>
                </div>,
                <PromptAssignmentForm
                  assignedPromptId={manager.assignedPromptId}
                  assignedPromptName={manager.assignedPromptName}
                  key="assignment"
                  managerId={manager.id}
                  prompts={chatGptPrompts.map((prompt) => ({
                    id: prompt.id,
                    name: prompt.name,
                    version: prompt.version,
                  }))}
                />,
                <ManagerTextHighlightAccessForm
                  canManage={manager.canManageTextHighlights}
                  key="text-highlight-access"
                  managerId={manager.id}
                />,
                <ManagerPageExclusionAccessForm
                  canManage={manager.canManagePageExclusions}
                  key="page-exclusion-access"
                  managerId={manager.id}
                />,
                <ManagerJobDetectionUrlAccessForm
                  canManage={manager.canManageJobDetectionUrlRules}
                  key="job-detection-url-access"
                  managerId={manager.id}
                />,
              ],
            }))}
          />
        </section>
      </div>
    </main>
    </WorkspaceShell>
  );
}
