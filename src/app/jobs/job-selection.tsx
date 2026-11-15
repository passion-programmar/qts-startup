"use client";

// Ticking jobs on the Jobs page and deleting the ticked ones together. The selection covers only the
// jobs on the page in view: paging, searching, filtering or any change to the list clears it, so a
// job that is not on screen is never deleted by surprise.
import { Trash2, X } from "lucide-react";
import { createContext, useActionState, useCallback, useContext, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { deleteJobsAction } from "@/app/jobs/actions";
import { initialRecordState, type RecordActionState } from "@/app/record-action-state";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";

type Selection = {
  selected: ReadonlySet<string>;
  selectable: readonly string[];
  toggle: (id: string, range: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);
const nothing: ReadonlySet<string> = new Set();

function useSelection(): Selection {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("Job selection is used outside JobSelectionProvider.");
  return selection;
}

/** selectableIds: the page's jobs that may be deleted, in table order. */
export function JobSelectionProvider({ selectableIds, children }: { selectableIds: string[]; children: ReactNode }) {
  const pageKey = selectableIds.join(",");
  const [state, setState] = useState<{ pageKey: string; ids: ReadonlySet<string> }>({ pageKey, ids: nothing });
  // A different list (another page, a search, a deleted or finished job) starts with nothing ticked.
  const selected = state.pageKey === pageKey ? state.ids : nothing;
  const lastToggled = useRef<string | null>(null);

  const toggle = useCallback((id: string, range: boolean) => {
    // Read now: React may run the update below later, after lastToggled has moved on.
    const anchor = range ? lastToggled.current : null;
    setState((previous) => {
      const current = new Set(previous.pageKey === pageKey ? previous.ids : nothing);
      const on = !current.has(id);
      const from = anchor ? selectableIds.indexOf(anchor) : -1;
      const to = selectableIds.indexOf(id);
      // Shift+click ticks (or unticks) every job between the last one clicked and this one.
      const ids = from >= 0 && to >= 0 ? selectableIds.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
      for (const each of ids) {
        if (on) current.add(each);
        else current.delete(each);
      }
      return { pageKey, ids: current };
    });
    lastToggled.current = id;
  }, [pageKey, selectableIds]);

  const setAll = useCallback((on: boolean) => setState({ pageKey, ids: on ? new Set(selectableIds) : nothing }), [pageKey, selectableIds]);
  const clear = useCallback(() => setState({ pageKey, ids: nothing }), [pageKey]);
  const value = useMemo(() => ({ selected, selectable: selectableIds, toggle, setAll, clear }), [selected, selectableIds, toggle, setAll, clear]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

const boxClass = "size-4 cursor-pointer rounded border-line accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40";

/** The tick box in the table heading: ticks or clears every job on this page that can be deleted. */
export function SelectAllJobsCheckbox() {
  const { selected, selectable, setAll } = useSelection();
  const all = selectable.length > 0 && selected.size === selectable.length;
  const some = selected.size > 0 && !all;
  return (
    <input
      aria-label={all ? "Clear the selection" : "Select every job on this page"}
      checked={all}
      className={boxClass}
      disabled={selectable.length === 0}
      onChange={() => setAll(!all)}
      ref={(box) => { if (box) box.indeterminate = some; }}
      title={all ? "Clear the selection" : "Select every job on this page"}
      type="checkbox"
    />
  );
}

/** One row's tick box. A job that cannot be deleted right now shows a greyed box saying why. */
export function SelectJobCheckbox({ jobId, title, disabledReason }: { jobId: string; title: string; disabledReason?: string }) {
  const { selected, toggle } = useSelection();
  if (disabledReason) {
    return <input aria-label={`${title}: ${disabledReason}`} className={boxClass} disabled title={disabledReason} type="checkbox" />;
  }
  return (
    <input
      aria-label={`Select ${title}`}
      checked={selected.has(jobId)}
      className={boxClass}
      // onClick knows whether Shift was held; onChange is kept only so React treats the box as controlled.
      onChange={() => undefined}
      onClick={(event: MouseEvent<HTMLInputElement>) => toggle(jobId, event.shiftKey)}
      title="Select (Shift+click selects a range)"
      type="checkbox"
    />
  );
}

/**
 * In the table's toolbar: how many jobs are ticked, Clear, and Delete selected (after a confirm). After
 * a delete it shows what happened until it is dismissed or more jobs are ticked.
 */
export function SelectedJobsBar() {
  const { selected, clear } = useSelection();
  const [state, formAction, deleting] = useActionState(deleteJobsAction, initialRecordState);
  const [dismissed, setDismissed] = useState<RecordActionState | null>(null);
  const count = selected.size;
  const message = state !== dismissed ? state.error ?? state.success : null;
  const word = count === 1 ? "job" : "jobs";

  if (count === 0) {
    if (!message) return null;
    return (
      <p
        className={`flex max-w-md items-start gap-2 rounded-control px-3 py-1.5 text-xs ring-1 ring-inset ${state.error ? "bg-danger-soft text-danger-text ring-danger-ring" : "bg-success-soft text-success-text ring-success-ring"}`}
        role={state.error ? "alert" : "status"}
      >
        <span className="min-w-0 flex-1">{message}</span>
        <button aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-white/40" onClick={() => setDismissed(state)} type="button">
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-control bg-primary-soft px-2.5 py-1 ring-1 ring-inset ring-primary-ring">
      {[...selected].map((id) => <input key={id} name="ids" type="hidden" value={id} />)}
      <span className="text-xs font-semibold text-primary-text" role="status">{count} selected</span>
      <button className="rounded px-1.5 py-1 text-xs font-medium text-fg-muted hover:text-fg" disabled={deleting} onClick={clear} type="button">
        Clear
      </button>
      <ConfirmButton
        className="inline-flex h-8 items-center gap-1.5 rounded-control bg-danger px-3 text-xs font-semibold text-white shadow-sm hover:bg-danger-hover disabled:cursor-wait disabled:opacity-60"
        confirmLabel={`Delete ${count} ${word}`}
        description={<>This permanently deletes the {count} selected {word}, with their Apply history. Jobs still making a résumé or with a bid are kept. This cannot be undone.</>}
        disabled={deleting}
        title={`Delete ${count} selected ${word}?`}
      >
        {deleting ? <LoadingIcon className="size-3.5" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
        {deleting ? "Deleting…" : "Delete selected"}
      </ConfirmButton>
      {state.error && message ? <span className="w-full text-[11px] text-danger-text" role="alert">{state.error}</span> : null}
    </form>
  );
}
