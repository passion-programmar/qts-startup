"use client";

import { Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useActionState, useState } from "react";
import { saveCallerAction, setCallerRemovedAction } from "@/app/callers/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import { initialRecordState, type RecordActionState } from "@/app/record-action-state";

export type CallerRow = { id: string; name: string; label: string | null; removed: boolean };

const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100";

/** The Add caller form: name and an optional label. */
export function AddCallerForm() {
  const [formKey, setFormKey] = useState(0);
  const [state, action, saving] = useActionState(async (previous: RecordActionState, formData: FormData) => {
    const outcome = await saveCallerAction(previous, formData);
    if (outcome.success) setFormKey((key) => key + 1);
    return outcome;
  }, initialRecordState);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end" key={formKey}>
      <div className="min-w-0 flex-1">
        <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="caller-name">Name</label>
        <input className={inputClass} id="caller-name" maxLength={120} name="name" placeholder="e.g. Alex Popescu" required />
      </div>
      <div className="min-w-0 sm:w-56">
        <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor="caller-label">Label</label>
        <input className={inputClass} id="caller-label" maxLength={60} name="label" placeholder="e.g. Senior, Java, EU" />
      </div>
      <button className="inline-flex h-10 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-60" disabled={saving} type="submit">
        {saving ? <LoadingIcon className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}
        Add caller
      </button>
      <Message state={state} />
    </form>
  );
}

/** One caller in the list: Edit (name and label), Remove, or Restore when removed. */
export function CallerRowActions({ caller }: { caller: CallerRow }) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, saving] = useActionState(async (previous: RecordActionState, formData: FormData) => {
    const outcome = await saveCallerAction(previous, formData);
    if (outcome.success) setEditing(false);
    return outcome;
  }, initialRecordState);
  const [removeState, removeAction, removing] = useActionState(setCallerRemovedAction, initialRecordState);

  if (editing) {
    return (
      <form action={saveAction} className="flex flex-wrap items-center gap-2">
        <input name="id" type="hidden" value={caller.id} />
        <input aria-label="Name" autoFocus className={`${inputClass} h-9 w-44`} defaultValue={caller.name} maxLength={120} name="name" required />
        <input aria-label="Label" className={`${inputClass} h-9 w-36`} defaultValue={caller.label ?? ""} maxLength={60} name="label" placeholder="Label" />
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">
          {saving && <LoadingIcon className="size-3.5" />}Save
        </button>
        <button aria-label="Cancel" className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={() => setEditing(false)} type="button"><X className="size-4" /></button>
        <Message state={saveState} />
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!caller.removed && (
        <button aria-label={`Edit ${caller.name}`} className="inline-flex size-9 items-center justify-center rounded-control border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onClick={() => setEditing(true)} title="Edit" type="button">
          <Pencil aria-hidden="true" className="size-4" />
        </button>
      )}
      <form action={removeAction}>
        <input name="id" type="hidden" value={caller.id} />
        <input name="intent" type="hidden" value={caller.removed ? "restore" : "remove"} />
        {caller.removed ? (
          <button className="inline-flex h-9 items-center gap-1.5 rounded-control border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60" disabled={removing} type="submit">
            {removing ? <LoadingIcon className="size-3.5" /> : <RotateCcw aria-hidden="true" className="size-3.5" />} Restore
          </button>
        ) : (
          <ConfirmButton
            ariaLabel={`Remove ${caller.name}`}
            className="inline-flex size-9 items-center justify-center rounded-control border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            confirmLabel="Remove caller"
            description={<>“{caller.name}” will no longer be offered on new interviews. Interviews they already took keep their name. You can restore them later.</>}
            disabled={removing}
            title="Remove this caller?"
          >
            {removing ? <LoadingIcon className="size-4" /> : <Trash2 aria-hidden="true" className="size-4" />}
          </ConfirmButton>
        )}
      </form>
      <Message state={removeState} />
    </div>
  );
}

function Message({ state }: { state: RecordActionState }) {
  if (!state.error && !state.success) return null;
  return (
    <p className={`w-full text-xs ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
      {state.error || state.success}
    </p>
  );
}
