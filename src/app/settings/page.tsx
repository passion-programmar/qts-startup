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
import { DismissSuggestionButton, ReusableAnswerForm } from "@/app/settings/reusable-answers";
import { SettingsCard } from "@/app/settings/settings-card";
import { getJobRecordTimeZone } from "@/server/jobs/job-record-time-zone";
import { listQuestionSuggestions } from "@/server/apply/question-memory";

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
    questionSuggestions,
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
        autoSubmit: users.autoSubmit,
        applyReviewMode: users.applyReviewMode,
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
        autoAdded: reusableAnswers.autoAdded,
      })
      .from(reusableAnswers)
      .orderBy(asc(reusableAnswers.questionText)),
    listQuestionSuggestions(),
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

        <SettingsCard summary={jobRecordTimeZone} title="Job record time zone">
          <p className="mb-4 text-xs text-slate-500">
            The date saved on new jobs follows this time zone. Existing jobs keep their dates.
          </p>
          <JobRecordTimeZoneForm timeZone={jobRecordTimeZone} />
        </SettingsCard>

        <SettingsCard
          summary={`${activePrompts.length} prompts across ${promptGroups.length} tasks`}
          title="Global prompt library"
        >
          <p className="mb-4 text-xs text-slate-500">
            Managers write their own ChatGPT prompts. One without any uses the ChatGPT prompt marked Global default.
          </p>
          <div className="space-y-3">
            {promptGroups.map((group) => {
              const groupPrompts = promptsByPurpose(
                group.provider,
                group.purpose,
              );
              return (
                <SettingsCard
                  item
                  key={`${group.provider}-${group.purpose}`}
                  summary={groupPrompts.length
                    ? groupPrompts.map((prompt) => `${prompt.name} · v${prompt.version}${prompt.isDefault ? " · default" : ""}`).join(" | ")
                    : "No active prompt"}
                  title={group.heading}
                >
                  {"note" in group && (
                    <p className="mb-3 text-xs leading-5 text-slate-500">{group.note}</p>
                  )}
                  <div className="space-y-3">
                    {groupPrompts.length === 0 && (
                      <p className="text-xs text-amber-700">
                        No active prompt exists for this task. Create one below.
                      </p>
                    )}
                    {groupPrompts.map((prompt) => (
                      <SettingsCard
                        item
                        key={prompt.id}
                        summary={`Version ${prompt.version}${prompt.isDefault ? " · Global default" : ""}`}
                        title={prompt.name}
                      >
                        <div className="space-y-3">
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
                      </SettingsCard>
                    ))}
                    <SettingsCard item summary="A new prompt for this task" title="Create another prompt group">
                      <GlobalPromptForm
                        name=""
                        promptTemplate=""
                        provider={group.provider}
                        purpose={group.purpose}
                      />
                    </SettingsCard>
                  </div>
                </SettingsCard>
              );
            })}
          </div>
        </SettingsCard>

        <SettingsCard
          summary={`${reusableAnswerRows.length} answers${questionSuggestions.length ? ` · ${questionSuggestions.length} suggestions` : ""}`}
          title="Reusable answers"
        >
          <p className="mb-4 text-xs leading-5 text-slate-500">
            Answers to application questions, the same for every candidate. Salary, notice, sponsorship, relocation, right to work, job preferences, and diversity questions (gender, ethnicity, veteran, disability) come from here; without a diversity answer Apply declines. The candidate&apos;s static profile facts (name, contacts, nationality, languages) come first for everything else. An answer that does not fit a field goes to ChatGPT as a hint.
          </p>
          <div className="space-y-3">
            {reusableAnswerRows.map((answer) => (
              <SettingsCard
                item
                key={answer.id}
                summary={answer.autoAdded ? `${answer.answer} · Added automatically` : answer.answer}
                title={answer.questionText}
              >
                <ReusableAnswerForm answer={answer} />
              </SettingsCard>
            ))}
            {/* A new key after each added answer empties the form for the next one. */}
            <SettingsCard item key={`new-${reusableAnswerRows.length}`} summary="A question and its answer" title="Add an answer">
              <ReusableAnswerForm />
            </SettingsCard>
          </div>

          <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">
            Suggestions from applications ({questionSuggestions.length})
          </h3>
          <p className="mb-3 text-xs leading-5 text-slate-500">
            Questions met in 2 or more confirmed applications that have no reusable answer yet, the most frequent first. Add one to answer it the same way for every candidate, or Dismiss a personal or one-off question. A choice question answered the same way 5 or more times by 3 or more candidates is added by itself and marked “Added automatically”.
          </p>
          {questionSuggestions.length ? (
            <div className="space-y-3">
              {questionSuggestions.map((suggestion) => {
                const choices = [...new Set(suggestion.options.flat())];
                return (
                  <SettingsCard
                    item
                    key={suggestion.id}
                    summary={`Seen ${suggestion.timesSeen} times${suggestion.answers.length
                      ? ` · ${suggestion.answers.map((entry) => `${entry.answer} (${entry.count})`).join(", ")}`
                      : " · free-text answers are not kept"}`}
                    title={suggestion.questionText}
                  >
                    {suggestion.answers.length > 0 && (
                      <ul className="mb-3 space-y-0.5 text-[11px] text-slate-600">
                        {suggestion.answers.map((entry) => (
                          <li key={entry.answer}>
                            <span className="font-semibold text-slate-800">{entry.answer}</span>: {entry.count} times, {entry.candidates} {entry.candidates === 1 ? "candidate" : "candidates"}
                          </li>
                        ))}
                      </ul>
                    )}
                    <ReusableAnswerForm
                      draft={{
                        key: `suggestion-${suggestion.id}`,
                        questionText: suggestion.questionText,
                        answer: suggestion.answers[0]?.answer ?? "",
                        choices,
                      }}
                    />
                    <div className="mt-2">
                      <DismissSuggestionButton suggestionId={suggestion.id} />
                    </div>
                  </SettingsCard>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No suggestions yet. They appear after confirmed applications.</p>
          )}
        </SettingsCard>

        <SettingsCard summary={`${managerRows.length} active Managers`} title="Managers">
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
                    autoSubmit={manager.autoSubmit}
                    reviewMode={manager.applyReviewMode}
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
        </SettingsCard>
      </div>
    </main>
    </WorkspaceShell>
  );
}
