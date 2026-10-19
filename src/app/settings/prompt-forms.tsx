"use client";

import { useActionState } from "react";
import { Check, Shuffle, Trash2 } from "lucide-react";
import {
  assignPromptAction,
  saveGlobalPromptAction,
  unassignPromptAction,
  updatePromptModeAction,
  type PromptActionState,
} from "@/app/settings/actions";
import { saveManagerPromptAction } from "@/app/settings/actions";

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
          ChatGPT prompt mode
        </label>
        <select
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 sm:max-w-sm"
          defaultValue={mode}
          id="promptMode"
          name="promptMode"
        >
          <option value="global">Global default</option>
          <option value="private">Manager private prompts</option>
        </select>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          Super Admin assignments override either mode. In private mode,
          Managers can edit one prompt for both resumes and cover letters.
        </p>
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
  managerName,
  assignedPromptName,
  prompts,
}: {
  managerId: string;
  managerName: string;
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
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-slate-800">
            {managerName}
          </h3>
          <p className="mt-1 text-[10px] text-slate-500">
            {assignedPromptName
              ? `Assigned: ${assignedPromptName}`
              : "No assigned prompt"}
          </p>
        </div>
        {assignedPromptName && (
          <form action={unassignAction}>
            <input name="managerId" type="hidden" value={managerId} />
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
              disabled={unassignPending}
              type="submit"
            >
              <Trash2 className="size-3" />
              {unassignPending ? "Removing..." : "Unassign"}
            </button>
          </form>
        )}
      </div>
      <form action={assignAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input name="managerId" type="hidden" value={managerId} />
        <select
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          defaultValue=""
          name="promptChoice"
          required
        >
          <option disabled value="">
            Choose a prompt
          </option>
          <option value="random">Choose a random active ChatGPT prompt</option>
          {prompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name} · v{prompt.version}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={assignPending || prompts.length === 0}
          type="submit"
        >
          <Shuffle className="size-3.5" />
          {assignPending ? "Assigning..." : "Assign prompt"}
        </button>
      </form>
      <ActionFeedback state={assignState} />
      <ActionFeedback state={unassignState} />
    </article>
  );
}

export function ManagerPromptForm({
  promptTemplate,
  assignedPromptName,
}: {
  promptTemplate: string;
  assignedPromptName: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    saveManagerPromptAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {assignedPromptName && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          Super Admin has assigned “{assignedPromptName}”. It is currently used
          instead of your private prompt. Your changes here are saved and will
          be used if that assignment is removed.
        </p>
      )}
      <div>
        <label
          className="mb-2 block text-xs font-semibold text-slate-700"
          htmlFor="managerPromptTemplate"
        >
          Your ChatGPT prompt
        </label>
        <textarea
          className="min-h-80 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          defaultValue={promptTemplate}
          id="managerPromptTemplate"
          maxLength={50000}
          name="promptTemplate"
          required
          rows={14}
        />
        <p className="mt-2 text-[11px] text-slate-500">
          This single prompt is used for both resume and cover-letter
          generation. Gemini prompts are managed separately by Super Admin and
          are not shown here.
        </p>
      </div>
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        <Check className="size-3.5" />
        {isPending ? "Saving..." : "Save private prompt"}
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
