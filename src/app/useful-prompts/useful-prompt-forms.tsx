"use client";

import { Check, Copy, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import type { PromptActionState } from "@/app/settings/actions";
import { ActionFeedback } from "@/app/settings/prompt-forms";
import {
  deleteUsefulPromptAction,
  restoreUsefulPromptAction,
  saveUsefulPromptAction,
} from "@/app/useful-prompts/actions";
import {
  USEFUL_PROMPT_CONTENT_MAX,
  USEFUL_PROMPT_TITLE_MAX,
  type UsefulPromptVersion,
} from "@/server/useful-prompts/useful-prompt-values";

const initialState: PromptActionState = { error: null, success: null };
const inputClass = "w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

/** A saved time in the viewer's own time zone. */
export function SavedAt({ value }: { value: string }) {
  return (
    <time dateTime={value} suppressHydrationWarning>
      {new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

// Adds a prompt, or with promptKey saves a new version of one. A new prompt's form empties once added.
export function UsefulPromptForm({ promptKey, title = "", content = "" }: { promptKey?: string; title?: string; content?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(async (previous: PromptActionState, formData: FormData) => {
    const result = await saveUsefulPromptAction(previous, formData);
    if (result.success && !promptKey) formRef.current?.reset();
    return result;
  }, initialState);
  const fieldKey = promptKey ?? "new";

  return (
    <form action={formAction} className="space-y-3" ref={formRef}>
      {promptKey && <input name="promptKey" type="hidden" value={promptKey} />}
      <div>
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`usefulPromptTitle-${fieldKey}`}>Title</label>
        <input
          className={`${inputClass} mt-1 h-10`}
          defaultValue={title}
          id={`usefulPromptTitle-${fieldKey}`}
          maxLength={USEFUL_PROMPT_TITLE_MAX}
          name="title"
          placeholder="e.g. Rewrite a rejection reply"
          required
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`usefulPromptContent-${fieldKey}`}>Prompt</label>
        <textarea
          className={`${inputClass} mt-1 min-h-48 resize-y py-2 font-mono text-xs leading-5`}
          defaultValue={content}
          id={`usefulPromptContent-${fieldKey}`}
          maxLength={USEFUL_PROMPT_CONTENT_MAX}
          name="content"
          required
          rows={10}
        />
      </div>
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : promptKey ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
        {isPending ? "Saving..." : promptKey ? "Save new version" : "Add prompt"}
      </button>
    </form>
  );
}

export function CopyPromptButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      type="button"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function DeleteUsefulPromptForm({ promptKey, title }: { promptKey: string; title: string }) {
  const [state, formAction, isPending] = useActionState(deleteUsefulPromptAction, initialState);
  return (
    <form action={formAction}>
      <input name="promptKey" type="hidden" value={promptKey} />
      <ConfirmButton
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        confirmLabel="Delete prompt"
        description={<>Delete “{title}” and all its versions? This cannot be undone.</>}
        disabled={isPending}
        title="Delete this prompt?"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Trash2 className="size-3.5" />}
        {isPending ? "Deleting..." : "Delete"}
      </ConfirmButton>
      {state.error && <p className="mt-1 text-[11px] text-rose-700" role="alert">{state.error}</p>}
    </form>
  );
}

// Every earlier version: when it was saved, its title and text, to copy or put back as the newest.
export function UsefulPromptHistory({ versions }: { versions: UsefulPromptVersion[] }) {
  const earlier = versions.slice(1);
  if (!earlier.length) return <p className="text-[11px] text-slate-500">No earlier versions yet. Each save adds one.</p>;
  return (
    <details className="rounded-lg border border-slate-200">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <History className="size-3.5 text-slate-500" />
        History ({versions.length} versions)
      </summary>
      <ol className="divide-y divide-slate-100 border-t border-slate-100">
        {earlier.map((version) => <HistoryEntry key={version.id} version={version} />)}
      </ol>
    </details>
  );
}

function HistoryEntry({ version }: { version: UsefulPromptVersion }) {
  const [state, formAction, isPending] = useActionState(restoreUsefulPromptAction, initialState);
  return (
    <li>
      <details className="group/version">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">v{version.version}</span>
          <span className="text-slate-500"><SavedAt value={version.savedAt} /></span>
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{version.title}</span>
        </summary>
        <div className="space-y-2 px-3 pb-3">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">
            {version.content}
          </pre>
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input name="versionId" type="hidden" value={version.id} />
            <CopyPromptButton text={version.content} />
            <button
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? <LoadingIcon className="size-3.5" /> : <RotateCcw className="size-3.5" />}
              {isPending ? "Restoring..." : `Restore version ${version.version}`}
            </button>
          </form>
          <ActionFeedback state={state} />
        </div>
      </details>
    </li>
  );
}
