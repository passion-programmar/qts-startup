"use client";

import { ListPlus, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useActionState, useId, useRef, useState } from "react";
import { deleteBidAction, updateBidAction } from "@/app/bids/actions";
import {
  deleteJobAction,
  setJobGenerationQueueAction,
  updateJobAction,
} from "@/app/jobs/actions";
import { initialRecordState, type RecordActionState } from "@/app/record-action-state";
import { DatePicker } from "@/app/components/date-picker";
import { LoadingIcon } from "@/app/components/loading-icon";

export type CandidateOption = { id: string; name: string };
type CommonRecord = { id: string; candidateId: string; title: string; company: string; location: string | null; url: string };
export type EditableJob = CommonRecord & { description: string | null; employmentType: string | null; workplaceType: string | null; salary: string | null; date: string; status: string; failureReason: string | null; generationStatus: string; generationAttemptCount: number; generationError: string | null };
export type EditableBid = CommonRecord & { employmentType: string | null; workplaceType: string | null; salary: string | null; resumeLocalPath: string; googleDrivePath: string | null; appliedAt: string };

export function JobEditAction({ record, candidates }: { record: EditableJob; candidates: CandidateOption[] }) {
  return <RecordActions kind="job" record={record} candidates={candidates} showDelete={false} />;
}
export function JobDeleteAction({ record }: { record: EditableJob }) {
  return <RecordActions kind="job" record={record} candidates={[]} showEdit={false} />;
}
export function JobGenerationQueueAction({ record }: { record: EditableJob }) {
  return <GenerationQueueAction record={record} />;
}
export function BidActions({ record, candidates }: { record: EditableBid; candidates: CandidateOption[] }) {
  return <RecordActions kind="bid" record={record} candidates={candidates} />;
}

const jobStatusOptions = [["todo", "To do"], ["pending", "Pending"], ["applied", "Applied"], ["failed", "Failed"]] as const;

