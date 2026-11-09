import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { ChevronDown, Info } from "lucide-react";
import { redirect } from "next/navigation";
import {
  GlobalPromptForm,
  PromptVersionPicker,
  type PromptVersion,
  OwnChatGptUrlForm,
  OwnAutoApplyParallelLimitForm,
} from "@/app/settings/prompt-forms";
import { ManagerChatGptUrlCell, ManagerSettingSwitch } from "@/app/settings/manager-settings";
import { MANAGER_SETTINGS, ManagerIdentity, ManagerSettingMeanings } from "@/app/settings/manager-settings-meanings";
import { groupVersions } from "@/app/prompts/prompt-groups";
import { managerApplyAnswers, prompts, users } from "@/db/schema";
import { PublishManagerAnswers } from "./publish-manager-answers";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { displayReusableAnswer } from "@/lib/checkbox-answer";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { JobRecordTimeZoneForm } from "@/app/settings/job-record-time-zone-form";
import {
  DeleteReusableAnswerButton,
  DismissSuggestionButton,
  DraftReviewList,
  ReusableAnswerForm,
  VersionList,
  WarningList,
} from "@/app/settings/reusable-answers";
import { SettingsCard } from "@/app/settings/settings-card";
import { getJobRecordTimeZone } from "@/server/jobs/job-record-time-zone";
import { listQuestionSuggestions } from "@/server/apply/question-memory";
import { answerWarnings, describeWarning, SOURCE_LABELS, VERSION_REASON_LABELS } from "@/server/apply/reusable-answer-values";
import { type AnswerVersion, listLibrary, listVersions } from "@/server/apply/reusable-answers";

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

// The first cell of each Manager row.
function managerCell(manager: { displayName: string | null; loginName: string | null }) {
  return <ManagerIdentity displayName={manager.displayName} key="manager" loginName={manager.loginName} />;
}

