import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  GlobalPromptForm,
  ManagerApplyForm,
  ManagerGeminiMatchingForm,
  PromptVersionPicker,
  type PromptVersion,
  ManagerTextHighlightAccessForm,
  ManagerPageExclusionAccessForm,
  ManagerJobDetectionUrlAccessForm,
} from "@/app/settings/prompt-forms";
import { groupVersions } from "@/app/prompts/prompt-groups";
import { prompts, reusableAnswers, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { JobRecordTimeZoneForm } from "@/app/settings/job-record-time-zone-form";
import { ReusableAnswerForm } from "@/app/settings/reusable-answers";
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
    provider: "openai",
    purpose: "application_answer",
    heading: "ChatGPT · Application answers (Apply)",
    note: "Apply fills what the candidate's profile answers exactly; this prompt decides how ChatGPT answers every other question. Placeholders: {{job_title}}, {{company}}, {{job_location}}, {{job_description}}, {{today}}, {{candidate_profile}}, {{resume_and_cover_letter}}, {{saved_answers}}, {{questions}}. Apply always adds the reply format at the end.",
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
    activePrompts,
    libraryVersionRows,
    managerRows,
    managerPromptRows,
    jobRecordTimeZone,
    reusableAnswerRows,
  ] = await Promise.all([
    // Super Admin's library: the active version of each prompt.
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
      .where(and(eq(prompts.isActive, true), isNull(prompts.ownerManagerId)))
      .orderBy(asc(prompts.provider), asc(prompts.purpose), asc(prompts.name)),
    // Every version of the library ChatGPT prompts, newest first, for the version picker.
    db
      .select({
        id: prompts.id,
        promptGroupId: prompts.promptGroupId,
        version: prompts.version,
        isActive: prompts.isActive,
        promptTemplate: prompts.promptTemplate,
        createdAt: prompts.createdAt,
      })
      .from(prompts)
      .where(and(eq(prompts.purpose, "document_generation"), isNull(prompts.ownerManagerId)))
      .orderBy(desc(prompts.version)),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        loginName: users.loginName,
        canManageTextHighlights: users.canManageTextHighlights,
        canManagePageExclusions: users.canManagePageExclusions,
        canManageJobDetectionUrlRules: users.canManageJobDetectionUrlRules,
        useGeminiMatching: users.useGeminiMatching,
        canUseApply: users.canUseApply,
        applyAiMode: users.applyAiMode,
      })
      .from(users)
      .where(
        and(eq(users.role, "manager"), isNull(users.blockedAt)),
      )
      .orderBy(asc(users.displayName), asc(users.loginName)),
    // Every version of every Manager's own prompts, shown to Super Admin read-only.
    db
      .select({
        ownerManagerId: prompts.ownerManagerId,
        id: prompts.id,
        promptGroupId: prompts.promptGroupId,
        name: prompts.name,
        promptTemplate: prompts.promptTemplate,
        version: prompts.version,
        isActive: prompts.isActive,
        createdAt: prompts.createdAt,
      })
      .from(prompts)
      .where(and(isNotNull(prompts.ownerManagerId), isNull(prompts.archivedAt)))
      .orderBy(desc(prompts.version)),
    getJobRecordTimeZone(),
    db
      .select({
        id: reusableAnswers.id,
        questionText: reusableAnswers.questionText,
        answer: reusableAnswers.answer,
        note: reusableAnswers.note,
      })
      .from(reusableAnswers)
      .orderBy(asc(reusableAnswers.questionText)),
  ]);
  const versionsByGroup = new Map<string, PromptVersion[]>();
  for (const row of libraryVersionRows) {
    const versions = versionsByGroup.get(row.promptGroupId) ?? [];
    versions.push({
      id: row.id,
      version: row.version,
      isActive: row.isActive,
      promptTemplate: row.promptTemplate,
      savedOn: row.createdAt.toISOString().slice(0, 10),
    });
    versionsByGroup.set(row.promptGroupId, versions);
  }

  const promptsByPurpose = (provider: string, purpose: string) =>
    activePrompts.filter(
      (prompt) => prompt.provider === provider && prompt.purpose === purpose,
    );

  return (
    <WorkspaceShell activeHref="/settings" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Maintain the global prompt library and its default prompt, see each Manager's own prompts, and set Get JD access."
          eyebrow="Administration"
          title="AI prompt settings"
        />

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
            <p className="mt-1 text-xs text-slate-500">
              Managers write their own ChatGPT prompts. One without any uses the ChatGPT prompt marked Global default.
            </p>
          </div>
          <div className="space-y-7">
            {promptGroups.map((group) => {
              const groupPrompts = promptsByPurpose(
                group.provider,
                group.purpose,
              );
              return (
                <div className="border-t border-slate-100 pt-5" key={`${group.provider}-${group.purpose}`}>
                  <h3 className="mb-4 text-xs font-semibold text-slate-700">
                    {group.heading}
                  </h3>
                  {"note" in group && (
                    <p className="-mt-2 mb-4 text-xs leading-5 text-slate-500">{group.note}</p>
                  )}
                  {groupPrompts.length > 0 ? (
                    <div className="space-y-5">
                      {groupPrompts.map((prompt) => (
                        <div className="space-y-3" key={prompt.id}>
                          <GlobalPromptForm
                            isDefault={prompt.isDefault}
                            name={prompt.name}
                            promptGroupId={prompt.promptGroupId}
                            promptTemplate={prompt.promptTemplate}
                            provider={prompt.provider}
                            purpose={prompt.purpose}
                            version={prompt.version}
                          />
                          {prompt.purpose === "document_generation" && (
                            <PromptVersionPicker
                              versions={versionsByGroup.get(prompt.promptGroupId) ?? []}
                            />
                          )}
                        </div>
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

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">Reusable answers</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Answers to application questions every candidate may meet. Apply fills the candidate&apos;s profile facts first, then a matching answer here when it fits the field; when it does not fit, ChatGPT gets it as a hint and answers in the form the field takes.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {reusableAnswerRows.map((answer) => (
              <ReusableAnswerForm answer={answer} key={answer.id} />
            ))}
            {/* A new key after each added answer empties the form for the next one. */}
            <ReusableAnswerForm key={`new-${reusableAnswerRows.length}`} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-slate-800">
              Managers
            </h2>
          </div>
          <PaginatedTable
            columns={[
              { label: "Manager", className: "w-[12%]" },
              { label: "Own prompts (read-only)", className: "w-[24%]" },
              { label: "Get JD matching", className: "w-[13%]" },
              { label: "Apply", className: "w-[13%]" },
              { label: "Text highlight access", className: "w-[13%]" },
              { label: "Excluded rules · job match", className: "w-[12%]" },
              { label: "Job-detection rules · block", className: "w-[13%]" },
            ]}
            emptyMessage="No active Managers"
            rows={managerRows.map((manager) => {
              const ownPrompts = groupVersions(
                managerPromptRows.filter((row) => row.ownerManagerId === manager.id),
              );
              return {
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
                  <div className="min-w-0 space-y-2" key="own-prompts">
                    {ownPrompts.length === 0 ? (
                      <span className="text-xs text-slate-500">None · uses the default prompt</span>
                    ) : ownPrompts.map((prompt) => (
                      <div className="space-y-1" key={prompt.promptGroupId}>
                        <p className="text-xs font-medium text-slate-700">
                          {prompt.name} · v{prompt.version}
                        </p>
                        <PromptVersionPicker readOnly versions={prompt.versions} />
                      </div>
                    ))}
                  </div>,
                  <ManagerGeminiMatchingForm
                    key="gemini-matching"
                    managerId={manager.id}
                    useGemini={manager.useGeminiMatching}
                  />,
                  <ManagerApplyForm
                    aiMode={manager.applyAiMode}
                    canUseApply={manager.canUseApply}
                    key="apply"
                    managerId={manager.id}
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
              };
            })}
          />
        </section>
      </div>
    </main>
    </WorkspaceShell>
  );
}
