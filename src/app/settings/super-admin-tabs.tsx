import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Archive, Ban, ChevronDown, Clock, Info, ListChecks, MessageSquareText, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionRow } from "@/app/settings/action-row";
import { Badge as UiBadge } from "@/app/ui/badge";
import { Card, CardHeader } from "@/app/ui/card";
import { jobRecordTimeZoneOptions } from "@/server/jobs/job-record-time-zones";
import { GlobalPromptForm, PromptVersionPicker, type PromptVersion } from "@/app/settings/prompt-forms";
import { ManagerApplyChoice, ManagerChatGptUrlCell, ManagerSettingSwitch } from "@/app/settings/manager-settings";
import {
  applyChoiceOf,
  ApplyChoiceMeanings,
  MANAGER_SETTINGS,
  ManagerIdentity,
  ManagerSettingMeanings,
} from "@/app/settings/manager-settings-meanings";
import { groupVersions } from "@/app/prompts/prompt-groups";
import { managerApplyAnswers, prompts, users } from "@/db/schema";
import { PublishManagerAnswers } from "./publish-manager-answers";
import { db } from "@/lib/db";
import { displayReusableAnswer } from "@/lib/checkbox-answer";
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
import { getGetJdSkipSites } from "@/server/get-jd/skip-sites";
import { GetJdSkipSitesForm } from "@/app/settings/get-jd-skip-sites-form";
import { listQuestionSuggestions } from "@/server/apply/question-memory";
import { answerWarnings, describeWarning, SOURCE_LABELS, VERSION_REASON_LABELS } from "@/server/apply/reusable-answer-values";
import { type AnswerVersion, listLibrary, listVersions } from "@/server/apply/reusable-answers";

// Super Admin's Settings page is split into tabs. Each tab is its own server component and loads
// only the data it shows, so opening one tab does not read every other tab's rows.
export type SuperAdminSettingsTab = "managers" | "prompts" | "general" | "old";

export const SUPER_ADMIN_SETTINGS_TABS: { id: SuperAdminSettingsTab; label: string; description: string }[] = [
  { id: "managers", label: "Managers", description: "What each Manager can use." },
  { id: "prompts", label: "Prompts", description: "Global prompts and Managers' own." },
  { id: "general", label: "General", description: "Settings for the whole system." },
  { id: "old", label: "Old", description: "Not used by Apply; kept for reference." },
];

export function parseSuperAdminSettingsTab(value: string | string[] | undefined): SuperAdminSettingsTab {
  return SUPER_ADMIN_SETTINGS_TABS.some((tab) => tab.id === value) ? (value as SuperAdminSettingsTab) : "managers";
}

const promptGroups = [
  {
    provider: "openai",
    purpose: "document_generation",
    title: "Resume and cover-letter generation",
  },
  {
    provider: "gemini",
    purpose: "job_description_evaluation",
    title: "Job-description evaluation",
    note: "Get JD (Gemini mode). Placeholders: {{job_description}}, {{extension_job_title}}, {{extension_company}}, {{candidates}}. With {{job_description}} in the prompt, QTS fills these and adds nothing else, and saves the title and company Gemini returns as they are. Without it, QTS adds the JD and the candidates at the end. The reply must be the JSON with isJobPage, isRemote, matchingProfileIndexes and job (title, company, location, employmentType, workplaceType, salary, reason).",
  },
  {
    provider: "openai",
    purpose: "application_answer",
    title: "Application answers (Apply)",
    note: "Apply fills what the candidate's profile answers exactly; this prompt decides how ChatGPT answers every other question. Placeholders: {{job_title}}, {{company}}, {{job_location}}, {{job_description}}, {{today}}, {{candidate_profile}}, {{resume_and_cover_letter}}, {{saved_answers}}, {{questions}}. Apply always adds the reply format at the end.",
  },
  {
    provider: "gemini",
    purpose: "application_answer",
    title: "Application-answer generation",
  },
] as const;

