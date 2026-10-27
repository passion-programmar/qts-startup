"use client";

import { useActionState, useState } from "react";
import { Activity, Check, Eraser, Gauge, Search, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import { ActionFeedback } from "@/app/settings/prompt-forms";
import type { PlanLimits } from "@/server/database/database-usage-values";
import {
  checkQuotaAction,
  cleanUpNowAction,
  type DatabaseActionState,
  deleteRowsAction,
  previewDeleteAction,
  runDiagnosticsAction,
  saveKeepDaysAction,
  savePlanLimitsAction,
} from "./actions";

const initialState: DatabaseActionState = { error: null, success: null };

const inputClass =
  "h-8 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
const buttonClass =
  "inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60";

type Rule = { kind: "age"; minDays: number; allowAll: boolean } | { kind: "expired" } | { kind: "none" };

// Measuring runs only on these clicks; the page shows the saved numbers until the next one.
// Check quota asks Neon's API (it never wakes the database); Run diagnostics reads PostgreSQL.
export function MonitorButton({ kind }: { kind: "quota" | "diagnostics" }) {
  const [state, formAction, isPending] = useActionState(kind === "quota" ? checkQuotaAction : runDiagnosticsAction, initialState);
  const Icon = kind === "quota" ? Gauge : Activity;
  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <button
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-70"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-4" /> : <Icon className="size-4" />}
        {isPending ? "Checking..." : kind === "quota" ? "Check quota" : "Run diagnostics"}
      </button>
      {(state.error || state.success) && <div className="max-w-xs"><ActionFeedback state={state} /></div>}
    </form>
  );
}

export function PlanLimitsForm({ limits }: { limits: PlanLimits }) {
  const [state, formAction, isPending] = useActionState(savePlanLimitsAction, initialState);
  const field = (name: string, label: string, value: number, step = "any") => (
    <label className="block text-[11px] font-semibold text-slate-600">
      {label}
      <input className={`${inputClass} mt-1 w-full font-normal`} defaultValue={value} inputMode="decimal" name={name} required step={step} type="number" />
    </label>
  );
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {field("storageMb", "Storage per project (MB)", limits.storageMb)}
        {field("computeHours", "Compute per project (CU-hours a month)", limits.computeHours)}
        {field("transferGb", "Transfer per project (GB a month)", limits.transferGb)}
        {field("accountStorageGb", "Storage, all projects (GB)", limits.accountStorageGb)}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {field("warning", "Warning at (%)", limits.thresholds.warning, "1")}
        {field("high", "High at (%)", limits.thresholds.high, "1")}
        {field("critical", "Critical at (%)", limits.thresholds.critical, "1")}
        <p className="self-end pb-1 text-[11px] text-slate-500">“Limit reached” is always 100%.</p>
      </div>
      <ActionFeedback state={state} />
      <button className={buttonClass} disabled={isPending} type="submit">
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save limits"}
      </button>
    </form>
  );
}

// Deleting from one table by hand: Check first says how many rows and about how much space, then
// Delete asks once more, naming what is lost. Delete stays off until Check ran for these inputs.
export function TableDeleteForm({
  tableKey,
  label,
  rule,
  warning,
}: {
  tableKey: string;
  label: string;
  rule: Rule;
  warning?: string;
}) {
  const [checkState, checkAction, isChecking] = useActionState(previewDeleteAction, initialState);
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteRowsAction, initialState);
  const ageRule = rule.kind === "age" ? rule : null;
  const [mode, setMode] = useState(rule.kind === "expired" ? "expired" : "older");
  const [days, setDays] = useState(String(Math.max(30, ageRule?.minDays ?? 0)));
  const preview = checkState.preview;
  const checked = Boolean(preview && preview.tableKey === tableKey && preview.mode === mode && (mode !== "older" || preview.days === days));
  const what = mode === "all" ? "every row" : mode === "expired" ? "the expired rows" : `rows older than ${days} days`;

  return (
    <div className="space-y-2">
      <form action={checkAction} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <input name="table" type="hidden" value={tableKey} />
        <input name="mode" type="hidden" value={mode} />
        {mode === "expired" ? (
          <span>Delete the expired rows only (rows still in use stay).</span>
        ) : (
          <>
            <label className="inline-flex items-center gap-1.5">
              <input checked={mode === "older"} name="choice" onChange={() => setMode("older")} type="radio" />
              Older than
            </label>
            <input
              aria-label="Days"
              className={`${inputClass} w-20`}
              disabled={mode !== "older"}
              inputMode="numeric"
              max={3650}
              min={ageRule?.minDays ?? 0}
              name="days"
              onChange={(event) => setDays(event.target.value)}
              type="number"
              value={days}
            />
            <span>days</span>
            {ageRule?.allowAll && (
              <label className="ml-2 inline-flex items-center gap-1.5">
                <input checked={mode === "all"} name="choice" onChange={() => setMode("all")} type="radio" />
                All
              </label>
            )}
          </>
        )}
        <button className={buttonClass} disabled={isChecking} type="submit">
          {isChecking ? <LoadingIcon className="size-3.5" /> : <Search className="size-3.5" />}
          {isChecking ? "Checking..." : "Check"}
        </button>
      </form>
      {checked && <ActionFeedback state={checkState} />}
      {!checked && checkState.error && <ActionFeedback state={{ error: checkState.error, success: null }} />}
      <form action={deleteAction}>
        <input name="table" type="hidden" value={tableKey} />
        <input name="mode" type="hidden" value={mode} />
        <input name="days" type="hidden" value={days} />
        <ActionFeedback state={deleteState} />
        <ConfirmButton
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
          confirmLabel="Delete rows"
          description={
            <>
              Delete {preview?.rows.toLocaleString() ?? 0} rows ({what}) from {label}? {warning ?? ""} This cannot be undone.
            </>
          }
          disabled={!checked || !preview?.rows || isDeleting}
          title={`Delete from ${label}?`}
        >
          {isDeleting ? <LoadingIcon className="size-3.5" /> : <Trash2 className="size-3.5" />}
          {isDeleting ? "Deleting..." : "Delete…"}
        </ConfirmButton>
      </form>
    </div>
  );
}

export function KeepDaysForm({ generationRuns }: { generationRuns: number }) {
  const [state, formAction, isPending] = useActionState(saveKeepDaysAction, initialState);
  return (
    <form action={formAction} className="space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        Keep Generation runs
        <input className={`${inputClass} w-20`} defaultValue={generationRuns} inputMode="numeric" max={365} min={1} name="generationRuns" required type="number" />
        days
        <button className={buttonClass} disabled={isPending} type="submit">
          {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
          {isPending ? "Saving..." : "Save"}
        </button>
      </label>
      <ActionFeedback state={state} />
    </form>
  );
}

export function CleanUpNowButton() {
  const [state, formAction, isPending] = useActionState(cleanUpNowAction, initialState);
  return (
    <form action={formAction} className="space-y-2">
      <ActionFeedback state={state} />
      <ConfirmButton
        className={buttonClass}
        confirmLabel="Clean up now"
        description="Run the daily clean-up now: old Generation runs (each job keeps its newest delivered run), expired Get JD checks, Gemini logs older than 3 days, and questions unseen for 90 days are deleted. Bids are never touched."
        disabled={isPending}
        title="Run the clean-up now?"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Eraser className="size-3.5" />}
        {isPending ? "Cleaning..." : "Clean up now"}
      </ConfirmButton>
    </form>
  );
}
