"use client";

import { useActionState, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  assignPromptAction,
  saveGlobalPromptAction,
  saveManagerOwnPromptAction,
  saveManagerTemplatesAction,
  updateManagerTextHighlightAccessAction,
  updateManagerPageExclusionAccessAction,
  updateManagerJobDetectionUrlAccessAction,
  unassignPromptAction,
  updatePromptModeAction,
  updateManagerGeminiMatchingAction,
  type PromptActionState,
} from "@/app/settings/actions";
import { pdfTemplateLabels, pdfTemplateValues } from "@/server/pdf/pdf-templates";

const initialState: PromptActionState = { error: null, success: null };

type PromptProvider = "openai" | "gemini";
type PromptPurpose =
  | "document_generation"
  | "job_description_evaluation"
  | "application_answer";

export function PromptModeForm({ mode }: { mode: "global" | "private" }) {
  const [state, formAction, isPending] = useActionState(
    updatePromptModeAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label
          className="mb-2 block text-xs font-semibold text-slate-700"
          htmlFor="promptMode"
        >
          Assigned prompt visibility
        </label>
        <select
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 sm:max-w-sm"
          defaultValue={mode}
          id="promptMode"
          name="promptMode"
        >
          <option value="global">Managers see assigned prompt names only</option>
          <option value="private">Managers can read assigned prompts</option>
        </select>
        <p className="mt-2 text-[11px] text-slate-500">
          Managers always see and edit their own prompt on the My AI prompt page.
        </p>
      </div>
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save prompt mode"}
      </button>
    </form>
  );
}

