"use client";

import { useActionState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { deleteManagerPromptAction, saveManagerPromptAction } from "@/app/prompts/actions";
import type { PromptActionState } from "@/app/settings/actions";
import { ActionFeedback } from "@/app/settings/prompt-forms";

const initialState: PromptActionState = { error: null, success: null };

// Adds a prompt to the Manager's rotation, or, with promptGroupId, saves a new version of one.
export function ManagerPromptForm({
  promptGroupId,
  name = "",
  promptTemplate = "",
}: {
  promptGroupId?: string;
  name?: string;
  promptTemplate?: string;
}) {
  const [state, formAction, isPending] = useActionState(saveManagerPromptAction, initialState);
  const fieldKey = promptGroupId ?? "new";

  return (
    <form action={formAction} className="space-y-3">
      {promptGroupId && <input name="promptGroupId" type="hidden" value={promptGroupId} />}
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`managerPromptName-${fieldKey}`}>
        Prompt name
      </label>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={name}
        id={`managerPromptName-${fieldKey}`}
        maxLength={120}
        name="name"
        placeholder="e.g. Concise, achievement-focused"
        required
      />
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`managerPromptText-${fieldKey}`}>
        Resume and cover-letter prompt
      </label>
      <textarea
        className="min-h-48 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={promptTemplate}
        id={`managerPromptText-${fieldKey}`}
        maxLength={50000}
        name="promptTemplate"
        required
        rows={8}
      />
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending
          ? <LoadingIcon className="size-3.5" />
          : promptGroupId ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
        {isPending ? "Saving..." : promptGroupId ? "Save new version" : "Add prompt"}
      </button>
    </form>
  );
}

export function DeleteManagerPromptForm({ promptGroupId, name }: { promptGroupId: string; name: string }) {
  const [state, formAction, isPending] = useActionState(deleteManagerPromptAction, initialState);
  return (
    <form
      action={formAction}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm(`Delete "${name}"? It leaves your rotation; jobs and bids that used it still show it.`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="promptGroupId" type="hidden" value={promptGroupId} />
      <button
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-3 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Trash2 className="size-3.5" />}
        {isPending ? "Deleting..." : "Delete"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}
