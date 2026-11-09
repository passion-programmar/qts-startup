"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  activatePromptVersionAction,
  saveGlobalPromptAction,
  updateOwnChatGptUrlAction,
  updateOwnAutoApplyParallelLimitAction,
  type PromptActionState,
} from "@/app/settings/actions";

const initialState: PromptActionState = { error: null, success: null };

type PromptProvider = "openai" | "gemini";
type PromptPurpose =
  | "document_generation"
  | "job_description_evaluation"
  | "application_answer";

// Super Admin's library prompt. The ChatGPT default is what Managers without prompts use.
export function GlobalPromptForm({
  provider,
  purpose,
  promptGroupId,
  name,
  promptTemplate,
  version,
  isDefault,
}: {
  provider: PromptProvider;
  purpose: PromptPurpose;
  promptGroupId?: string;
  name: string;
  promptTemplate: string;
  version?: number;
  isDefault?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    saveGlobalPromptAction,
    initialState,
  );
  const fieldKey = promptGroupId ?? `${provider}-${purpose}`;

  return (
    <form action={formAction} className="space-y-3">
      <input name="provider" type="hidden" value={provider} />
      <input name="purpose" type="hidden" value={purpose} />
      {promptGroupId && (
        <input name="promptGroupId" type="hidden" value={promptGroupId} />
      )}
      <div>
        <p className="text-xs font-semibold text-slate-800">{name}</p>
        <p className="mt-1 text-[10px] text-slate-400">
          {provider === "openai" ? "ChatGPT" : "Gemini"} · {purposeLabel(purpose)}
          {version ? ` · Version ${version}` : " · New prompt"}
          {isDefault ? " · Global default" : ""}
        </p>
      </div>
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`promptName-${fieldKey}`}>
        Prompt name
      </label>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={name}
        id={`promptName-${fieldKey}`}
        maxLength={120}
        name="name"
        required
      />
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`promptTemplate-${fieldKey}`}>
        Prompt template
      </label>
      <textarea
        className="min-h-48 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={promptTemplate}
        id={`promptTemplate-${fieldKey}`}
        maxLength={50000}
        name="promptTemplate"
        required
        rows={8}
      />
      {!isDefault && (
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input className="accent-indigo-600" name="makeDefault" type="checkbox" />
          Make this the global default prompt for this task
        </label>
      )}
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : promptGroupId ? "Save new version" : "Create prompt"}
      </button>
    </form>
  );
}

export type PromptVersion = {
  id: string;
  version: number;
  isActive: boolean;
  promptTemplate: string;
  // YYYY-MM-DD, formatted on the server so it reads the same before and after hydration.
  savedOn: string;
};

// Every saved version of one ChatGPT prompt. Any of them can be previewed and an earlier one put
// back in use; nothing is deleted. With readOnly (Super Admin viewing a Manager's prompt) it
// only previews.
export function PromptVersionPicker({
  versions,
  readOnly = false,
}: {
  versions: PromptVersion[];
  readOnly?: boolean;
}) {
  const active = versions.find((version) => version.isActive);
  const [selectedId, setSelectedId] = useState(active?.id ?? versions[0]?.id ?? "");
  const [state, formAction, isPending] = useActionState(
    activatePromptVersionAction,
    initialState,
  );
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0];
  if (!selected) return null;

  return (
    <details className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-[11px] font-semibold text-slate-700">
        Versions ({versions.length}){active ? ` · v${active.version} in use` : ""}
      </summary>
      <form action={formAction} className="mt-3 space-y-3">
        <label className="sr-only" htmlFor={`version-${selected.id}`}>Version</label>
        <select
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:max-w-md"
          id={`version-${selected.id}`}
          name="promptId"
          onChange={(event) => setSelectedId(event.target.value)}
          value={selected.id}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.version} · {version.savedOn}{version.isActive ? " · in use" : ""}
            </option>
          ))}
        </select>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">
          {selected.promptTemplate}
        </pre>
        {!readOnly && (
          <>
            <ActionFeedback state={state} />
            <button
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              disabled={isPending || selected.isActive}
              type="submit"
            >
              {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
              {selected.isActive ? "In use" : isPending ? "Saving..." : `Use version ${selected.version}`}
            </button>
          </>
        )}
      </form>
    </details>
  );
}

export function OwnChatGptUrlForm({ chatGptUrl }: { chatGptUrl: string }) {
  const [state, formAction, isPending] = useActionState(updateOwnChatGptUrlAction, initialState);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-xs font-semibold text-slate-700" htmlFor="own-chatgpt-url">
        Your ChatGPT Project URL
      </label>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={chatGptUrl}
        id="own-chatgpt-url"
        maxLength={2048}
        name="chatGptUrl"
        placeholder="https://chatgpt.com/g/g-p-..."
        type="url"
      />
      <p className="text-xs leading-5 text-slate-500">
        Generation and Apply use this URL to open a fresh ChatGPT conversation for each job. Leave it blank to use chatgpt.com.
      </p>
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save URL"}
      </button>
    </form>
  );
}

export function OwnAutoApplyParallelLimitForm({ parallelLimit }: { parallelLimit: number }) {
  const [state, formAction, isPending] = useActionState(updateOwnAutoApplyParallelLimitAction, initialState);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-xs font-semibold text-slate-700" htmlFor="auto-apply-parallel-limit">
        Maximum open applications
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="h-10 w-24 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          defaultValue={parallelLimit}
          id="auto-apply-parallel-limit"
          max={10}
          min={1}
          name="autoApplyParallelLimit"
          required
          type="number"
        />
        <span className="text-xs text-slate-500">1–10 jobs across Apply and Auto Apply · default 2</span>
      </div>
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save concurrency"}
      </button>
    </form>
  );
}

function purposeLabel(purpose: PromptPurpose): string {
  switch (purpose) {
    case "document_generation":
      return "Resume and cover-letter generation";
    case "job_description_evaluation":
      return "Job-description evaluation";
    case "application_answer":
      return "Application-answer generation";
  }
}

export function ActionFeedback({ state }: { state: PromptActionState }) {
  if (!state.error && !state.success) return null;
  const isError = Boolean(state.error);

  return (
    <p
      aria-live="polite"
      className={`rounded-lg border px-3 py-2 text-[11px] ${
        isError
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      }`}
      role={isError ? "alert" : "status"}
    >
      {state.error ?? state.success}
    </p>
  );
}