function GenerationQueueAction({ record }: { record: EditableJob }) {
  const [state, action, pending] = useActionState(
    setJobGenerationQueueAction,
    initialRecordState,
  );
  const queued = record.generationStatus === "queued";
  const processing = record.generationStatus === "processing";
  const cancellable = queued || processing;
  const resetRequired = record.generationStatus === "failed" && record.generationAttemptCount >= 2;
  if (record.generationStatus === "completed") {
    return <span className="text-xs text-slate-500">Complete</span>;
  }
  const intent = resetRequired ? "reset" : cancellable ? "cancel" : "queue";
  const accessibleLabel = cancellable
    ? processing ? "Cancel running Generation" : "Cancel queued Generation"
    : resetRequired
        ? "Reset Generation"
        : record.generationStatus === "failed"
        ? "Retry Generation"
        : "Queue Generation";
  return (
    <form action={action}>
      <input name="id" type="hidden" value={record.id} />
      <input name="intent" type="hidden" value={intent} />
      <button
        aria-label={accessibleLabel}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60"
        title={accessibleLabel}
        disabled={pending}
        type="submit"
      >
        {pending
          ? <LoadingIcon className="size-3.5" />
          : cancellable
            ? <X aria-hidden="true" className="size-3.5" />
            : resetRequired
              ? <RotateCcw aria-hidden="true" className="size-3.5" />
            : record.generationStatus === "failed"
              ? <RotateCcw aria-hidden="true" className="size-3.5" />
              : <ListPlus aria-hidden="true" className="size-3.5" />}
      </button>
      {(state.error || state.success) && (
        <p className={`mt-1 max-w-40 text-[10px] ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
          {state.error || state.success}
        </p>
      )}
    </form>
  );
}

function RecordActions({
  kind,
  record,
  candidates,
  showEdit = true,
  showDelete = true,
}: (
  | { kind: "job"; record: EditableJob; candidates: CandidateOption[] }
  | { kind: "bid"; record: EditableBid; candidates: CandidateOption[] }
) & { showEdit?: boolean; showDelete?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteDialogId = useId();
  const updateAction = kind === "job" ? updateJobAction : updateBidAction;
  const deleteAction = kind === "job" ? deleteJobAction : deleteBidAction;
  const [updateState, updateFormAction, updating] = useActionState(
    async (previous: RecordActionState, formData: FormData) => {
      const result = await updateAction(previous, formData);
      // A saved record closes the window; the list shows the change.
      if (result.success) setOpen(false);
      return result;
    },
    initialRecordState,
  );
  // Closing asks only when something was changed since the window opened; messages belong to this opening.
  const changedRef = useRef(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [openedWith, setOpenedWith] = useState(updateState);
  const updateMessage = updateState === openedWith ? initialRecordState : updateState;
  const openEditor = () => {
    changedRef.current = false;
    setOpenedWith(updateState);
    setOpen(true);
  };
  const requestClose = () => {
    if (changedRef.current) setConfirmingClose(true);
    else setOpen(false);
  };
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteAction, initialRecordState);

  return (
    <div className="flex min-w-0 items-start gap-2">
      {showEdit && <button aria-label={`Edit ${record.title}`} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onClick={openEditor} title={`Edit ${record.title}`} type="button"><Pencil aria-hidden="true" className="size-4" /></button>}
      {showDelete && (
        <form action={deleteFormAction}>
          <input name="id" type="hidden" value={record.id} />
          <button
            aria-label={`Delete ${record.title}`}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            disabled={deleting}
            onClick={() => setConfirmingDelete(true)}
            title={`Delete ${record.title}`}
            type="button"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
          {!confirmingDelete && (deleteState.error || deleteState.success) && (
            <p
              className={`mt-2 max-w-48 rounded-md border px-2 py-1 text-[11px] ${deleteState.error ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
              role={deleteState.error ? "alert" : "status"}
            >
              {deleteState.error ?? deleteState.success}
            </p>
          )}
          {confirmingDelete && (
            <div
              aria-describedby={`${deleteDialogId}-description`}
              aria-labelledby={`${deleteDialogId}-title`}
              aria-modal="true"
              className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4"
              onKeyDown={(event) => {
                if (event.key === "Escape" && !deleting) setConfirmingDelete(false);
              }}
              role="alertdialog"
            >
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
                <h2 className="text-lg font-semibold text-slate-900" id={`${deleteDialogId}-title`}>
                  Delete this {kind}?
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600" id={`${deleteDialogId}-description`}>
                  This will permanently delete “{record.title}”. This action cannot be undone.
                </p>
                {deleteState.success ? (
                  <>
                    <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
                      {deleteState.success}
                    </p>
                    <div className="mt-6 flex justify-end">
                      <button
                        autoFocus
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => setConfirmingDelete(false)}
                        type="button"
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {deleteState.error && (
                  <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                    {deleteState.error}
                  </p>
                    )}
                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        autoFocus
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        disabled={deleting}
                        onClick={() => setConfirmingDelete(false)}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60"
                        disabled={deleting}
                        type="submit"
                      >
                        {deleting && <LoadingIcon className="size-4" />}
                        {deleting ? "Deleting…" : `Delete ${kind}`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </form>
      )}
      {open && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !confirmingClose) requestClose();
          }}
          role="dialog"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div><h2 className="font-semibold text-slate-900">Edit {kind}</h2><p className="text-xs text-slate-500">Update the complete stored record.</p></div>
              <button aria-label="Close edit form" className="flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={requestClose} type="button"><X className="size-4" /></button>
            </header>
            <form
              action={updateFormAction}
              className="grid gap-4 p-5 sm:grid-cols-2"
              onChangeCapture={() => { changedRef.current = true; }}
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest("[data-changes-form]")) changedRef.current = true;
              }}
              onInputCapture={() => { changedRef.current = true; }}
            >
              <input name="id" type="hidden" value={record.id} />
              <Field label="Candidate"><select className={inputClass} defaultValue={record.candidateId} name="candidateId" required>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Field>
              <Field label="Job URL"><input className={inputClass} defaultValue={record.url} maxLength={2048} name="jobUrl" required type="url" /></Field>
              <Field label="Job title"><input className={inputClass} defaultValue={record.title} maxLength={500} name="jobTitle" required /></Field>
              <Field label="Company"><input className={inputClass} defaultValue={record.company} maxLength={500} name="company" required /></Field>
              <Field label="Location"><input className={inputClass} defaultValue={record.location ?? ""} maxLength={500} name="location" /></Field>
              {kind === "job" ? <JobFields record={record} /> : <BidFields record={record} />}
              {updateMessage.error && <p className="text-sm text-rose-700 sm:col-span-2" role="alert">{updateMessage.error}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 sm:col-span-2">
                <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={requestClose} type="button">Cancel</button>
                <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={updating} type="submit">{updating && <LoadingIcon className="size-4" />}{updating ? "Saving..." : "Save changes"}</button>
              </div>
            </form>
          </div>
          {confirmingClose && (
            <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/35 p-4">
              <div aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl" role="alertdialog">
                <h2 className="text-lg font-semibold text-slate-900">Discard unsaved changes?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">You changed this {kind} but have not saved it. Discarding closes the window and loses those changes.</p>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    className="min-h-10 rounded-lg border border-rose-200 px-4 text-sm font-medium text-rose-700 hover:bg-rose-50"
                    onClick={() => {
                      setConfirmingClose(false);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    Discard changes
                  </button>
                  <button
                    autoFocus
                    className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                    onClick={() => setConfirmingClose(false)}
                    type="button"
                  >
                    Keep editing
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JobFields({ record }: { record: EditableJob }) {
  return <><Field className="sm:col-span-2" label="Job description"><textarea className={`${inputClass} min-h-40`} defaultValue={record.description ?? ""} maxLength={100000} name="description" /></Field><Field label="Employment type"><input className={inputClass} defaultValue={record.employmentType ?? ""} maxLength={200} name="employmentType" /></Field><Field label="Work arrangement"><input className={inputClass} defaultValue={record.workplaceType ?? ""} maxLength={200} name="workplaceType" /></Field><Field label="Salary"><input className={inputClass} defaultValue={record.salary ?? ""} maxLength={500} name="salary" /></Field><DatePicker defaultValue={record.date} id={`jobDate-${record.id}`} label="Date" name="date" required /><Field label="Status"><select className={inputClass} defaultValue={record.status} name="status">{jobStatusOptions.map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></Field><Field className="sm:col-span-2" label="Failure reason"><textarea className={`${inputClass} min-h-24`} defaultValue={record.failureReason ?? ""} maxLength={5000} name="failureReason" /></Field></>;
}
function BidFields({ record }: { record: EditableBid }) {
  return <><Field label="Employment type"><input className={inputClass} defaultValue={record.employmentType ?? ""} maxLength={200} name="employmentType" /></Field><Field label="Work arrangement"><input className={inputClass} defaultValue={record.workplaceType ?? ""} maxLength={200} name="workplaceType" /></Field><Field label="Salary"><input className={inputClass} defaultValue={record.salary ?? ""} maxLength={500} name="salary" /></Field><Field label="Applied at"><input className={inputClass} defaultValue={record.appliedAt} name="appliedAt" required type="datetime-local" /></Field><Field className="sm:col-span-2" label="Resume local path"><input className={inputClass} defaultValue={record.resumeLocalPath} maxLength={2048} name="resumeLocalPath" required /></Field><Field className="sm:col-span-2" label="Google Drive path"><input className={inputClass} defaultValue={record.googleDrivePath ?? ""} maxLength={2048} name="googleDrivePath" /></Field></>;
}
const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) { return <label className={`text-xs font-semibold text-slate-700 ${className}`}>{label}{children}</label>; }
