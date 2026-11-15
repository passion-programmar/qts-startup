"use client";

import { ListPlus, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useActionState, useState } from "react";
import { deleteJobAction, setJobGenerationQueueAction } from "@/app/jobs/actions";
import { initialRecordState } from "@/app/record-action-state";
import type { ApplyRun } from "@/server/apply/apply-values";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import type { SubmittedAnswer } from "@/app/components/submitted-answers";

// The edit window (with its calendar and Apply history) downloads the first time Edit is clicked,
// so the Jobs and Bids lists load without it.
const RecordEditDialog = dynamic(() => import("@/app/components/record-edit-dialog").then((module) => module.RecordEditDialog), {
  loading: () => (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55" role="status">
      <LoadingIcon className="size-6 text-white" />
    </div>
  ),
});


export type CandidateOption = { id: string; name: string };
export type GenerationPromptOption = { id: string; name: string };
type CommonRecord = { id: string; candidateId: string; title: string; company: string; location: string | null; url: string };
export type EditableJob = CommonRecord & { description: string | null; employmentType: string | null; workplaceType: string | null; salary: string | null; date: string; status: string; failureReason: string | null; generationStatus: string; generationError: string | null };
// What happened to a job so far, shown read-only in its edit window: Generation, Apply, and each
// Apply run's answers with their sources.
export type ApplyStatusLine = { text: string; tone: "info" | "warn" | "error"; detail: string | null };
export type JobTrack = {
  savedAt: string;
  jobReason: string | null;
  prompt: string | null;
  template: string | null;
  resumeLocalPath: string | null;
  googleDrivePath: string | null;
  generationBrowserName: string | null;
  applyStatus: ApplyStatusLine[];
  applyRuns: ApplyRun[];
};
export type EditableBid = CommonRecord & { workType: string | null; salary: string | null; resumeFolder: string; googleDrivePath: string | null; details?: BidDetails };
// The rest of a bid, shown read-only in its edit window: as it was when the bid was made.
export type BidDetails = {
  candidateName: string;
  category: string | null;
  sourceSiteUrl: string | null;
  appliedAt: string;
  createdAt: string;
  resumeSavedOn: string | null;
  promptName: string | null;
  templateName: string | null;
  answers: SubmittedAnswer[];
};

export function JobEditAction({ record, candidates, track }: { record: EditableJob; candidates: CandidateOption[]; track: JobTrack }) {
  return <RecordActions kind="job" record={record} candidates={candidates} showDelete={false} track={track} />;
}
export function JobDeleteAction({ record }: { record: EditableJob }) {
  return <RecordActions kind="job" record={record} candidates={[]} showEdit={false} />;
}
export function JobGenerationQueueAction({ record, prompts }: { record: EditableJob; prompts: GenerationPromptOption[] }) {
  return <GenerationQueueAction prompts={prompts} record={record} />;
}
export function BidActions({ record, candidates }: { record: EditableBid; candidates: CandidateOption[] }) {
  // Bids are permanent: they can be edited, never deleted.
  return <RecordActions kind="bid" record={record} candidates={candidates} showDelete={false} />;
}


function GenerationQueueAction({ record, prompts }: { record: EditableJob; prompts: GenerationPromptOption[] }) {
  const [state, action, pending] = useActionState(
    setJobGenerationQueueAction,
    initialRecordState,
  );
  const queued = record.generationStatus === "queued";
  const processing = record.generationStatus === "processing";
  const cancellable = queued || processing;
  if (record.generationStatus === "completed") {
    return <span className="text-xs text-slate-500">Complete</span>;
  }
  const intent = cancellable ? "cancel" : "queue";
  const accessibleLabel = cancellable
    ? processing ? "Cancel running Generation" : "Cancel queued Generation"
    : ["failed", "cancelled", "ready"].includes(record.generationStatus)
        ? "Retry Generation"
        : "Queue Generation";
  return (
    <form action={action}>
      <input name="id" type="hidden" value={record.id} />
      <input name="intent" type="hidden" value={intent} />
      {intent === "queue" && prompts.length > 0 && (
        <label className="sr-only" htmlFor={`generation-prompt-${record.id}`}>Generation prompt</label>
      )}
      {intent === "queue" && prompts.length > 0 && (
        <select
          className="mb-1 max-w-36 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-600"
          defaultValue=""
          disabled={pending}
          id={`generation-prompt-${record.id}`}
          name="generationPromptId"
          title="Choose a prompt for this generation, or use automatic rotation"
        >
          <option value="">Automatic rotation</option>
          {prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}
        </select>
      )}
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
            : ["failed", "cancelled", "ready"].includes(record.generationStatus)
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
  track,
}: (
  | { kind: "job"; record: EditableJob; candidates: CandidateOption[] }
  | { kind: "bid"; record: EditableBid; candidates: CandidateOption[] }
) & { showEdit?: boolean; showDelete?: boolean; track?: JobTrack }) {
  const [open, setOpen] = useState(false);
  // Only jobs can be deleted; a bid never shows the Delete button.
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteJobAction, initialRecordState);

  return (
    <div className="flex min-w-0 items-start gap-2">
      {showEdit && <button aria-label={`Edit ${record.title}`} className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onClick={() => setOpen(true)} title={`Edit ${record.title}`} type="button"><Pencil aria-hidden="true" className="size-4" /></button>}
      {showDelete && (
        <form action={deleteFormAction}>
          <input name="id" type="hidden" value={record.id} />
          <ConfirmButton
            ariaLabel={`Delete ${record.title}`}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            confirmLabel={`Delete ${kind}`}
            description={<>This will permanently delete “{record.title}”. This action cannot be undone.</>}
            disabled={deleting}
            title={`Delete this ${kind}?`}
          >
            {deleting ? <LoadingIcon className="size-4" /> : <Trash2 aria-hidden="true" className="size-4" />}
          </ConfirmButton>
          {deleteState.error && (
            <p className="mt-2 max-w-48 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700" role="alert">
              {deleteState.error}
            </p>
          )}
        </form>
      )}
      {open && (kind === "job"
        ? <RecordEditDialog candidates={candidates} kind="job" onClose={() => setOpen(false)} record={record} track={track} />
        : <RecordEditDialog candidates={candidates} kind="bid" onClose={() => setOpen(false)} record={record} />)}
    </div>
  );
}
