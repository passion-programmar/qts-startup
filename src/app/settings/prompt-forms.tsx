"use client";

import { useActionState } from "react";
import { Check, Trash2 } from "lucide-react";
import {
  assignPromptAction,
  saveGlobalPromptAction,
  updateManagerTextHighlightAccessAction,
  updateManagerPageExclusionAccessAction,
  unassignPromptAction,
  updatePromptModeAction,
  type PromptActionState,
} from "@/app/settings/actions";

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
          Manager prompt visibility
        </label>
        <select
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 sm:max-w-sm"
          defaultValue={mode}
          id="promptMode"
          name="promptMode"
        >
          <option value="global">Hide manager prompt tab</option>
          <option value="private">Show assigned prompt to Managers</option>
        </select>
      </div>
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        <Check className="size-3.5" />
        {isPending ? "Saving..." : "Save prompt mode"}
      </button>
    </form>
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
  const title = purposeLabel(purpose);

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
            {isDefault ? " · Global default" : ""}
          </p>
        </div>
      </div>
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
        <Check className="size-3.5" />
        {isPending ? "Saving..." : promptGroupId ? "Save new version" : "Create prompt"}
      </button>
    </form>
  );
}

export function PromptAssignmentForm({
  managerId,
  assignedPromptId,
  assignedPromptName,
  prompts,
}: {
  managerId: string;
  assignedPromptId: string | null;
  assignedPromptName: string | null;
  prompts: { id: string; name: string; version: number }[];
}) {
  const [assignState, assignAction, assignPending] = useActionState(
    assignPromptAction,
    initialState,
  );
  const [unassignState, unassignAction, unassignPending] = useActionState(
    unassignPromptAction,
    initialState,
  );

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-600">
          {assignedPromptName ?? "No prompt assigned"}
        </span>
        {assignedPromptName && (
          <form action={unassignAction}>
            <input name="managerId" type="hidden" value={managerId} />
            <button
              className="inline-flex h-7 items-center gap-1 rounded border border-rose-200 px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              disabled={unassignPending}
              type="submit"
            >
              <Trash2 className="size-3" />
              {unassignPending ? "Removing..." : "Unassign"}
            </button>
          </form>
        )}
      </div>
      <form action={assignAction} className="flex flex-col gap-2 sm:flex-row">
        <input name="managerId" type="hidden" value={managerId} />
        <select
          className="h-9 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          defaultValue={assignedPromptId ?? ""}
          name="promptChoice"
          required
        >
          <option disabled value="">
            Choose a prompt
          </option>
          {prompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name} · v{prompt.version}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={assignPending || prompts.length === 0}
          type="submit"
        >
          <Check className="size-3.5" />
          {assignPending ? "Saving..." : assignedPromptId ? "Update assignment" : "Assign"}
        </button>
      </form>
      <ActionFeedback state={assignState} />
      <ActionFeedback state={unassignState} />
    </div>
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
          {canManage ? "Can manage excluded URLs" : "No URL exclusions"}
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
