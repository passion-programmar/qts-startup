import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { DeleteManagerPromptForm, ManagerPromptForm } from "@/app/prompts/prompt-forms";
import { groupVersions } from "@/app/prompts/prompt-groups";
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
            description="Generation rotates through your prompts one by one, and through every PDF template. With no prompts of your own, Super Admin's default prompt is used."
            title="My AI prompts"
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800">
              My prompts ({myPrompts.length})
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {myPrompts.length === 0
                ? "You have no prompts yet, so Generation uses the default prompt below."
                : myPrompts.length === 1
                  ? "Generation uses this prompt for every job."
                  : `Generation uses these ${myPrompts.length} prompts in turn, the one used longest ago first.`}
              {" "}Saving a change adds a version; earlier versions are kept and can be put back in use.
            </p>
            <div className="mt-5 space-y-6">
              {myPrompts.map((prompt) => (
                <article className="space-y-3 border-t border-slate-100 pt-5" key={prompt.promptGroupId}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-800">{prompt.name}</h3>
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
                </article>
              ))}
            </div>
            <details className="mt-6 rounded-lg border border-dashed border-slate-300 p-4" open={myPrompts.length === 0}>
              <summary className="cursor-pointer text-xs font-semibold text-indigo-700">Add a prompt</summary>
              <div className="mt-4">
                <ManagerPromptForm />
              </div>
            </details>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800">Default prompt</h2>
            {defaultPrompt ? (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  {defaultPrompt.name} · Version {defaultPrompt.version} · set by Super Admin.
                  {myPrompts.length > 0 ? " Not used while you have prompts of your own." : " Used for all your jobs now."}
                </p>
                <pre className="mt-4 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-5 text-slate-700">
                  {defaultPrompt.promptTemplate}
                </pre>
              </>
            ) : (
              <p className="mt-1 text-xs text-amber-700">
                Super Admin has not set a default prompt. Add a prompt of your own before starting Generation.
              </p>
            )}
          </section>
        </div>
      </main>
    </WorkspaceShell>
  );
}