export default async function SettingsPage() {
  const currentUser = await requireUser();
  if (currentUser.role === "manager") {
    const [manager] = await db.select({
      autoApplyParallelLimit: users.autoApplyParallelLimit,
      chatGptUrl: users.chatGptUrl,
    })
      .from(users).where(and(eq(users.id, currentUser.id), isNull(users.blockedAt))).limit(1);
    if (!manager) redirect("/");
    return (
      <WorkspaceShell activeHref="/settings" user={currentUser}>
        <main className="py-1">
          <div className="mx-auto max-w-3xl">
            <PageHeader
              description="Set your ChatGPT Project URL and choose how many Auto Apply forms each Chrome can work on together."
              eyebrow="Manager settings"
              title="Your settings"
            />
            <SettingsCard title="ChatGPT Project URL" summary="Choose where your ChatGPT conversations open">
              <OwnChatGptUrlForm chatGptUrl={manager.chatGptUrl} />
            </SettingsCard>
            <SettingsCard summary={`${manager.autoApplyParallelLimit} jobs at once`} title="Concurrent jobs">
              <OwnAutoApplyParallelLimitForm parallelLimit={manager.autoApplyParallelLimit} />
            </SettingsCard>
          </div>
        </main>
      </WorkspaceShell>
    );
  }
  if (currentUser.role !== "super_admin") redirect("/");

  const [
    activePrompts,
    libraryVersionRows,
    managerRows,
    managerPromptRows,
    jobRecordTimeZone,
    libraryRows,
    questionSuggestions,
    answerVersions,
    managerAnswerRows,
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
        autoApplyApi: users.autoApplyApi,
        chatGptUrl: users.chatGptUrl,
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
    listLibrary(),
    listQuestionSuggestions(),
    listVersions(),
    db.select({ id: managerApplyAnswers.id, questionText: managerApplyAnswers.questionText, answer: managerApplyAnswers.answer, manager: users.displayName })
      .from(managerApplyAnswers).innerJoin(users, eq(users.id, managerApplyAnswers.managerId)).where(eq(managerApplyAnswers.scope, "manager")),
  ]);
  // Approved answers are what Apply uses; drafts wait for review; rejected ones are kept so learning
  // does not propose them again. Each answer lists what it repeats or contradicts, and its earlier
  // versions; versions of deleted answers are listed on their own.
  const reusableAnswerRows = libraryRows.filter((row) => row.status === "approved");
  const draftRows = libraryRows.filter((row) => row.status === "draft");
  const rejectedRows = libraryRows.filter((row) => row.status === "rejected");
  const warningsOf = (row: (typeof libraryRows)[number]) => answerWarnings(row, libraryRows).map(describeWarning);
  const approvedKeys = new Set(reusableAnswerRows.map((row) => row.questionKey));
  const versionItem = (version: AnswerVersion) => ({
    id: version.id,
    questionText: version.questionText,
    answer: version.answer,
    note: version.note,
    label: `${VERSION_REASON_LABELS[version.reason]}${version.replacedBy ? ` by ${version.replacedBy}` : ""} · ${version.replacedAt.slice(0, 16).replace("T", " ")} UTC`,
  });
  const versionsOf = (questionKey: string) => answerVersions.filter((version) => version.questionKey === questionKey).map(versionItem);
  const deletedVersions = answerVersions.filter((version) => !approvedKeys.has(version.questionKey)).map(versionItem);
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
          summary={`${reusableAnswerRows.length} answers${draftRows.length ? ` · ${draftRows.length} drafts to review` : ""}${questionSuggestions.length ? ` · ${questionSuggestions.length} suggestions` : ""}`}
          title="Legacy global answers"
        >
          <p className="mb-4 text-xs leading-5 text-slate-500">
            This legacy global library is retained for reference. Apply and Auto Apply no longer load these answers. Managers manage their own answers in Profile; existing global records are not copied into Manager libraries.
          </p>
          <div className="space-y-3">
            {reusableAnswerRows.map((answer) => {
              const warnings = warningsOf(answer);
              return (
                <SettingsCard
                  item
                  key={answer.id}
                  summary={[
                    displayReusableAnswer(answer.answer),
                    answer.autoAdded ? "Added automatically" : answer.source !== "manual" ? SOURCE_LABELS[answer.source] : null,
                    warnings.length ? `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : null,
                  ].filter(Boolean).join(" · ")}
                  title={answer.questionText}
                >
                  <WarningList warnings={warnings} />
                  <ReusableAnswerForm answer={answer} />
                  {versionsOf(answer.questionKey).length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">
                        Previous versions ({versionsOf(answer.questionKey).length})
                      </summary>
                      <div className="mt-2">
                        <VersionList versions={versionsOf(answer.questionKey)} />
                      </div>
                    </details>
                  )}
                </SettingsCard>
              );
            })}
            {/* A new key after each added answer empties the form for the next one. */}
            <SettingsCard item key={`new-${reusableAnswerRows.length}`} summary="A question and its answer" title="Add an answer">
              <ReusableAnswerForm />
            </SettingsCard>
          </div>

          <PublishManagerAnswers rows={managerAnswerRows} />
          <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">
            Drafts waiting for review ({draftRows.length})
          </h3>
          <p className="mb-3 text-xs leading-5 text-slate-500">
            Answers learned from confirmed applications and Managers&apos; proposals. Apply never uses a draft. Edit it if needed, then Approve to use it for every candidate, or Reject it. Approving a draft for a question that already has an approved answer replaces that answer; the replaced answer is kept under its Previous versions.
          </p>
          <DraftReviewList
            drafts={draftRows.map((draft) => {
              const warnings = warningsOf(draft);
              return {
                answer: { id: draft.id, questionText: draft.questionText, answer: draft.answer, note: draft.note },
                summary: `${displayReusableAnswer(draft.answer)} · ${SOURCE_LABELS[draft.source]}${draft.source === "manager" ? ` (${draft.createdBy})` : ""}${warnings.length ? ` · ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}` : ""}`,
                warnings,
              };
            })}
          />

          {rejectedRows.length > 0 && (
            <>
              <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">Rejected ({rejectedRows.length})</h3>
              <p className="mb-3 text-xs leading-5 text-slate-500">
                Kept so Apply&apos;s learning does not propose them again. Delete one to let it be proposed again.
              </p>
              <div className="space-y-3">
                {rejectedRows.map((row) => (
                  <SettingsCard item key={row.id} summary={`${displayReusableAnswer(row.answer)} · ${SOURCE_LABELS[row.source]}${row.reviewedBy ? ` · rejected by ${row.reviewedBy}` : ""}`} title={row.questionText}>
                    <p className="mb-3 whitespace-pre-wrap text-xs text-slate-700">{displayReusableAnswer(row.answer)}</p>
                    <DeleteReusableAnswerButton answer={row} />
                  </SettingsCard>
                ))}
              </div>
            </>
          )}

          {deletedVersions.length > 0 && (
            <>
              <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">Deleted answers ({deletedVersions.length} versions)</h3>
              <p className="mb-3 text-xs leading-5 text-slate-500">
                Approved answers that were deleted, kept so they can be restored. The 20 newest versions of each question are kept.
              </p>
              <VersionList versions={deletedVersions} />
            </>
          )}

          <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">
            Suggestions from applications ({questionSuggestions.length})
          </h3>
          <p className="mb-3 text-xs leading-5 text-slate-500">
            Questions met in 2 or more confirmed applications that have no reusable answer yet, the most frequent first. Add one to answer it the same way for every candidate, or Dismiss a personal or one-off question. A choice question answered the same way 5 or more times (not counting AI answers) by 3 or more candidates is proposed by itself as a draft above.
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

        <SettingsCard
          summary={`${managerRows.length} active Managers · ${managerRows.filter((manager) => manager.canUseApply).length} with Apply on · ${managerRows.filter((manager) => manager.canUseApply && manager.autoApplyApi).length} with APIs on`}
          title="Managers"
        >
          <details className="group/meanings mb-4 rounded-2xl border border-indigo-100 bg-linear-to-br from-indigo-50/70 via-white to-violet-50/50" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                <Info aria-hidden="true" className="size-4 text-indigo-500" />
                What each column means
              </span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-indigo-400 transition group-open/meanings:rotate-180" />
            </summary>
            <div className="border-t border-indigo-100/70 px-5 py-5">
              <ManagerSettingMeanings settings={["apply", "autoApplyApi", "geminiMatching", "chatGptUrl", "textHighlights", "pageExclusions", "jobDetectionUrls"]} />
            </div>
          </details>
          <PaginatedTable
            columns={[
              { label: "Manager", className: "w-[14%]" },
              { label: MANAGER_SETTINGS.apply.column, className: "w-[8%]" },
              { label: MANAGER_SETTINGS.autoApplyApi.column, className: "w-[10%]" },
              { label: MANAGER_SETTINGS.geminiMatching.column, className: "w-[10%]" },
              { label: MANAGER_SETTINGS.chatGptUrl.column, className: "w-[25%]" },
              { label: MANAGER_SETTINGS.textHighlights.column, className: "w-[11%]" },
              { label: MANAGER_SETTINGS.pageExclusions.column, className: "w-[11%]" },
              { label: MANAGER_SETTINGS.jobDetectionUrls.column, className: "w-[11%]" },
            ]}
            emptyMessage="No active Managers"
            rows={managerRows.map((manager) => {
              const managerName = manager.displayName ?? manager.loginName ?? "Manager";
              const applyOff = manager.canUseApply ? undefined : "Turn Apply on first";
              return {
                id: manager.id,
                search: { name: manager.displayName ?? "", login: manager.loginName ?? "" },
                cells: [
                  managerCell(manager),
                  <ManagerSettingSwitch key="apply" managerId={manager.id} managerName={managerName} on={manager.canUseApply} setting="apply" />,
                  <ManagerSettingSwitch disabledReason={applyOff} key="auto-apply-api" managerId={manager.id} managerName={managerName} on={manager.autoApplyApi} setting="autoApplyApi" />,
                  <ManagerSettingSwitch key="gemini-matching" managerId={manager.id} managerName={managerName} on={manager.useGeminiMatching} setting="geminiMatching" />,
                  <ManagerChatGptUrlCell chatGptUrl={manager.chatGptUrl} key="chatgpt-url" managerId={manager.id} managerName={managerName} />,
                  <ManagerSettingSwitch key="text-highlights" managerId={manager.id} managerName={managerName} on={manager.canManageTextHighlights} setting="textHighlights" />,
                  <ManagerSettingSwitch key="page-exclusions" managerId={manager.id} managerName={managerName} on={manager.canManagePageExclusions} setting="pageExclusions" />,
                  <ManagerSettingSwitch key="job-detection-urls" managerId={manager.id} managerName={managerName} on={manager.canManageJobDetectionUrlRules} setting="jobDetectionUrls" />,
                ],
              };
            })}
            searchFields={[{ key: "name", label: "Name" }, { key: "login", label: "Login" }]}
          />
          <div className="mt-4 space-y-3">
            <SettingsCard item summary="Used only by the developer test run, apart from one prompt choice" title="Older Apply settings">
              <div className="mb-4 rounded-xl bg-slate-50 p-4">
                <ManagerSettingMeanings settings={["aiMode", "reviewMode", "autoSubmit"]} />
              </div>
              <PaginatedTable
                columns={[
                  { label: "Manager", className: "w-[34%]" },
                  { label: MANAGER_SETTINGS.aiMode.column, className: "w-[22%]" },
                  { label: MANAGER_SETTINGS.reviewMode.column, className: "w-[22%]" },
                  { label: MANAGER_SETTINGS.autoSubmit.column, className: "w-[22%]" },
                ]}
                emptyMessage="No active Managers"
                rows={managerRows.map((manager) => {
                  const managerName = manager.displayName ?? manager.loginName ?? "Manager";
                  const applyOff = manager.canUseApply ? undefined : "Turn Apply on first";
                  return {
                    id: manager.id,
                    cells: [
                      managerCell(manager),
                      <ManagerSettingSwitch disabledReason={applyOff} key="ai-mode" managerId={manager.id} managerName={managerName} on={manager.applyAiMode === "gemini"} setting="aiMode" />,
                      <ManagerSettingSwitch disabledReason={applyOff} key="review-mode" managerId={manager.id} managerName={managerName} on={manager.applyReviewMode === "before_submit"} setting="reviewMode" />,
                      <ManagerSettingSwitch disabledReason={applyOff} key="auto-submit" managerId={manager.id} managerName={managerName} on={manager.autoSubmit} setting="autoSubmit" />,
                    ],
                  };
                })}
              />
            </SettingsCard>
            <SettingsCard item summary="The prompts each Manager wrote; Super Admin can only read them" title="Managers' own prompts">
              <PaginatedTable
                columns={[
                  { label: "Manager", className: "w-[24%]" },
                  { label: "Own prompts", className: "w-[76%]" },
                ]}
                emptyMessage="No active Managers"
                rows={managerRows.map((manager) => {
                  const ownPrompts = groupVersions(
                    managerPromptRows.filter((row) => row.ownerManagerId === manager.id),
                  );
                  return {
                    id: manager.id,
                    cells: [
                      managerCell(manager),
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
                    ],
                  };
                })}
              />
            </SettingsCard>
          </div>
        </SettingsCard>
      </div>
    </main>
    </WorkspaceShell>
  );
}
