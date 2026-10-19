import { and, eq } from "drizzle-orm";
import Link from "next/link";
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
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">
              Manager workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">My AI prompt</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Your ChatGPT prompt is shared by resume and cover-letter
              generation. Gemini application prompts are managed by Super Admin
              and are not available here.
            </p>
          </div>
          <Link
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            href="/"
          >
            Back to dashboard
          </Link>
        </header>

        {!privateMode ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800">
              Global prompt mode is active
            </h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Your generation uses the Super Admin global ChatGPT prompt
              {assignedPromptName
                ? `, overridden by the assigned prompt “${assignedPromptName}”.`
                : "."}{" "}
              Private prompt editing is disabled until Super Admin changes the
              prompt mode.
            </p>
          </section>
        ) : defaultPrompt ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-800">
                Private ChatGPT prompt
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {savedPrivatePrompt
                  ? "Your saved private prompt is shown below."
                  : "No private prompt has been saved yet. The global prompt is prefilled as your starting point."}
              </p>
            </div>
            <ManagerPromptForm
              assignedPromptName={assignedPromptName}
              promptTemplate={savedPrivatePrompt ?? defaultPrompt}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            A global ChatGPT prompt has not been configured yet. Please contact
            Super Admin before saving a private prompt.
          </section>
        )}
      </div>
    </main>
  );
}