// The Prompts, General and Old tabs use the shared card and badge (src/app/ui), so they look alike.
const badgeTones = { slate: "neutral", indigo: "primary", sky: "primary", emerald: "success", amber: "warning" } as const;

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return <UiBadge tone={badgeTones[tone]}>{children}</UiBadge>;
}

function CardTitle({ icon: Icon, title, children }: { icon: LucideIcon; title: ReactNode; children?: ReactNode }) {
  return <CardHeader description={children} icon={<Icon aria-hidden="true" />} title={title} />;
}

// Active Managers with every per-Manager setting; the Managers, Prompts and Old tabs list them.
function loadManagers() {
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      loginName: users.loginName,
      canManageTextHighlights: users.canManageTextHighlights,
      canManagePageExclusions: users.canManagePageExclusions,
      canManageJobDetectionUrlRules: users.canManageJobDetectionUrlRules,
      canUseLinkedInSkips: users.canUseLinkedInSkips,
      canViewRemoteCompanies: users.canViewRemoteCompanies,
      useGeminiMatching: users.useGeminiMatching,
      canUseApply: users.canUseApply,
      applyAiMode: users.applyAiMode,
      autoApplyApi: users.autoApplyApi,
      chatGptUrl: users.chatGptUrl,
      autoSubmit: users.autoSubmit,
      applyReviewMode: users.applyReviewMode,
    })
    .from(users)
    .where(and(eq(users.role, "manager"), isNull(users.blockedAt)))
    .orderBy(asc(users.displayName), asc(users.loginName));
}

// The first cell of each Manager row.
function managerCell(manager: { displayName: string | null; loginName: string | null }) {
  return <ManagerIdentity displayName={manager.displayName} key="manager" loginName={manager.loginName} />;
}

function managerNameOf(manager: { displayName: string | null; loginName: string | null }) {
  return manager.displayName ?? manager.loginName ?? "Manager";
}

// A tab's heading: what the tab is for, in one line, above its content.
function TabIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-fg-muted">{children}</p>
    </div>
  );
}

// The column meanings, grouped the same way as the table's columns.
// Apply is explained by its own three choices, above these groups.
const MEANING_GROUPS = [
  { title: "Get JD and ChatGPT", settings: ["geminiMatching", "chatGptUrl"] },
  { title: "Extension tools", settings: ["textHighlights", "pageExclusions", "jobDetectionUrls", "linkedinSkips"] },
  { title: "Web pages", settings: ["remoteCompanies"] },
] as const;