export function ManagerGeminiMatchingForm({
  managerId,
  useGemini,
}: {
  managerId: string;
  useGemini: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    updateManagerGeminiMatchingAction,
    initialState,
  );

  return (
    <div className="min-w-0 space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input name="managerId" type="hidden" value={managerId} />
        <input name="enabled" type="hidden" value={String(!useGemini)} />
        <span className={`text-xs font-medium ${useGemini ? "text-emerald-700" : "text-slate-500"}`}>
          {useGemini ? "Gemini matching" : "General matching"}
        </span>
        <button
          className={`inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold disabled:opacity-60 ${
            useGemini
              ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
          disabled={isPending}
          type="submit"
        >
          {isPending && <LoadingIcon className="mr-1 size-3.5" />}
          {isPending ? "Saving..." : useGemini ? "Remove Gemini" : "Assign Gemini"}
        </button>
      </form>
      <ActionFeedback state={state} />
    </div>
  );
}

export function GlobalPromptForm({
  provider,
  purpose,
  promptGroupId,
  name,
  promptTemplate,
  version,
  isDefault,
  categoryId,
  categories = [],
}: {
  provider: PromptProvider;
  purpose: PromptPurpose;
  promptGroupId?: string;
  name: string;
  promptTemplate: string;
  version?: number;
  isDefault?: boolean;
  categoryId?: string | null;
  categories?: CategoryOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    saveGlobalPromptAction,
    initialState,
  );
  const title = purposeLabel(purpose);
  // Document prompts reach Managers only through assignments, so a global default has no effect there.
  const usesDefault = purpose !== "document_generation";

  return (
    <form action={formAction} className="space-y-3">
      <input name="provider" type="hidden" value={provider} />
      <input name="purpose" type="hidden" value={purpose} />
      {promptGroupId && (
        <input name="promptGroupId" type="hidden" value={promptGroupId} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-800">{name}</p>
          <p className="mt-1 text-[10px] text-slate-400">
            {provider === "openai" ? "ChatGPT" : "Gemini"} · {title}
            {version ? ` · Version ${version}` : " · New prompt"}
            {isDefault && usesDefault ? " · Global default" : ""}
          </p>
        </div>
        {!usesDefault && promptGroupId && !categoryId && (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
            No category · not used
          </span>
        )}
      </div>
      {!usesDefault && (
        <>
          <label
            className="block text-[11px] font-semibold text-slate-600"
            htmlFor={`promptCategory-${promptGroupId ?? `${provider}-${purpose}`}`}
          >
            Category
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 sm:max-w-sm"
            defaultValue={categoryId ?? ""}
            id={`promptCategory-${promptGroupId ?? `${provider}-${purpose}`}`}
            name="categoryId"
            required
          >
            <option disabled value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </>
      )}
      <label
        className="block text-[11px] font-semibold text-slate-600"
        htmlFor={`promptName-${promptGroupId ?? `${provider}-${purpose}`}`}
      >
        Prompt name
      </label>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={name}
        id={`promptName-${promptGroupId ?? `${provider}-${purpose}`}`}
        maxLength={120}
        name="name"
        required
      />
      <label
        className="block text-[11px] font-semibold text-slate-600"
        htmlFor={`promptTemplate-${promptGroupId ?? `${provider}-${purpose}`}`}
      >
        Prompt template
      </label>
      <textarea
        className="min-h-48 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={promptTemplate}
        id={`promptTemplate-${promptGroupId ?? `${provider}-${purpose}`}`}
        maxLength={50000}
        name="promptTemplate"
        required
        rows={8}
      />
      {!isDefault && usesDefault && (
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

type CategoryOption = { id: string; name: string };
type PromptOption = { id: string; name: string; version: number; categoryName: string | null };

function promptLabel(prompt: PromptOption): string {
  return `${prompt.name} · ${prompt.categoryName ?? "No category"} · v${prompt.version}`;
}

export function PromptAssignmentForm({
  managerId,
  assignedPrompts,
  prompts,
}: {
  managerId: string;
  assignedPrompts: PromptOption[];
  prompts: PromptOption[];
}) {
  const [assignState, assignAction, assignPending] = useActionState(
    assignPromptAction,
    initialState,
  );
  // Only the most recent form reports, so an old "added" note never sits beside "removed".
  const [lastSubmitted, setLastSubmitted] = useState<"assign" | "unassign" | null>(null);
  const [unassignState, unassignAction, unassignPending] = useActionState(
    unassignPromptAction,
    initialState,
  );
  const assignedIds = new Set(assignedPrompts.map((prompt) => prompt.id));
  const available = prompts.filter((prompt) => !assignedIds.has(prompt.id));

  return (
    <div className="min-w-0 space-y-2">
      <p className="text-[11px] text-slate-500">
        {assignedPrompts.length === 0
          ? "No prompts assigned · uses the Manager's own prompt"
          : "Each candidate gets only the prompts for their category, in rotation"}
      </p>
      {assignedPrompts.length > 0 && (
        <ul className="space-y-1">
          {assignedPrompts.map((prompt) => (
            <li className="flex items-center justify-between gap-2" key={prompt.id}>
              <span
                className={`min-w-0 truncate text-xs ${prompt.categoryName ? "text-slate-700" : "text-amber-700"}`}
              >
                {promptLabel(prompt)}
              </span>
              <form action={unassignAction} onSubmit={() => setLastSubmitted("unassign")}>
                <input name="managerId" type="hidden" value={managerId} />
                <input name="promptId" type="hidden" value={prompt.id} />
                <button
                  aria-label={`Remove ${prompt.name}`}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-200 px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  disabled={unassignPending}
                  type="submit"
                >
                  {unassignPending ? <LoadingIcon className="size-3" /> : <Trash2 className="size-3" />}
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={assignAction} className="flex flex-col gap-2 sm:flex-row" onSubmit={() => setLastSubmitted("assign")}>
        <input name="managerId" type="hidden" value={managerId} />
        <select
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          defaultValue=""
          key={available.map((prompt) => prompt.id).join()}
          name="promptChoice"
          required
        >
          <option disabled value="">
            {available.length > 0 ? "Choose a prompt" : "All prompts assigned"}
          </option>
          {available.map((prompt) => (
            <option disabled={!prompt.categoryName} key={prompt.id} value={prompt.id}>
              {promptLabel(prompt)}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={assignPending || available.length === 0}
          type="submit"
        >
          {assignPending ? <LoadingIcon className="size-3.5" /> : <Plus className="size-3.5" />}
          {assignPending ? "Saving..." : "Add"}
        </button>
      </form>
      {lastSubmitted === "assign" && <ActionFeedback state={assignState} />}
      {lastSubmitted === "unassign" && <ActionFeedback state={unassignState} />}
    </div>
  );
}

// Templates an assigned Manager rotates through; with none ticked, each candidate's own template is used.
export function ManagerTemplatesForm({
  managerId,
  selected,
}: {
  managerId: string;
  selected: string[];
}) {
  const [state, formAction, isPending] = useActionState(
    saveManagerTemplatesAction,
    initialState,
  );
  const selectedSet = new Set(selected);

  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-[11px] font-medium text-slate-600">
        {selected.length === 0
          ? "Templates: candidate's own"
          : `Templates: ${selected.length} in rotation`}
      </summary>
      <form action={formAction} className="mt-2 space-y-2">
        <input name="managerId" type="hidden" value={managerId} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {pdfTemplateValues.map((template) => (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700" key={template}>
              <input
                className="accent-indigo-600"
                defaultChecked={selectedSet.has(template)}
                name="templates"
                type="checkbox"
                value={template}
              />
              {pdfTemplateLabels[template]}
            </label>
          ))}
        </div>
        <ActionFeedback state={state} />
        <button
          className="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-900 px-3 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
          {isPending ? "Saving..." : "Save templates"}
        </button>
      </form>
    </details>
  );
}

// The Manager's own prompt. Managers edit theirs on /prompts; Super Admin passes managerId from Settings.
export function ManagerOwnPromptForm({
  managerId,
  promptTemplate,
}: {
  managerId?: string;
  promptTemplate: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    saveManagerOwnPromptAction,
    initialState,
  );
  const fieldId = `ownPrompt-${managerId ?? "self"}`;

  return (
    <form action={formAction} className="space-y-3">
      {managerId && <input name="managerId" type="hidden" value={managerId} />}
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor={fieldId}>
        Resume and cover-letter prompt
      </label>
      <textarea
        className="min-h-48 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        defaultValue={promptTemplate ?? ""}
        id={fieldId}
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
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save prompt"}
      </button>
    </form>
  );
}

export function ManagerTextHighlightAccessForm({
  managerId,
  canManage,
}: {
  managerId: string;
  canManage: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    updateManagerTextHighlightAccessAction,
    initialState,
  );

  return (
    <div className="min-w-0 space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input name="managerId" type="hidden" value={managerId} />
        <input name="enabled" type="hidden" value={String(!canManage)} />
        <span className={`text-xs font-medium ${canManage ? "text-emerald-700" : "text-slate-500"}`}>
          {canManage ? "Can manage shared highlights" : "View highlights only"}
        </span>
        <button
          className={`inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold disabled:opacity-60 ${
            canManage
              ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
          disabled={isPending}
          type="submit"
        >
          {isPending && <LoadingIcon className="mr-1 size-3.5" />}
          {isPending ? "Saving..." : canManage ? "Remove access" : "Assign access"}
        </button>
      </form>
      <ActionFeedback state={state} />
    </div>
  );
}

export function ManagerPageExclusionAccessForm({
  managerId,
  canManage,
}: {
  managerId: string;
  canManage: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    updateManagerPageExclusionAccessAction,
    initialState,
  );

  return (
    <div className="min-w-0 space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input name="managerId" type="hidden" value={managerId} />
        <input name="enabled" type="hidden" value={String(!canManage)} />
        <span className={`text-xs font-medium ${canManage ? "text-emerald-700" : "text-slate-500"}`}>
          {canManage ? "Can manage job-page detection keywords" : "No job-page keyword access"}
        </span>
        <button
          className={`inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold disabled:opacity-60 ${
            canManage
              ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
          disabled={isPending}
          type="submit"
        >
          {isPending && <LoadingIcon className="mr-1 size-3.5" />}
          {isPending ? "Saving..." : canManage ? "Remove access" : "Assign access"}
        </button>
      </form>
      <ActionFeedback state={state} />
    </div>
  );
}

export function ManagerJobDetectionUrlAccessForm({
  managerId,
  canManage,
}: {
  managerId: string;
  canManage: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    updateManagerJobDetectionUrlAccessAction,
    initialState,
  );

  return (
    <div className="min-w-0 space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input name="managerId" type="hidden" value={managerId} />
        <input name="enabled" type="hidden" value={String(!canManage)} />
        <span className={`text-xs font-medium ${canManage ? "text-emerald-700" : "text-slate-500"}`}>
          {canManage ? "Can manage blocked URLs" : "No blocked URL access"}
        </span>
        <button
          className={`inline-flex h-8 items-center rounded-lg px-3 text-[11px] font-semibold disabled:opacity-60 ${
            canManage
              ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
          disabled={isPending}
          type="submit"
        >
          {isPending && <LoadingIcon className="mr-1 size-3.5" />}
          {isPending ? "Saving..." : canManage ? "Remove access" : "Assign access"}
        </button>
      </form>
      <ActionFeedback state={state} />
    </div>
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

function ActionFeedback({ state }: { state: PromptActionState }) {
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
