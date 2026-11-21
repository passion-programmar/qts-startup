"use client";

import { CalendarPlus, ChevronLeft, ChevronRight, ExternalLink, ListPlus, MoreHorizontal, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { deleteInterviewAction, saveInterviewSettingsAction, setInterviewResultAction } from "@/app/interviews/actions";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import type { InterviewRecord } from "@/app/interviews/interview-dialog";
import { initialRecordState, type RecordActionState } from "@/app/record-action-state";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import { ZoneSelect } from "@/app/interviews/zone-select";
import type { BidChoice } from "@/server/interviews/interviews-list";
import {
  interviewLengths,
  interviewResults,
  isEndedResult,
  resultLabel,
  interviewSteps,
  nextInterviewStep,
  resultClasses,
  stepLabel,
  type InterviewResult,
  type InterviewStep,
} from "@/server/interviews/interview-values";
import { calendarModes, interviewViews, interviewsHref, trackStatuses, type InterviewsQuery, type InterviewView, type TrackStatus } from "@/server/interviews/interviews-query";
import { timeRange, zonedDay, zoneLabel, zoneShortName } from "@/server/interviews/zone-time";

// The window (with its calendar) downloads the first time it opens, so the page loads without it.
const InterviewDialog = dynamic(() => import("@/app/interviews/interview-dialog").then((module) => module.InterviewDialog), {
  loading: () => (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55" role="status">
      <LoadingIcon className="size-6 text-white" />
    </div>
  ),
});

type AddRequest = { bid: BidChoice | null; step: InterviewStep };

/** "+ Add interview". With startBid (from the Bids page) the window opens at once with that job. */
export function AddInterviewButton({ startBid }: { startBid: BidChoice | null }) {
  const router = useRouter();
  const [request, setRequest] = useState<AddRequest | null>(startBid ? { bid: startBid, step: "intro" } : null);
  const close = () => {
    setRequest(null);
    // The ?add= link has done its job; going back to it should not open the window again.
    if (startBid) router.replace("/interviews", { scroll: false });
  };
  return (
    <>
      <button
        className="inline-flex h-10 items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
        onClick={() => setRequest({ bid: null, step: "intro" })}
        type="button"
      >
        <Plus aria-hidden="true" className="size-4" />
        Add interview
      </button>
      {request && <InterviewDialog bid={request.bid} defaultStep={request.step} onClose={close} />}
    </>
  );
}

const followUpClasses = {
  plain: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  go: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
  again: "border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100",
} as const;

type FollowUp = { step: InterviewStep; label: string; tone: keyof typeof followUpClasses };

/**
 * What comes after a round: a new date for the same step once it was Rejected, No-show or Cancelled
 * (the old round stays as history), else the next step (green once Passed); none after Offer.
 */
function followUpOf(record: InterviewRecord, result: InterviewResult): FollowUp | null {
  if (isEndedResult(result)) return { step: record.step, label: `New date (${stepLabel(record.step)})`, tone: "again" };
  const next = nextInterviewStep(record.step);
  return next ? { step: next, label: `Next step (${stepLabel(next)})`, tone: result === "passed" ? "go" : "plain" } : null;
}

/**
 * A round's result picker, its follow-up (next step or new date), Edit and Delete: Open job and
 * Delete in a ⋯ menu in the tables, or everything on one line (inline) in the details card, most used
 * first and Edit / Delete apart at the end.
 */
export function InterviewRowActions({ record, onDone, inline = false, lead }: { record: InterviewRecord; onDone?: () => void; inline?: boolean; lead?: ReactNode }) {
  const { settings } = useInterviewChoices();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<InterviewStep | null>(null);
  // After a result is set: offer its follow-up (the next round, or a new date) right away.
  const [ask, setAsk] = useState<{ text: string; followUp: FollowUp } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [result, setResult] = useState<InterviewResult>(record.result);
  const [resultError, setResultError] = useState<string | null>(null);
  const [savingResult, startSavingResult] = useTransition();
  const [deleteState, deleteAction, deleting] = useActionState(async (previous: RecordActionState, formData: FormData) => {
    const outcome = await deleteInterviewAction(previous, formData);
    if (outcome.success) onDone?.();
    return outcome;
  }, initialRecordState);
  const menuRef = useRef<HTMLDivElement>(null);
  const followUp = followUpOf(record, result);

  // A new value from the server (after a save elsewhere) replaces the one shown.
  const [shownResult, setShownResult] = useState(record.result);
  if (shownResult !== record.result) {
    setShownResult(record.result);
    setResult(record.result);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  function changeResult(value: InterviewResult) {
    const previous = result;
    setResult(value);
    setResultError(null);
    setAsk(null);
    startSavingResult(async () => {
      const saved = await setInterviewResultAction(record.id, value);
      const after = followUpOf(record, value);
      if (saved.error) {
        setResult(previous);
        setResultError(saved.error);
      } else if (value === "passed" && after) {
        setAsk({ text: `Passed. Add the ${stepLabel(after.step)} round?`, followUp: after });
      } else if (isEndedResult(value) && after) {
        setAsk({ text: `${resultLabel(value)}. Did the company offer another date?`, followUp: after });
      }
    });
  }

  // The delete window names the exact round, and says it cannot be undone.
  const deleteText = (
    <>
      This deletes the <strong>{stepLabel(record.step)}</strong> round with <strong>{record.company}</strong> ({record.candidateName}) on{" "}
      <strong>{zonedDay(new Date(record.startsAt), settings.timeZone)} {timeRange(record, settings.timeZone)} {zoneShortName(settings.timeZone, new Date(record.startsAt))}</strong>.
      It cannot be undone. The bid and the other rounds stay.
    </>
  );
  const editButton = (
    <button aria-label={`Edit ${record.company} ${stepLabel(record.step)}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" onClick={() => setEditing(true)} title="Edit" type="button">
      <Pencil aria-hidden="true" className="size-3.5" />
    </button>
  );
  const followUpButton = followUp && (
    <button className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-xs font-semibold ${followUpClasses[followUp.tone]}`} onClick={() => setAdding(followUp.step)} type="button">
      {followUp.tone === "again" ? <CalendarPlus aria-hidden="true" className="size-3.5" /> : <ListPlus aria-hidden="true" className="size-3.5" />} {followUp.label}
    </button>
  );

  return (
    <div className={`flex flex-col items-start gap-1.5 ${inline ? "w-full" : ""}`}>
      <div className={`flex items-center gap-1.5 ${inline ? "w-full" : ""}`}>
        {lead}
        <label className="sr-only" htmlFor={`result-${record.id}`}>Result</label>
        <select
          className={`h-8 rounded-full px-2 text-[11px] font-semibold ring-1 ring-inset focus:outline-none focus:ring-2 focus:ring-indigo-300 ${resultClasses[result]}`}
          disabled={savingResult}
          id={`result-${record.id}`}
          onChange={(event) => changeResult(event.target.value as InterviewResult)}
          value={result}
        >
          {interviewResults.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </select>
        {inline && followUpButton}
        {inline ? (
          // Edit and Delete apart at the end, Delete as a small icon so it is not hit by mistake.
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {editButton}
            {/* No Open job here: the card's job title already opens the job. */}
            <form action={deleteAction}>
              <input name="id" type="hidden" value={record.id} />
              <ConfirmButton
                ariaLabel="Delete interview"
                className="inline-flex size-8 items-center justify-center rounded-control border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                confirmLabel="Delete interview"
                description={deleteText}
                disabled={deleting}
                title="Delete this interview?"
              >
                {deleting ? <LoadingIcon className="size-3.5" /> : <Trash2 aria-hidden="true" className="size-3.5" />}
              </ConfirmButton>
            </form>
          </div>
        ) : (
        <>
        {editButton}
        <div className="relative" ref={menuRef}>
          <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label="More actions" className="inline-flex size-8 items-center justify-center rounded-control border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" onClick={() => setMenuOpen((open) => !open)} title="More" type="button">
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-30 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg" role="menu">
              {followUp && (
                <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setMenuOpen(false); setAdding(followUp.step); }} role="menuitem" type="button">
                  {followUp.tone === "again" ? <CalendarPlus aria-hidden="true" className="size-3.5" /> : <ListPlus aria-hidden="true" className="size-3.5" />} {followUp.label}
                </button>
              )}
              {record.jobUrl && (
                <a className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" href={record.jobUrl} onClick={() => setMenuOpen(false)} rel="noreferrer" role="menuitem" target="_blank">
                  <ExternalLink aria-hidden="true" className="size-3.5" /> Open job
                </a>
              )}
              <form action={deleteAction}>
                <input name="id" type="hidden" value={record.id} />
                <ConfirmButton
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-rose-700 hover:bg-rose-50"
                  confirmLabel="Delete interview"
                  description={deleteText}
                  disabled={deleting}
                  title="Delete this interview?"
                >
                  {deleting ? <LoadingIcon className="size-3.5" /> : <Trash2 aria-hidden="true" className="size-3.5" />} Delete
                </ConfirmButton>
              </form>
            </div>
          )}
        </div>
        </>
        )}
      </div>
      {(resultError || deleteState.error) && <p className="max-w-48 text-[11px] text-rose-700" role="alert">{resultError || deleteState.error}</p>}
      {ask && (
        <div className={`flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${inline ? "" : "max-w-56"} ${ask.followUp.tone === "again" ? "border-orange-200 bg-orange-50 text-orange-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role="status">
          <span>{ask.text}</span>
          <button className={`rounded-md px-2 py-0.5 font-semibold text-white ${ask.followUp.tone === "again" ? "bg-orange-600 hover:bg-orange-700" : "bg-emerald-600 hover:bg-emerald-700"}`} onClick={() => { setAdding(ask.followUp.step); setAsk(null); }} type="button">
            {ask.followUp.tone === "again" ? "Add new date" : "Add"}
          </button>
          <button className="rounded-md px-1.5 py-0.5 font-semibold hover:bg-black/5" onClick={() => setAsk(null)} type="button">Not now</button>
        </div>
      )}
      {editing && <InterviewDialog onClose={() => { setEditing(false); onDone?.(); }} record={record} />}
      {adding && <InterviewDialog defaultStep={adding} follow={record} onClose={() => setAdding(null)} />}
    </div>
  );
}

const selectClass = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100";

/** Upcoming / Past / All with counts, then the step and account filters. Kept in the page address. */
export function InterviewsFilters({
  query,
  counts,
  candidates,
}: {
  query: InterviewsQuery;
  counts: Record<InterviewView, number>;
  candidates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (changes: Partial<InterviewsQuery>) =>
    startTransition(() => router.push(interviewsHref(query, changes), { scroll: false }));
  const filtered = query.step !== "all" || query.candidate !== "all";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <nav aria-label="Which interviews" className="flex flex-wrap gap-1.5">
        {interviewViews.map((view) => {
          const active = view.key === query.view;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                active
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
              }`}
              href={interviewsHref(query, { view: view.key })}
              key={view.key}
              scroll={false}
            >
              {view.label}
              <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{counts[view.key]}</span>
            </Link>
          );
        })}
      </nav>
      <label className="ml-auto flex items-center gap-2 text-xs font-medium text-slate-600">
        Step
        <select className={selectClass} onChange={(event) => open({ step: event.target.value as InterviewsQuery["step"] })} value={query.step}>
          <option value="all">All steps</option>
          {interviewSteps.map((step) => <option key={step.key} value={step.key}>{step.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
        Account
        <select className={selectClass} onChange={(event) => open({ candidate: event.target.value })} value={query.candidate}>
          <option value="all">All accounts</option>
          {query.candidate !== "all" && !candidates.some((candidate) => candidate.id === query.candidate) && (
            <option value={query.candidate}>Unknown account</option>
          )}
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      {filtered && (
        <button className="h-8 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:text-indigo-600" onClick={() => open({ step: "all", candidate: "all" })} type="button">
          Clear filters
        </button>
      )}
      {pending && <LoadingIcon className="size-4 text-indigo-500" />}
    </div>
  );
}

/** [Today] ‹ › November 2026, then Day | Week | Month | List, like Google Calendar's top bar. */
export function CalendarToolbar({ query, title, previous, next }: { query: InterviewsQuery; title: string; previous: string; next: string }) {
  const { settings } = useInterviewChoices();
  const navButton = "inline-flex size-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100";
  const list = query.mode === "list" || query.mode === "jobs" || query.mode === "today";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {!list && (
        <>
          <Link className="inline-flex h-9 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" href={interviewsHref(query, { date: "" })} scroll={false}>Today</Link>
          <Link aria-label="Previous" className={navButton} href={interviewsHref(query, { date: previous })} scroll={false}><ChevronLeft aria-hidden="true" className="size-5" /></Link>
          <Link aria-label="Next" className={navButton} href={interviewsHref(query, { date: next })} scroll={false}><ChevronRight aria-hidden="true" className="size-5" /></Link>
          <h2 className="ml-1 text-xl font-normal text-slate-800">{title}</h2>
        </>
      )}
      {query.mode === "list" && <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">All interviews</h2>}
      {query.mode === "jobs" && <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">By job</h2>}
      <span className="text-xs text-slate-500" title={zoneLabel(settings.timeZone)}>
        {zoneShortName(settings.timeZone)}{settings.secondTimeZone ? ` · ${zoneShortName(settings.secondTimeZone)}` : ""}
      </span>
      <nav aria-label="Calendar view" className="ml-auto flex rounded-full border border-slate-300 bg-white p-0.5">
        {calendarModes.map((mode) => (
          <Link
            aria-current={query.mode === mode.key ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${query.mode === mode.key ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            href={interviewsHref(query, { mode: mode.key })}
            key={mode.key}
            scroll={false}
          >
            {mode.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** ⚙ Time settings: the zone times are shown and entered in, a second zone, and the default length. */
export function TimeSettingsButton() {
  const { settings } = useInterviewChoices();
  const [open, setOpen] = useState(false);
  const [second, setSecond] = useState(settings.secondTimeZone ?? "");
  const [state, formAction, saving] = useActionState(async (previous: RecordActionState, formData: FormData) => {
    const outcome = await saveInterviewSettingsAction(previous, formData);
    if (outcome.success) setOpen(false);
    return outcome;
  }, initialRecordState);
  const labelClass = "mb-2 block text-xs font-semibold text-slate-700";

  return (
    <>
      <button
        className="inline-flex h-10 items-center gap-2 rounded-control border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        onClick={() => { setSecond(settings.secondTimeZone ?? ""); setOpen(true); }}
        title="Time settings"
        type="button"
      >
        <Settings aria-hidden="true" className="size-4" />
        Time settings
      </button>
      {open && (
        <div aria-labelledby="time-settings-title" aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} role="dialog">
          <form action={formAction} className="w-full max-w-lg rounded-card border border-line bg-card shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="font-semibold text-slate-900" id="time-settings-title">Time settings</h2>
              <button aria-label="Close" className="flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={() => setOpen(false)} type="button"><X className="size-4" /></button>
            </header>
            <div className="space-y-4 p-5">
              <div>
                <span className={labelClass}>Time zone</span>
                <p className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">{zoneLabel(settings.timeZone)}</p>
                <p className="mt-1.5 text-xs text-slate-500">Interviews are always saved and shown in CET. The Add window can still take a time in another zone (e.g. Japan); it is changed to CET when saved.</p>
              </div>
              <div>
                <label className={labelClass} htmlFor="settings-second-zone">Second time zone</label>
                <ZoneSelect allowNone id="settings-second-zone" name="secondTimeZone" onChange={setSecond} value={second === settings.timeZone ? "" : second} />
                <p className="mt-1.5 text-xs text-slate-500">Shown beside the first one, e.g. the company&apos;s zone.</p>
              </div>
              <div>
                <label className={labelClass} htmlFor="settings-length">Default interview length</label>
                <select className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800" defaultValue={settings.defaultMinutes} id="settings-length" name="defaultMinutes">
                  {interviewLengths.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`}</option>)}
                </select>
                <p className="mt-1.5 text-xs text-slate-500">A new interview&apos;s end time is set this long after its start.</p>
              </div>
              {state.error && <p className="text-sm text-rose-700" role="alert">{state.error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={() => setOpen(false)} type="button">Cancel</button>
              <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">
                {saving && <LoadingIcon className="size-4" />}
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/** By job: All / In progress / Offer / Ended with counts, then the account filter. Kept in the page address. */
export function TracksFilters({
  query,
  counts,
  candidates,
}: {
  query: InterviewsQuery;
  counts: Record<TrackStatus, number>;
  candidates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <nav aria-label="Which jobs" className="flex flex-wrap gap-1.5">
        {trackStatuses.map((status) => {
          const active = status.key === query.status;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                active
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
              }`}
              href={interviewsHref(query, { status: status.key })}
              key={status.key}
              scroll={false}
            >
              {status.label}
              <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{counts[status.key]}</span>
            </Link>
          );
        })}
      </nav>
      <label className="ml-auto flex items-center gap-2 text-xs font-medium text-slate-600">
        Account
        <select
          className={selectClass}
          onChange={(event) => startTransition(() => router.push(interviewsHref(query, { candidate: event.target.value }), { scroll: false }))}
          value={query.candidate}
        >
          <option value="all">All accounts</option>
          {query.candidate !== "all" && !candidates.some((candidate) => candidate.id === query.candidate) && (
            <option value={query.candidate}>Unknown account</option>
          )}
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      {pending && <LoadingIcon className="size-4 text-indigo-500" />}
    </div>
  );
}
