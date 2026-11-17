"use client";

// The Edit window for a job or a bid. It is loaded only when Edit is clicked (see record-forms).
import { Activity, AlertTriangle, Briefcase, FileText, ListChecks, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { loadBidAnswersAction, updateBidAction } from "@/app/bids/actions";
import type { SubmittedAnswer } from "@/app/components/submitted-answers";
import { updateJobAction } from "@/app/jobs/actions";
import { initialRecordState, type RecordActionState } from "@/app/record-action-state";
import { resumeFolderOf, type ApplyRun } from "@/server/apply/apply-values";
import { DatePicker } from "@/app/components/date-picker";
import { FormCard, openCardOfInvalidField } from "@/app/components/form-card";
import { LoadingIcon } from "@/app/components/loading-icon";
import { OpenFolderButton } from "@/app/components/open-folder";
import type { BidDetails, CandidateOption, EditableBid, EditableJob, JobTrack } from "@/app/components/record-forms";

const jobStatusOptions = [["todo", "To do"], ["pending", "Pending"], ["applied", "Applied"], ["failed", "Failed"]] as const;

export function RecordEditDialog({
  kind,
  record,
  candidates,
  track,
  onClose,
}: (
  | { kind: "job"; record: EditableJob; candidates: CandidateOption[]; track?: JobTrack }
  | { kind: "bid"; record: EditableBid; candidates: CandidateOption[]; track?: undefined }
) & { onClose: () => void }) {
  const updateAction = kind === "job" ? updateJobAction : updateBidAction;
  const [updateMessage, updateFormAction, updating] = useActionState(
    async (previous: RecordActionState, formData: FormData) => {
      const result = await updateAction(previous, formData);
      // A saved record closes the window; the list shows the change.
      if (result.success) onClose();
      return result;
    },
    initialRecordState,
  );
  // Closing asks only when something was changed since the window opened.
  const changedRef = useRef(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const requestClose = () => {
    if (changedRef.current) setConfirmingClose(true);
    else onClose();
  };
  // The page behind does not scroll while the window is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !confirmingClose) requestClose();
      }}
      role="dialog"
    >
            <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-card border border-line bg-card shadow-2xl">
              <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                <div className="min-w-0"><h2 className="font-semibold text-slate-900">Edit {kind}</h2><p className="truncate text-xs text-slate-500">{record.title} · {record.company}</p></div>
                <button aria-label="Close edit form" className="flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={requestClose} type="button"><X className="size-4" /></button>
              </header>
              <form
                action={updateFormAction}
                className="space-y-3 p-5"
                onInvalidCapture={openCardOfInvalidField}
                onChangeCapture={() => { changedRef.current = true; }}
                onClickCapture={(event) => {
                  if ((event.target as HTMLElement).closest("[data-changes-form]")) changedRef.current = true;
                }}
                onInputCapture={() => { changedRef.current = true; }}
              >
                <input name="id" type="hidden" value={record.id} />
                <FormCard
                  defaultOpen
                  icon={<Briefcase />}
                  summary={[record.company, record.location].filter(Boolean).join(" · ")}
                  title={kind === "job" ? "Job details" : "Bid details"}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Candidate"><select className={inputClass} defaultValue={record.candidateId} name="candidateId" required>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Field>
                    <Field label="Job URL"><input className={inputClass} defaultValue={record.url} maxLength={2048} name="jobUrl" placeholder={kind === "bid" ? "None (Resume page download)" : undefined} required={kind === "job"} type="url" /></Field>
                    <Field label="Job title"><input className={inputClass} defaultValue={record.title} maxLength={500} name="jobTitle" required /></Field>
                    <Field label="Company"><input className={inputClass} defaultValue={record.company} maxLength={500} name="company" required /></Field>
                    <Field label="Location"><input className={inputClass} defaultValue={record.location ?? ""} maxLength={500} name="location" /></Field>
                    {kind === "job" ? <JobDetailFields record={record} /> : <BidFields record={record} />}
                  </div>
                </FormCard>
                {kind === "job" && <JobCards record={record} track={track} />}
                {kind === "bid" && record.details && <BidCards record={record} details={record.details} />}
                {updateMessage.error && <p className="text-sm text-rose-700" role="alert">{updateMessage.error}</p>}
                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={requestClose} type="button">Cancel</button>
                  <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={updating} type="submit">{updating && <LoadingIcon className="size-4" />}{updating ? "Saving..." : "Save changes"}</button>
                </div>
              </form>
      </div>
      {confirmingClose && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/35 p-4">
          <div aria-modal="true" className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-2xl" role="alertdialog">
            <h2 className="text-lg font-semibold text-fg">Discard unsaved changes?</h2>
            <p className="mt-2 text-sm leading-6 text-fg-muted">You changed this {kind} but have not saved it. Discarding closes the window and loses those changes.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="min-h-10 rounded-control border border-rose-200 px-4 text-sm font-medium text-rose-700 hover:bg-rose-50" onClick={onClose} type="button">
                Discard changes
              </button>
              <button autoFocus className="min-h-10 rounded-control bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700" onClick={() => setConfirmingClose(false)} type="button">
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JobDetailFields({ record }: { record: EditableJob }) {
  return (
    <>
      <Field label="Employment type"><input className={inputClass} defaultValue={record.employmentType ?? ""} maxLength={200} name="employmentType" /></Field>
      <Field label="Work arrangement"><input className={inputClass} defaultValue={record.workplaceType ?? ""} maxLength={200} name="workplaceType" /></Field>
      <Field label="Salary"><input className={inputClass} defaultValue={record.salary ?? ""} maxLength={500} name="salary" /></Field>
      <DatePicker defaultValue={record.date} id={`jobDate-${record.id}`} label="Date" name="date" required />
      {/* Applied comes only from Apply (the Manager's Yes after Submit), so it is offered only to keep it. */}
      <Field label="Status"><select className={inputClass} defaultValue={record.status} name="status">{jobStatusOptions.filter(([status]) => status !== "applied" || record.status === "applied").map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></Field>
    </>
  );
}

const outcomeLabels: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Applied (Yes)", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  not_confirmed: { label: "Submitted, not confirmed", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  failed: { label: "Not submitted (No)", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  later: { label: "Later", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  test: { label: "Test mode", className: "bg-violet-50 text-violet-700 ring-violet-200" },
  stopped: { label: "Stopped", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  skipped: { label: "Skipped", className: "bg-amber-50 text-amber-700 ring-amber-200" },
};
const sourceLabels: Record<string, string> = {
  profile: "Profile",
  reusable: "Reusable answer",
  ai: "ChatGPT",
  saved: "Saved answer",
  documents: "Documents",
  consent: "Consent",
  rule: "Rule",
  manager: "Manager",
  site: "Site (from résumé)",
};
const sourceClasses: Record<string, string> = {
  profile: "bg-blue-50 text-blue-700",
  reusable: "bg-indigo-50 text-indigo-700",
  ai: "bg-violet-50 text-violet-700",
  saved: "bg-sky-50 text-sky-700",
  manager: "bg-amber-50 text-amber-800",
};
const toneClasses = { info: "text-slate-700", warn: "text-amber-700", error: "text-rose-700" };

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function TrackItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

// The job's other cards: description, its track (Generation and Apply), every Apply run with the
// answers it used, and the failure note.
function JobCards({ record, track }: { record: EditableJob; track?: JobTrack }) {
  const runs = track?.applyRuns ?? [];
  const latest = runs[0];
  const generation = record.generationStatus.replaceAll("_", " ");
  return (
    <>
      <FormCard
        icon={<FileText />}
        summary={record.description ? `${record.description.length.toLocaleString()} characters` : "No description"}
        title="Job description"
      >
        <textarea aria-label="Job description" className={`${inputClass} mt-0 min-h-60`} defaultValue={record.description ?? ""} maxLength={100000} name="description" />
      </FormCard>
      <FormCard
        icon={<Activity />}
        summary={[`Generation: ${generation}`, track?.applyStatus[0]?.text].filter(Boolean).join(" · ")}
        title="Track"
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          {track && <TrackItem label="Saved">{when(track.savedAt)}</TrackItem>}
          <TrackItem label="Generation">
            <span className="capitalize">{generation}</span>
            {record.generationStatus === "processing" && track?.generationBrowserName && <> on {track.generationBrowserName}</>}
          </TrackItem>
          {record.generationError && (
            <TrackItem label="Generation note" wide>
              <span className={record.generationStatus === "failed" ? "text-rose-700" : "text-slate-600"}>{record.generationError}</span>
            </TrackItem>
          )}
          {track?.jobReason && <TrackItem label="Job check" wide>{track.jobReason}</TrackItem>}
          <TrackItem label="Prompt">{track?.prompt ?? "—"}</TrackItem>
          <TrackItem label="Template">{track?.template ?? "—"}</TrackItem>
          <TrackItem label="Job status"><span className="capitalize">{record.status.replaceAll("_", " ")}</span></TrackItem>
          <TrackItem label="Job link">
            <a className="break-all text-blue-700 hover:underline" href={record.url} rel="noopener noreferrer" target="_blank">{record.url}</a>
          </TrackItem>
          <TrackItem label="Résumé folder" wide>
            {track?.resumeLocalPath
              ? <OpenFolderButton folder={resumeFolderOf(track.resumeLocalPath)} savedOn={track.generationBrowserName} />
              : "—"}
          </TrackItem>
          {track?.googleDrivePath && <TrackItem label="Google Drive" wide><code className="break-all text-xs">{track.googleDrivePath}</code></TrackItem>}
          <TrackItem label="Apply" wide>
            {track?.applyStatus.length
              ? track.applyStatus.map((line) => (
                <span className="block" key={line.text}>
                  <span className={`font-medium ${toneClasses[line.tone]}`}>{line.text}</span>
                  {line.detail && <span className="block text-xs text-slate-500">{line.detail}</span>}
                </span>
              ))
              : <span className="text-slate-500">Not applied yet</span>}
          </TrackItem>
        </dl>
      </FormCard>
      <FormCard
        icon={<ListChecks />}
        summary={latest
          ? `${runs.length} ${runs.length === 1 ? "run" : "runs"} · last: ${outcomeLabels[latest.outcome]?.label ?? latest.outcome}, ${when(latest.at)}`
          : "No Apply runs yet"}
        title="Apply answers"
      >
        {runs.length === 0 && <p className="text-sm text-slate-500">Each Apply run (test mode included) keeps the answers it filled here, with where each came from.</p>}
        {runs.map((run, index) => <ApplyRunCard key={`${run.at}-${index}`} run={run} startOpen={index === 0} />)}
      </FormCard>
      <FormCard
        icon={<AlertTriangle />}
        summary={record.failureReason || "None"}
        title="Failure reason"
      >
        <textarea aria-label="Failure reason" className={`${inputClass} mt-0 min-h-24`} defaultValue={record.failureReason ?? ""} maxLength={5000} name="failureReason" />
      </FormCard>
    </>
  );
}

// One Apply run: how it ended, when, and each answer with where it came from.
function ApplyRunCard({ run, startOpen }: { run: ApplyRun; startOpen: boolean }) {
  const outcome = outcomeLabels[run.outcome] ?? { label: run.outcome, className: "bg-slate-100 text-slate-700 ring-slate-200" };
  const counts = Object.entries(run.answers.reduce<Record<string, number>>((all, answer) => {
    all[answer.source] = (all[answer.source] ?? 0) + 1;
    return all;
  }, {}));
  return (
    <details className="rounded-lg border border-slate-200" open={startOpen || undefined}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${outcome.className}`}>{outcome.label}</span>
        <span className="text-xs text-slate-600">{when(run.at)}</span>
        <span className="text-xs text-slate-500">· {run.answers.length} {run.answers.length === 1 ? "answer" : "answers"}</span>
        {counts.map(([source, count]) => (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceClasses[source] ?? "bg-slate-100 text-slate-600"}`} key={source}>
            {sourceLabels[source] ?? source} {count}
          </span>
        ))}
      </summary>
      <div className="border-t border-slate-100 px-3 py-2">
        {run.reason && <p className="mb-2 text-xs text-slate-600">{run.reason}</p>}
        {run.answers.length === 0
          ? <p className="text-xs text-slate-500">No answers were filled in this run.</p>
          : (
            <ul className="divide-y divide-slate-100">
              {run.answers.map((answer, index) => (
                <li className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:gap-3" key={`${answer.question}-${index}`}>
                  <span className="text-xs font-medium text-slate-700">{answer.question}</span>
                  <span className="whitespace-pre-wrap break-words text-xs text-slate-900">{answer.answer || "—"}</span>
                  <span className={`h-fit w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceClasses[answer.source] ?? "bg-slate-100 text-slate-600"}`}>
                    {sourceLabels[answer.source] ?? answer.source}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </details>
  );
}
// A bid's read-only cards: where and when it was made, its documents and setup, and the answers it
// was submitted with.
function BidCards({ record, details }: { record: EditableBid; details: BidDetails }) {
  // The list leaves the answers out, so they load here once; null while loading or if they cannot be read.
  const [loaded, setLoaded] = useState<SubmittedAnswer[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (details.answers) return;
    let current = true;
    loadBidAnswersAction(record.id)
      .then((answers) => { if (current) { if (answers) setLoaded(answers); else setFailed(true); } })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [details.answers, record.id]);
  const answers = details.answers ?? loaded;

  return (
    <>
      <FormCard
        icon={<Activity />}
        summary={`Applied ${details.appliedAt}`}
        title="Bid record"
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <TrackItem label="Candidate">{details.candidateName}<span className="text-slate-500"> · {details.category || "Uncategorized"}</span></TrackItem>
          <TrackItem label="Source site">
            {details.sourceSiteUrl
              ? <a className="break-all text-blue-700 hover:underline" href={details.sourceSiteUrl} rel="noreferrer" target="_blank">{details.sourceSiteUrl}</a>
              : "—"}
          </TrackItem>
          <TrackItem label="Job">
            <a className="text-blue-700 hover:underline" href={record.url} rel="noreferrer" target="_blank">{record.title}</a>
            <span className="text-slate-500"> · {record.company}</span>
          </TrackItem>
          <TrackItem label="Applied">{details.appliedAt}</TrackItem>
          <TrackItem label="Created">{details.createdAt}</TrackItem>
          <TrackItem label="Prompt">{details.promptName ?? "—"}</TrackItem>
          <TrackItem label="Template">{details.templateName ?? "—"}</TrackItem>
          <TrackItem label="Résumé folder" wide><OpenFolderButton folder={record.resumeFolder} savedOn={details.resumeSavedOn} /></TrackItem>
          {record.googleDrivePath && <TrackItem label="Google Drive" wide><code className="break-all text-xs">{record.googleDrivePath}</code></TrackItem>}
        </dl>
      </FormCard>
      <FormCard
        icon={<ListChecks />}
        summary={answers ? `${answers.length} ${answers.length === 1 ? "answer" : "answers"}` : failed ? "Could not load" : "Loading…"}
        title="Submitted answers"
      >
        {!answers
          ? failed
            ? <p className="text-sm text-rose-700" role="alert">The answers could not be loaded. Close and open the bid again.</p>
            : <p className="flex items-center gap-2 text-sm text-slate-500" role="status"><LoadingIcon className="size-4" />Loading answers…</p>
          : answers.length === 0
          ? <p className="text-sm text-slate-500">No answers were kept for this bid.</p>
          : (
            <ul className="divide-y divide-slate-100">
              {answers.map((answer, index) => (
                <li className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:gap-3" key={`${answer.question}-${index}`}>
                  <span className="text-xs font-medium text-slate-700">{answer.question}</span>
                  <span className="whitespace-pre-wrap break-words text-xs text-slate-900">{answer.answer || "—"}</span>
                  <span className={`h-fit w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceClasses[answer.source] ?? "bg-slate-100 text-slate-600"}`}>
                    {sourceLabels[answer.source] ?? answer.source}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </FormCard>
    </>
  );
}

function BidFields({ record }: { record: EditableBid }) {
  return (
    <>
      <Field label="Work type"><input className={inputClass} defaultValue={record.workType ?? ""} maxLength={200} name="workType" placeholder="Full-time · Remote" /></Field>
      <Field label="Salary"><input className={inputClass} defaultValue={record.salary ?? ""} maxLength={500} name="salary" /></Field>
      <Field className="sm:col-span-2" label="Résumé folder"><input className={inputClass} defaultValue={record.resumeFolder} maxLength={2048} name="resumeFolder" /></Field>
      <Field className="sm:col-span-2" label="Google Drive path"><input className={inputClass} defaultValue={record.googleDrivePath ?? ""} maxLength={2048} name="googleDrivePath" /></Field>
    </>
  );
}
const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) { return <label className={`text-xs font-semibold text-slate-700 ${className}`}>{label}{children}</label>; }
