import { NotebookPen, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { FormCard } from "@/app/components/form-card";
import { Badge } from "@/app/ui/badge";
import { PageHeader } from "@/app/ui/page-header";
import {
  CopyPromptButton,
  DeleteUsefulPromptForm,
  SavedAt,
  UsefulPromptForm,
  UsefulPromptHistory,
} from "@/app/useful-prompts/useful-prompt-forms";
import { requireUser } from "@/lib/session";
import { listUsefulPrompts } from "@/server/useful-prompts/useful-prompts";

export const instant = false;

export default async function UsefulPromptsPage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  const prompts = await listUsefulPrompts(currentUser.id);

  return (
      <main className="mx-auto max-w-4xl space-y-3 py-1 text-fg">
          <PageHeader
            actions={<Badge className="px-3 py-1 text-xs">{prompts.length} saved</Badge>}
            description="Prompts you keep for special cases. Jobs, Generation and Apply never use them. Each save adds a version, and earlier versions stay in the history."
            title="Useful prompts"
          />
          <FormCard
            defaultOpen={prompts.length === 0}
            icon={<Plus />}
            summary="A title and the prompt text"
            title="Add a prompt"
          >
            <UsefulPromptForm />
          </FormCard>
          {prompts.map((prompt) => (
            <FormCard
              actions={
                <>
                  <CopyPromptButton text={prompt.content} />
                  <DeleteUsefulPromptForm promptKey={prompt.promptKey} title={prompt.title} />
                </>
              }
              icon={<NotebookPen />}
              key={prompt.promptKey}
              summary={<>Version {prompt.version} · updated <SavedAt value={prompt.updatedAt} /></>}
              title={prompt.title}
            >
              {/* Keyed by version so the form shows the newest text after a save or restore. */}
              <UsefulPromptForm content={prompt.content} key={prompt.version} promptKey={prompt.promptKey} title={prompt.title} />
              <UsefulPromptHistory versions={prompt.versions} />
            </FormCard>
          ))}
      </main>
  );
}