export async function ManagersTab() {
  const managerRows = await loadManagers();
  const choices = managerRows.map(applyChoiceOf);
  const count = (choice: string) => choices.filter((value) => value === choice).length;

  return (
    <section>
      <TabIntro title={`${managerRows.length} active Managers · Apply: ${count("chatgpt")} ChatGPT · ${count("apis")} AI APIs · ${count("off")} off`}>
        Each switch saves as soon as you click it. The Manager&apos;s extension can take up to 5 minutes to show the change.
      </TabIntro>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
        <span className="font-semibold text-slate-900">Apply column:</span>
        <span><b className="text-slate-800">Off</b> = no Normal Apply, no Auto Apply</span>
        <span><b className="text-slate-800">ChatGPT</b> = both on · ChatGPT answers Auto Apply</span>
        <span><b className="text-slate-800">AI APIs</b> = both on · Gemini and Groq answer Auto Apply</span>
      </div>
      <details className="group/meanings mb-4 rounded-2xl border border-indigo-100 bg-linear-to-br from-indigo-50/70 via-white to-violet-50/50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
            <Info aria-hidden="true" className="size-4 text-indigo-500" />
            What each column means
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-indigo-400 transition group-open/meanings:rotate-180" />
        </summary>
        <div className="space-y-6 border-t border-indigo-100/70 px-5 py-5">
          <div>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Apply</h3>
            <ApplyChoiceMeanings />
          </div>
          {MEANING_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-indigo-700">{group.title}</h3>
              <ManagerSettingMeanings settings={[...group.settings]} />
            </div>
          ))}
        </div>
      </details>
      <PaginatedTable
        columns={[
          { label: "Manager", className: "w-[13%]" },
          { label: MANAGER_SETTINGS.apply.column, className: "w-[16%]" },
          { label: MANAGER_SETTINGS.geminiMatching.column, className: "w-[9%]" },
          { label: MANAGER_SETTINGS.chatGptUrl.column, className: "w-[16%]" },
          { label: MANAGER_SETTINGS.textHighlights.column, className: "w-[9%]" },
          { label: MANAGER_SETTINGS.pageExclusions.column, className: "w-[9%]" },
          { label: MANAGER_SETTINGS.jobDetectionUrls.column, className: "w-[9%]" },
          { label: MANAGER_SETTINGS.linkedinSkips.column, className: "w-[10%]" },
          { label: MANAGER_SETTINGS.remoteCompanies.column, className: "w-[9%]" },
        ]}
        emptyMessage="No active Managers"
        rows={managerRows.map((manager) => {
          const managerName = managerNameOf(manager);
          return {
            id: manager.id,
            search: { name: manager.displayName ?? "", login: manager.loginName ?? "" },
            cells: [
              managerCell(manager),
              <ManagerApplyChoice choice={applyChoiceOf(manager)} key="apply" managerId={manager.id} managerName={managerName} />,
              <ManagerSettingSwitch key="gemini-matching" managerId={manager.id} managerName={managerName} on={manager.useGeminiMatching} setting="geminiMatching" />,
              <ManagerChatGptUrlCell chatGptUrl={manager.chatGptUrl} key="chatgpt-url" managerId={manager.id} managerName={managerName} />,
              <ManagerSettingSwitch key="text-highlights" managerId={manager.id} managerName={managerName} on={manager.canManageTextHighlights} setting="textHighlights" />,
              <ManagerSettingSwitch key="page-exclusions" managerId={manager.id} managerName={managerName} on={manager.canManagePageExclusions} setting="pageExclusions" />,
              <ManagerSettingSwitch key="job-detection-urls" managerId={manager.id} managerName={managerName} on={manager.canManageJobDetectionUrlRules} setting="jobDetectionUrls" />,
              <ManagerSettingSwitch key="linkedin-skips" managerId={manager.id} managerName={managerName} on={manager.canUseLinkedInSkips} setting="linkedinSkips" />,
              <ManagerSettingSwitch key="remote-companies" managerId={manager.id} managerName={managerName} on={manager.canViewRemoteCompanies} setting="remoteCompanies" />,
            ],
          };
        })}
        searchFields={[{ key: "name", label: "Name" }, { key: "login", label: "Login" }]}
      />
    </section>
  );
}

