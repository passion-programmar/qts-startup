"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useActionState, useState } from "react";
import { deleteBidAction, updateBidAction } from "@/app/bids/actions";
import {
  deleteJobAction,
  initialRecordState,
  setJobGenerationQueueAction,
  updateJobAction,
} from "@/app/jobs/actions";

export type CandidateOption = { id: string; name: string };
type CommonRecord = { id: string; candidateId: string; title: string; company: string; location: string | null; url: string };
export type EditableJob = CommonRecord & { description: string | null; employmentType: string | null; workplaceType: string | null; salary: string | null; date: string; status: string; failureReason: string | null; generationStatus: string; generationError: string | null };
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

function GenerationQueueAction({ record }: { record: EditableJob }) {
  const [state, action, pending] = useActionState(
    setJobGenerationQueueAction,
    initialRecordState,
  );
  const queued = record.generationStatus === "queued";
  const processing = record.generationStatus === "processing";
  const cancellable = queued || processing;
  const label = cancellable
    ? processing ? "Cancel Generation" : "Cancel queue"
    : record.generationStatus === "failed"
        ? "Retry Generation"
        : record.generationStatus === "completed"
          ? "Queue again"
          : "Queue Generation";
  return (
    <form action={action}>
      <input name="id" type="hidden" value={record.id} />
      <input name="intent" type="hidden" value={cancellable ? "cancel" : "queue"} />
      <button
        className="inline-flex h-auto min-h-8 max-w-full items-center whitespace-normal rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-left text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60 sm:px-3"
        disabled={pending}
        type="submit"
      >
        {pending ? "Updating…" : label}
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
  const updateAction = kind === "job" ? updateJobAction : updateBidAction;
  const deleteAction = kind === "job" ? deleteJobAction : deleteBidAction;
  const [updateState, updateFormAction, updating] = useActionState(updateAction, initialRecordState);
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteAction, initialRecordState);

  return (
    <div className="flex flex-wrap items-start gap-2">
      {showEdit && <button aria-label={`Edit ${record.title}`} className="inline-flex h-8 max-w-full items-center gap-1.5 whitespace-normal rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 sm:px-3" onClick={() => setOpen(true)} type="button"><Pencil className="size-3.5 shrink-0" />Edit</button>}
      {showDelete && <form action={deleteFormAction} onSubmit={(event) => { if (!window.confirm(`Permanently delete this ${kind}?`)) event.preventDefault(); }}>
        <input name="id" type="hidden" value={record.id} />
        <button className="inline-flex h-8 max-w-full items-center gap-1.5 whitespace-normal rounded-md border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60 sm:px-3" disabled={deleting} type="submit"><Trash2 className="size-3.5 shrink-0" />{deleting ? "Deleting..." : "Delete"}</button>
        {deleteState.error && <p className="mt-1 max-w-40 text-[10px] text-rose-700" role="alert">{deleteState.error}</p>}
      </form>}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div><h2 className="font-semibold text-slate-900">Edit {kind}</h2><p className="text-xs text-slate-500">Update the complete stored record.</p></div>
              <button aria-label="Close edit form" className="flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={() => setOpen(false)} type="button"><X className="size-4" /></button>
            </header>
            <form action={updateFormAction} className="grid gap-4 p-5 sm:grid-cols-2">
              <input name="id" type="hidden" value={record.id} />
              <Field label="Candidate"><select className={inputClass} defaultValue={record.candidateId} name="candidateId" required>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Field>
              <Field label="Job URL"><input className={inputClass} defaultValue={record.url} maxLength={2048} name="jobUrl" required type="url" /></Field>
              <Field label="Job title"><input className={inputClass} defaultValue={record.title} maxLength={500} name="jobTitle" required /></Field>
              <Field label="Company"><input className={inputClass} defaultValue={record.company} maxLength={500} name="company" required /></Field>
              <Field label="Location"><input className={inputClass} defaultValue={record.location ?? ""} maxLength={500} name="location" /></Field>
              {kind === "job" ? <JobFields record={record} /> : <BidFields record={record} />}
              {updateState.error && <p className="text-sm text-rose-700 sm:col-span-2" role="alert">{updateState.error}</p>}
              {updateState.success && <p className="text-sm text-emerald-700 sm:col-span-2" role="status">{updateState.success}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 sm:col-span-2">
                <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={() => setOpen(false)} type="button">Cancel</button>
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={updating} type="submit">{updating ? "Saving..." : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function JobFields({ record }: { record: EditableJob }) {
  return <><Field className="sm:col-span-2" label="Job description"><textarea className={`${inputClass} min-h-40`} defaultValue={record.description ?? ""} maxLength={100000} name="description" /></Field><Field label="Employment type"><input className={inputClass} defaultValue={record.employmentType ?? ""} maxLength={200} name="employmentType" /></Field><Field label="Work arrangement"><input className={inputClass} defaultValue={record.workplaceType ?? ""} maxLength={200} name="workplaceType" /></Field><Field label="Salary"><input className={inputClass} defaultValue={record.salary ?? ""} maxLength={500} name="salary" /></Field><Field label="Date"><input className={inputClass} defaultValue={record.date} name="date" required type="date" /></Field><Field label="Status"><select className={inputClass} defaultValue={record.status} name="status">{["todo", "pending", "applied", "failed"].map((status) => <option key={status} value={status}>{status}</option>)}</select></Field><Field className="sm:col-span-2" label="Failure reason"><textarea className={`${inputClass} min-h-24`} defaultValue={record.failureReason ?? ""} maxLength={5000} name="failureReason" /></Field></>;
}
function BidFields({ record }: { record: EditableBid }) {
  return <><Field label="Employment type"><input className={inputClass} defaultValue={record.employmentType ?? ""} maxLength={200} name="employmentType" /></Field><Field label="Work arrangement"><input className={inputClass} defaultValue={record.workplaceType ?? ""} maxLength={200} name="workplaceType" /></Field><Field label="Salary"><input className={inputClass} defaultValue={record.salary ?? ""} maxLength={500} name="salary" /></Field><Field label="Applied at"><input className={inputClass} defaultValue={record.appliedAt} name="appliedAt" required type="datetime-local" /></Field><Field className="sm:col-span-2" label="Resume local path"><input className={inputClass} defaultValue={record.resumeLocalPath} maxLength={2048} name="resumeLocalPath" required /></Field><Field className="sm:col-span-2" label="Google Drive path"><input className={inputClass} defaultValue={record.googleDrivePath ?? ""} maxLength={2048} name="googleDrivePath" /></Field></>;
}
const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) { return <label className={`text-xs font-semibold text-slate-700 ${className}`}>{label}{children}</label>; }
