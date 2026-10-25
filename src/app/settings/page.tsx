import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  GlobalPromptForm,
  ManagerGeminiMatchingForm,
  ManagerOwnPromptForm,
  ManagerTemplatesForm,
  ManagerTextHighlightAccessForm,
  ManagerPageExclusionAccessForm,
  ManagerJobDetectionUrlAccessForm,
  PromptAssignmentForm,
  PromptModeForm,
} from "@/app/settings/prompt-forms";
import {
  categories,
  managerPromptAssignments,
  managerPromptOverrides,
  managerTemplateAssignments,
  prompts,
  settings,
  users,
} from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { JobRecordTimeZoneForm } from "@/app/settings/job-record-time-zone-form";
import { getJobRecordTimeZone } from "@/server/jobs/job-record-time-zone";

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

  const [
    modeRows,
    activePrompts,
    managerRows,
    assignmentRows,
    ownPromptRows,
    templateRows,
    categoryRows,
    jobRecordTimeZone,
  ] = await Promise.all([
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
        categoryId: prompts.categoryId,
        categoryName: categories.name,
        name: prompts.name,
        promptTemplate: prompts.promptTemplate,
        version: prompts.version,
        isDefault: prompts.isDefault,
      })
      .from(prompts)
      .leftJoin(categories, eq(categories.id, prompts.categoryId))
      .where(eq(prompts.isActive, true))
      .orderBy(
        asc(prompts.provider),
        asc(prompts.purpose),
        asc(categories.name),
        asc(prompts.name),
      ),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        loginName: users.loginName,
        canManageTextHighlights: users.canManageTextHighlights,
        canManagePageExclusions: users.canManagePageExclusions,
        canManageJobDetectionUrlRules: users.canManageJobDetectionUrlRules,
        useGeminiMatching: users.useGeminiMatching,
      })
      .from(users)
      .where(
        and(eq(users.role, "manager"), isNull(users.blockedAt)),
      )
      .orderBy(asc(users.displayName), asc(users.loginName)),
    db
      .select({
        managerId: managerPromptAssignments.managerId,
        id: prompts.id,
        name: prompts.name,
        version: prompts.version,
        categoryName: categories.name,
      })
      .from(managerPromptAssignments)
      .innerJoin(prompts, eq(prompts.id, managerPromptAssignments.promptId))
      .leftJoin(categories, eq(categories.id, prompts.categoryId))
      .orderBy(asc(categories.name), asc(prompts.name)),
    db
      .select({
        managerId: managerPromptOverrides.managerId,
        promptTemplate: managerPromptOverrides.promptTemplate,
      })
      .from(managerPromptOverrides),
    db
      .select({
        managerId: managerTemplateAssignments.managerId,
        template: managerTemplateAssignments.template,
      })
      .from(managerTemplateAssignments),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.name)),
    getJobRecordTimeZone(),
  ]);
  const ownPrompts = new Map(
    ownPromptRows.map((row) => [row.managerId, row.promptTemplate]),
  );

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
    <WorkspaceShell activeHref="/settings" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Maintain the global prompt library, assign prompts to Managers for rotation, edit Managers' own prompts, and set Get JD access."
          eyebrow="Administration"
          title="AI prompt settings"
        />

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">
            Prompt mode
          </h2>
          <PromptModeForm mode={mode} />
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-sm font-semibold text-slate-800">
            Job record time zone
          </h2>
          <p className="mb-4 mt-1 text-xs text-slate-500">
            The date saved on new jobs follows this time zone. Existing jobs keep their dates.
          </p>
          <JobRecordTimeZoneForm timeZone={jobRecordTimeZone} />
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
                          categories={categoryRows}
                          categoryId={prompt.categoryId}
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
                        categories={categoryRows}
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
              { label: "Manager", className: "w-[12%]" },
              { label: "Assigned prompts", className: "w-[22%]" },
              { label: "Rotation templates", className: "w-[14%]" },
              { label: "Own prompt", className: "w-[12%]" },
              { label: "Get JD matching", className: "w-[10%]" },
              { label: "Text highlight access", className: "w-[10%]" },
              { label: "Excluded rules · job match", className: "w-[10%]" },
              { label: "Job-detection rules · block", className: "w-[10%]" },
            ]}
            emptyMessage="No active Managers"
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
                  assignedPrompts={assignmentRows.filter(
                    (assignment) => assignment.managerId === manager.id,
                  )}
                  key="assignment"
                  managerId={manager.id}
                  prompts={chatGptPrompts.map((prompt) => ({
                    id: prompt.id,
                    name: prompt.name,
                    version: prompt.version,
                    categoryName: prompt.categoryName,
                  }))}
                />,
                <ManagerTemplatesForm
                  key="templates"
                  managerId={manager.id}
                  selected={templateRows
                    .filter((row) => row.managerId === manager.id)
                    .map((row) => row.template)}
                />,
                <details className="min-w-0" key="own-prompt">
                  <summary
                    className={`cursor-pointer text-xs font-medium ${
                      ownPrompts.has(manager.id) ? "text-slate-700" : "text-amber-700"
                    }`}
                  >
                    {ownPrompts.has(manager.id) ? "Written · edit" : "Not written yet · write"}
                  </summary>
                  <div className="mt-3">
                    <ManagerOwnPromptForm
                      managerId={manager.id}
                      promptTemplate={ownPrompts.get(manager.id) ?? null}
                    />
                  </div>
                </details>,
                <ManagerGeminiMatchingForm
                  key="gemini-matching"
                  managerId={manager.id}
                  useGemini={manager.useGeminiMatching}
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