export async function PromptsTab() {
  const [activePrompts, libraryVersionRows, managerRows, managerPromptRows] = await Promise.all([
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
    loadManagers(),
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
    activePrompts.filter((prompt) => prompt.provider === provider && prompt.purpose === purpose);

  return (
    <section>
      <TabIntro title="Global prompt library">
        Managers write their own ChatGPT prompts. One without any uses the ChatGPT prompt marked Global default.
      </TabIntro>
      <div className="space-y-4">
        {promptGroups.map((group) => {
          const groupPrompts = promptsByPurpose(group.provider, group.purpose);
          const isChatGpt = group.provider === "openai";
          return (
            <Card key={`${group.provider}-${group.purpose}`}>
              {/* A new key after each added prompt empties the Create form for the next one. */}
              <ActionRow
                actions={[{
                  id: "create",
                  label: "Create new prompt",
                  icon: "create",
                  primary: true,
                  content: (
                    <GlobalPromptForm
                      key={`new-${groupPrompts.length}`}
                      name=""
                      promptTemplate=""
                      provider={group.provider}
                      purpose={group.purpose}
                      showHeading={false}
                    />
                  ),
                }]}
              >
                <CardTitle
                  icon={MessageSquareText}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {group.title}
                      <Badge tone={isChatGpt ? "emerald" : "sky"}>{isChatGpt ? "ChatGPT" : "Gemini"}</Badge>
                    </span>
                  }
                >
                  {groupPrompts.length === 1 ? "1 prompt" : `${groupPrompts.length} prompts`}
                </CardTitle>
              </ActionRow>
              {"note" in group && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">{group.note}</p>
              )}
              <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
                {groupPrompts.length === 0 && (
                  <li className="py-3 text-xs text-amber-700">No prompt for this task yet. Use Create new prompt.</li>
                )}
                {groupPrompts.map((prompt) => {
                  const versions = versionsByGroup.get(prompt.promptGroupId) ?? [];
                  return (
                    <li className="py-3" key={prompt.id}>
                      <ActionRow
                        actions={[
                          {
                            id: "edit",
                            label: "Edit",
                            icon: "edit",
                            content: (
                              <GlobalPromptForm
                                isDefault={prompt.isDefault}
                                name={prompt.name}
                                promptGroupId={prompt.promptGroupId}
                                promptTemplate={prompt.promptTemplate}
                                provider={prompt.provider}
                                purpose={prompt.purpose}
                                showHeading={false}
                                version={prompt.version}
                              />
                            ),
                          },
                          // Only ChatGPT document prompts keep a version history to choose from.
                          ...(prompt.purpose === "document_generation" && versions.length
                            ? [{
                                id: "versions",
                                label: `Versions (${versions.length})`,
                                icon: "versions" as const,
                                content: <PromptVersionPicker bare versions={versions} />,
                              }]
                            : []),
                        ]}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-slate-800">{prompt.name}</span>
                          <Badge>v{prompt.version}</Badge>
                          {prompt.isDefault && <Badge tone="indigo">Global default</Badge>}
                        </div>
                      </ActionRow>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8">
        <CardTitle icon={ListChecks} title="Managers' own prompts">
          The ChatGPT prompts each Manager wrote at My AI prompts. Super Admin can only read them.
        </CardTitle>
        <div className="mt-4">
        <PaginatedTable
          columns={[
            { label: "Manager", className: "w-[24%]" },
            { label: "Own prompts", className: "w-[76%]" },
          ]}
          emptyMessage="No active Managers"
          rows={managerRows.map((manager) => {
            const ownPrompts = groupVersions(managerPromptRows.filter((row) => row.ownerManagerId === manager.id));
            return {
              id: manager.id,
              search: { name: manager.displayName ?? "", login: manager.loginName ?? "" },
              cells: [
                managerCell(manager),
                <div className="min-w-0 space-y-2" key="own-prompts">
                  {ownPrompts.length === 0 ? (
                    <span className="text-xs text-slate-500">None · uses the default prompt</span>
                  ) : ownPrompts.map((prompt) => (
                    <div className="space-y-1" key={prompt.promptGroupId}>
                      <p className="text-xs font-medium text-slate-700">{prompt.name} · v{prompt.version}</p>
                      <PromptVersionPicker readOnly versions={prompt.versions} />
                    </div>
                  ))}
                </div>,
              ],
            };
          })}
          embedded
          searchFields={[{ key: "name", label: "Name" }, { key: "login", label: "Login" }]}
        />
        </div>
      </Card>
    </section>
  );
}

export async function GeneralTab() {
  const [jobRecordTimeZone, skipSites] = await Promise.all([getJobRecordTimeZone(), getGetJdSkipSites()]);
  const zoneLabel = jobRecordTimeZoneOptions.find((option) => option.value === jobRecordTimeZone)?.label;
  return (
    <section>
      <TabIntro title="General">Settings that apply to the whole system, not to one Manager.</TabIntro>
      <Card>
        <ActionRow
          actions={[{ id: "change", label: "Change", icon: "change", content: <JobRecordTimeZoneForm timeZone={jobRecordTimeZone} /> }]}
        >
          <CardTitle icon={Clock} title="Job record time zone">
            <p>The date saved on new jobs follows this time zone. Existing jobs keep their dates.</p>
            <p className="mt-2">
              <Badge tone="indigo">{zoneLabel ? `${zoneLabel} · ${jobRecordTimeZone}` : jobRecordTimeZone}</Badge>
            </p>
          </CardTitle>
        </ActionRow>
      </Card>
      <Card className="mt-4">
        <ActionRow
          actions={[{ id: "change", label: "Change", icon: "change", content: <GetJdSkipSitesForm sites={skipSites.sites} /> }]}
        >
          <CardTitle icon={Ban} title="Sites Get JD skips">
            <p>Get JD never reads these sites for any Manager: no panel, no duplicate check, no AI request. Each Manager can still block more sites of their own.</p>
            <p className="mt-2">
              <Badge tone="indigo">{`${skipSites.sites.length} site${skipSites.sites.length === 1 ? "" : "s"}`}</Badge>
              {!skipSites.saved && <span className="ml-2 text-xs text-fg-muted">The starting list; not changed yet.</span>}
            </p>
          </CardTitle>
        </ActionRow>
      </Card>
    </section>
  );
}

export async function OldTab() {
  const [managerRows, libraryRows, questionSuggestions, answerVersions, managerAnswerRows] = await Promise.all([
    loadManagers(),
    listLibrary(),
    listQuestionSuggestions(),
    listVersions(),
    db.select({ id: managerApplyAnswers.id, questionText: managerApplyAnswers.questionText, answer: managerApplyAnswers.answer, manager: users.displayName })
      .from(managerApplyAnswers).innerJoin(users, eq(users.id, managerApplyAnswers.managerId)).where(eq(managerApplyAnswers.scope, "manager")),
  ]);
  // Approved answers were what Apply used; drafts wait for review; rejected ones are kept so learning
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

  return (
    <section>
      <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <Archive aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="text-xs leading-5 text-amber-900">
          <p className="font-semibold">Normal Apply and Auto Apply do not use this tab, with one exception.</p>
          <p>
            Under Older Apply settings, Answer AI still picks which application-answer prompt Auto Apply sends to
            ChatGPT for a Manager with Auto Apply with APIs off. Everything else here is kept for reference and for
            the developer test run.
          </p>
        </div>
      </div>

      <div className="space-y-4">
      <Card>
        <ActionRow actions={[{ id: "open", label: "Open", icon: "open", content: (
        <>
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
        <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">Drafts waiting for review ({draftRows.length})</h3>
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

        <h3 className="mb-1 mt-6 text-xs font-semibold text-slate-700">Suggestions from applications ({questionSuggestions.length})</h3>
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
        </>
        ) }]}>
          <CardTitle icon={Archive} title="Legacy global answers">
            <p>
              The old shared answer library. Apply and Auto Apply no longer load these answers; Managers keep their
              own answers in Profile.
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              <Badge>{reusableAnswerRows.length} answers</Badge>
              {draftRows.length > 0 && <Badge tone="amber">{draftRows.length} drafts to review</Badge>}
              {questionSuggestions.length > 0 && <Badge>{questionSuggestions.length} suggestions</Badge>}
            </p>
          </CardTitle>
        </ActionRow>
      </Card>

      <Card>
        <ActionRow actions={[{ id: "open", label: "Open", icon: "open", content: (
        <>
        <div className="mb-4 rounded-xl bg-white p-4">
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
            const managerName = managerNameOf(manager);
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
        </>
        ) }]}>
          <CardTitle icon={Archive} title="Older Apply settings">
            <p>Used only by the developer test run, apart from the Answer AI prompt choice described above.</p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              <Badge>Answer AI</Badge>
              <Badge>Review</Badge>
              <Badge>Submit</Badge>
            </p>
          </CardTitle>
        </ActionRow>
      </Card>
      </div>
    </section>
  );
}
