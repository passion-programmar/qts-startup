import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { DeleteManagerPromptForm, ManagerPromptForm } from "@/app/prompts/prompt-forms";
import { groupVersions } from "@/app/prompts/prompt-groups";
import { PromptCards } from "@/app/prompts/prompt-cards";
import { PromptVersionPicker } from "@/app/settings/prompt-forms";
import { prompts } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const instant = false;

export default async function ManagerPromptsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");

  const [versionRows, defaultRows] = await Promise.all([
    // Every version of this Manager's own prompts, oldest prompt first, newest version first.
    db
      .select({
        id: prompts.id,
        promptGroupId: prompts.promptGroupId,
        name: prompts.name,
        promptTemplate: prompts.promptTemplate,
        version: prompts.version,
        isActive: prompts.isActive,
        createdAt: prompts.createdAt,
      })
      .from(prompts)
      .where(and(
        eq(prompts.ownerManagerId, currentUser.id),
        eq(prompts.purpose, "document_generation"),
        isNull(prompts.archivedAt),
      ))
      .orderBy(desc(prompts.version)),
    db
      .select({ name: prompts.name, version: prompts.version, promptTemplate: prompts.promptTemplate })
      .from(prompts)
      .where(and(
        isNull(prompts.ownerManagerId),
        eq(prompts.provider, "openai"),
        eq(prompts.purpose, "document_generation"),
        eq(prompts.isActive, true),
        eq(prompts.isDefault, true),
      ))
      .orderBy(asc(prompts.createdAt))
      .limit(1),
  ]);

  const myPrompts = groupVersions(versionRows);
  const defaultPrompt = defaultRows[0];

  return (
    <WorkspaceShell activeHref="/prompts" user={currentUser}>
      <main className="py-1 text-slate-900">
        <div className="mx-auto max-w-4xl space-y-6">
          <PageHeader
            description="Generation rotates through your prompts by least-recent use, or you can choose an active prompt for a queued job. Candidate/job data and the protected output format are supplied automatically. With no prompts of your own, Super Admin's default prompt is used."
            title="My AI prompts"
          />

          <p className="text-xs text-slate-500">
            {myPrompts.length === 0
              ? "You have no prompts yet, so Generation uses the default prompt. Click + to add one."
              : myPrompts.length === 1
                ? "Generation uses your prompt for every job."
                : `Generation uses your ${myPrompts.length} prompts in least-recent-use order unless you choose one for a queued job.`}
            {" "}Click a prompt to open it. Saving a change adds a version; earlier versions are kept and can be put back in use.
          </p>

          <PromptCards
            create={<ManagerPromptForm />}
            tabs={myPrompts.map((prompt) => ({
              id: prompt.promptGroupId,
              label: prompt.name,
              meta: `Version ${prompt.version} in use`,
              preview: prompt.promptTemplate.slice(0, 200),
              content: (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-800">{prompt.name}</h2>
                      <p className="mt-1 text-[11px] text-slate-500">Version {prompt.version} in use</p>
                    </div>
                    <DeleteManagerPromptForm name={prompt.name} promptGroupId={prompt.promptGroupId} />
                  </div>
                  {/* Keyed by the active version so the form resets when another version is put in use. */}
                  <ManagerPromptForm
                    key={prompt.activeId}
                    name={prompt.name}
                    promptGroupId={prompt.promptGroupId}
                    promptTemplate={prompt.promptTemplate}
                  />
                  {prompt.versions.length > 1 && <PromptVersionPicker versions={prompt.versions} />}
                </div>
              ),
            }))}
            trailing={[{
              id: "default",
              label: "Default prompt",
              meta: defaultPrompt
                ? `Super Admin · ${myPrompts.length > 0 ? "not used while you have your own" : "in use now"}`
                : "Not set by Super Admin",
              preview: defaultPrompt?.promptTemplate.slice(0, 200),
              content: (
                <>
                  <h2 className="text-sm font-semibold text-slate-800">Default prompt</h2>
                  {defaultPrompt ? (
                    <>
                      <p className="mt-1 text-xs text-slate-500">
                        {defaultPrompt.name} · Version {defaultPrompt.version} · set by Super Admin.
                        {myPrompts.length > 0 ? " Not used while you have prompts of your own." : " Used for all your jobs now."}
                      </p>
                      <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-700">
                        {defaultPrompt.promptTemplate}
                      </pre>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-amber-700">
                      Super Admin has not set a default prompt. Add a prompt of your own before starting Generation.
                    </p>
                  )}
                </>
              ),
            }]}
          />
        </div>
      </main>
    </WorkspaceShell>
  );
}
