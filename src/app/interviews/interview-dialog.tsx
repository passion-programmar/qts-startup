"use client";

// The Add / Edit interview window. Picking an applied job (a bid) fills in its account, category,
// applied date, company, title and link; every value can then be changed, and the job details can
// also be typed in by hand.
import { Search, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveInterviewAction, searchBidChoicesAction } from "@/app/interviews/actions";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import { TrackLine } from "@/app/interviews/interview-track";
import { TimeSelect } from "@/app/interviews/time-select";
import { ZoneSelect } from "@/app/interviews/zone-select";
import { initialRecordState, type RecordActionState } from "@/app/record-action-state";
import { DatePicker } from "@/app/components/date-picker";
import { LoadingIcon } from "@/app/components/loading-icon";
import type { BidChoice } from "@/server/interviews/interviews-list";
import {
  addMinutesToTime,
  endAfterStartChange,
  endTimeOptions,
  interviewerKinds,
  interviewResults,
  interviewSteps,
  joinInterviewer,
  splitInterviewer,
  startTimeOptions,
  timeToMinutes,
  type InterviewStep,
} from "@/server/interviews/interview-values";
import { weekdayOf, zonedDay, zonedMoment, zonedTime, zoneShortName } from "@/server/interviews/zone-time";

export type { InterviewRecord } from "@/server/interviews/interview-record";
import type { InterviewRecord } from "@/server/interviews/interview-record";

type JobFields = { candidateId: string; candidateName: string; category: string; appliedDate: string; company: string; jobTitle: string; jobUrl: string };

const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100";
const labelClass = "mb-2 block text-xs font-semibold text-slate-700";

function jobOf(source: Pick<BidChoice, "candidateId" | "candidateName" | "category" | "appliedAt" | "company" | "jobTitle" | "jobUrl">, zone: string): JobFields {
  return {
    candidateId: source.candidateId,
    candidateName: source.candidateName,
    category: source.category ?? "",
    appliedDate: zonedDay(new Date(source.appliedAt), zone),
    company: source.company,
    jobTitle: source.jobTitle,
    jobUrl: source.jobUrl,
  };
}

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const startOptions = startTimeOptions();
// With no start yet, the start list opens at 09:00.
const NINE_O_CLOCK = 36;

/** "Mon, 16 Nov 2026" for "2026-11-16". */
function readableDay(day: string): string {
  return `${weekdayNames[weekdayOf(day)]}, ${Number(day.slice(8))} ${monthNames[Number(day.slice(5, 7)) - 1] ?? ""} ${day.slice(0, 4)}`;
}

export function InterviewDialog({
  record,
  bid: initialBid,
  follow,
  defaultStep = "intro",
  onClose,
}: {
  // Editing: the round. Adding: no record, and optionally the bid (and step) to start from.
  record?: InterviewRecord;
  bid?: BidChoice | null;
  // Add next step: the round this one follows; its job, track and caller carry over.
  follow?: InterviewRecord;
  defaultStep?: InterviewStep;
  onClose: () => void;
}) {
  const editing = Boolean(record);
  const { accounts, callers, categories, settings, today } = useInterviewChoices();
  // The Manager's zone (CET unless they chose another): job dates, and where the times open.
  const zone = settings.timeZone;
  // The zone the date and times are typed in; it can be switched (e.g. to Japan) for this round.
  const [entryZone, setEntryZone] = useState(zone);
  // Changes when the zone switch moves the date, so the date picker shows the new day.
  const [dateKey, setDateKey] = useState(0);
  // The job details shown in the form (null: the applied-job picker is shown instead), and the bid
  // a new round is linked to. fill changes each time the details are refilled, to reset the fields.
  const [job, setJob] = useState<JobFields | null>(record ? jobOf(record, zone) : follow ? jobOf(follow, zone) : initialBid ? jobOf(initialBid, zone) : null);
  const [bidId, setBidId] = useState(record ? record.bidId : follow ? follow.bidId : initialBid?.id ?? null);
  const [fill, setFill] = useState(0);
  const [picking, setPicking] = useState(!record && !follow && !initialBid);
  const savedInterviewer = splitInterviewer(record?.interviewer ?? null);
  const [interviewers, setInterviewers] = useState(savedInterviewer.kinds);
  const [interviewerNames, setInterviewerNames] = useState(savedInterviewer.names);
  const [start, setStart] = useState(record ? zonedTime(new Date(record.startsAt), zone) : "");
  const [end, setEnd] = useState(record ? zonedTime(new Date(record.endsAt), zone) : "");
  const [day, setDay] = useState(record ? zonedDay(new Date(record.startsAt), zone) : today);
  const from = day && start ? zonedMoment(day, start, entryZone) : null;
  const zoneName = zoneShortName(entryZone, from ?? (record ? new Date(record.startsAt) : new Date()));
  // The same round in the Manager's zone and second zone, when the window shows another:
  // "Same time in CET: 03:00–04:00 · EET: 04:00–05:00".
  const sameTime = from && end ? [zone, settings.secondTimeZone]
    .filter((other, index, list): other is string => Boolean(other) && other !== entryZone && list.indexOf(other) === index)
    .map((other) => {
      const to = zonedMoment(day, end, entryZone);
      const otherDay = zonedDay(from, other);
      return `${zoneShortName(other, from)}: ${zonedTime(from, other)}–${zonedTime(to, other)}${otherDay !== day ? ` (${readableDay(otherDay)})` : ""}`;
    })
    .join(" · ") : "";
  const [state, formAction, saving] = useActionState(async (previous: RecordActionState, formData: FormData) => {
    const result = await saveInterviewAction(previous, formData);
    if (result.success) onClose();
    return result;
  }, initialRecordState);
  const changedRef = useRef(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const requestClose = () => (changedRef.current ? setConfirmingClose(true) : onClose());
  const accountMissing = job && !accounts.some((account) => account.id === job.candidateId);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  function pick(choice: BidChoice | null) {
    changedRef.current = true;
    if (choice) {
      setJob(jobOf(choice, zone));
      // An edited round stays linked to its own bid; a new one links to the picked bid.
      if (!editing) setBidId(choice.id);
    } else {
      setJob((current) => current ?? { candidateId: accounts.find((account) => !account.blocked)?.id ?? "", candidateName: "", category: "", appliedDate: today, company: "", jobTitle: "", jobUrl: "" });
      if (!editing) setBidId(null);
    }
    setFill((count) => count + 1);
    setPicking(false);
  }

  // Switching the zone keeps the same moment: 10:00 CET becomes 18:00 JST, so an interview is
  // never moved by accident. To enter a time as a recruiter gave it, switch first, then pick it.
  function changeZone(next: string) {
    changedRef.current = true;
    if (day && start) {
      const moment = zonedMoment(day, start, entryZone);
      const length = (timeToMinutes(end) ?? 0) - (timeToMinutes(start) ?? 0);
      const nextStart = zonedTime(moment, next);
      setDay(zonedDay(moment, next));
      setStart(nextStart);
      setEnd(end && length > 0 ? addMinutesToTime(nextStart, length) : "");
      setDateKey((count) => count + 1);
    }
    setEntryZone(next);
  }

  function changeStart(value: string) {
    setStart(value);
    // As in Google Calendar, the end moves with the start and keeps the length (first time: the default length).
    if (value) setEnd(endAfterStartChange(start, end, value, settings.defaultMinutes));
  }

  return (
    <div
      aria-labelledby="interview-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"
      onKeyDown={(event) => {
        // Escape with a date calendar open closes just the calendar (the picker does that itself).
        if (event.key !== "Escape" || confirmingClose || event.defaultPrevented) return;
        if (event.currentTarget.querySelector("[role='dialog'][data-changes-form]")) return;
        requestClose();
      }}
      role="dialog"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-card border border-line bg-card shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900" id="interview-dialog-title">{editing ? "Edit interview" : "Add interview"}</h2>
            <p className="truncate text-xs text-slate-500">{job && !picking ? [job.company, job.jobTitle].filter(Boolean).join(" · ") || "Enter the job details" : "Pick the applied job"}</p>
          </div>
          <button aria-label="Close" className="flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={requestClose} type="button"><X className="size-4" /></button>
        </header>

        {/* While picking, the form stays mounted (hidden) so what was typed in it is kept. */}
        {picking && (
          <div className="space-y-3 p-5">
            <BidPicker onPick={pick} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <button className="text-sm font-semibold text-indigo-600 hover:underline" onClick={() => pick(null)} type="button">
                {job ? "Keep the details I entered" : "Enter job details myself"}
              </button>
              <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={requestClose} type="button">Cancel</button>
            </div>
          </div>
        )}
        {job && (
          <form
            action={formAction}
            className="space-y-5 p-5"
            hidden={picking}
            onChangeCapture={() => { changedRef.current = true; }}
            onInputCapture={() => { changedRef.current = true; }}
          >
            {record && <input name="id" type="hidden" value={record.id} />}
            <input name="timeZone" type="hidden" value={entryZone} />
            <input name="appliedTimeZone" type="hidden" value={zone} />
            {!record && follow && <input name="trackId" type="hidden" value={follow.trackId} />}
            {!record && bidId && <input name="bidId" type="hidden" value={bidId} />}

            {(record || follow) && (
              <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{record ? "Track" : `Track · adding ${interviewSteps.find((step) => step.key === defaultStep)?.label ?? ""}`}</h3>
                <TrackLine currentId={record?.id} trackId={(record ?? follow)?.trackId ?? ""} />
                {follow && <p className="mt-2 text-[11px] text-slate-500">Earlier rounds still Waiting are marked Passed when this one is added.</p>}
              </section>
            )}
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Job</h3>
                {!(editing && bidId) && !follow && (
                  <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setPicking(true)} type="button">Fill from an applied job</button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2" key={fill}>
                {bidId ? (
                  // From an applied job: these three are that job's and cannot be changed here.
                  <dl className="grid gap-4 text-sm sm:col-span-2 sm:grid-cols-3">
                    <Detail label="Account">{job.candidateName || "—"}</Detail>
                    <Detail label="Category">{job.category || "—"}</Detail>
                    <Detail label="Applied date">{job.appliedDate}</Detail>
                  </dl>
                ) : (
                  <>
                    <div>
                      <label className={labelClass} htmlFor="candidateId">Account</label>
                      <select className={inputClass} defaultValue={job.candidateId} id="candidateId" name="candidateId" required>
                        <option disabled value="">Choose the account</option>
                        {accountMissing && job.candidateId && <option value={job.candidateId}>{record?.candidateName ?? "Unknown account"}</option>}
                        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.blocked ? " (blocked)" : ""}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="category">Category</label>
                      <input className={inputClass} defaultValue={job.category} id="category" list="interview-categories" maxLength={200} name="category" />
                      <datalist id="interview-categories">{categories.map((name) => <option key={name} value={name} />)}</datalist>
                    </div>
                    <DatePicker defaultValue={job.appliedDate} id="appliedDate" label="Applied date" name="appliedDate" required />
                  </>
                )}
                <div>
                  <label className={labelClass} htmlFor="company">Company</label>
                  <input className={inputClass} defaultValue={job.company} id="company" maxLength={500} name="company" required />
                </div>
                <div>
                  <label className={labelClass} htmlFor="jobTitle">Job title</label>
                  <input className={inputClass} defaultValue={job.jobTitle} id="jobTitle" maxLength={500} name="jobTitle" required />
                </div>
                <div>
                  <label className={labelClass} htmlFor="jobUrl">Job URL</label>
                  <input className={inputClass} defaultValue={job.jobUrl} id="jobUrl" maxLength={2048} name="jobUrl" placeholder="https://…" required type="url" />
                </div>
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className={labelClass}>Interviewer <span className="font-normal text-slate-500">(choose any)</span></span>
                <input name="interviewer" type="hidden" value={joinInterviewer(interviewers, interviewerNames)} />
                <div className="flex flex-wrap gap-2" role="group" aria-label="Interviewer">
                  {interviewerKinds.map((kind) => (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 has-checked:border-indigo-400 has-checked:bg-indigo-50 has-checked:text-indigo-700" key={kind}>
                      <input
                        checked={interviewers.includes(kind)}
                        className="accent-indigo-600"
                        onChange={(event) => setInterviewers((current) => event.target.checked ? [...current, kind] : current.filter((entry) => entry !== kind))}
                        type="checkbox"
                        value={kind}
                      />
                      {kind}
                    </label>
                  ))}
                </div>
                {/* A name for each ticked interviewer, in the same order: "Recruiter [Anna]". */}
                {interviewers.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {interviewerKinds.filter((kind) => interviewers.includes(kind)).map((kind) => (
                      <div className="flex items-center gap-2" key={kind}>
                        <label className="w-28 shrink-0 text-xs font-semibold text-slate-600" htmlFor={`interviewer-name-${kind}`}>{kind}</label>
                        <input
                          className={inputClass}
                          id={`interviewer-name-${kind}`}
                          maxLength={120}
                          onChange={(event) => setInterviewerNames((current) => ({ ...current, [kind]: event.target.value }))}
                          placeholder={kind === "Team Member" ? "Names (optional), e.g. Bob, Eve" : kind === "Other" ? "Who? (optional)" : "Name (optional)"}
                          value={interviewerNames[kind] ?? ""}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="callerId">Caller</label>
                <select className={inputClass} defaultValue={record?.callerId ?? follow?.callerId ?? ""} id="callerId" name="callerId">
                  <option value="">{callers.length ? "No caller" : "No callers yet (your Admin adds them)"}</option>
                  {record?.callerId && !callers.some((caller) => caller.id === record.callerId) && (
                    <option value={record.callerId}>{record.callerName ?? "Caller"} (removed)</option>
                  )}
                  {callers.map((caller) => <option key={caller.id} value={caller.id}>{caller.name}{caller.label ? ` · ${caller.label}` : ""}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <span className={labelClass}>Step</span>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {interviewSteps.map((step) => (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 has-checked:border-indigo-400 has-checked:bg-indigo-50 has-checked:text-indigo-700" key={step.key}>
                      <input className="accent-indigo-600" defaultChecked={(record?.step ?? defaultStep) === step.key} name="step" required type="radio" value={step.key} />
                      {step.label}
                    </label>
                  ))}
                </div>
              </div>
              {/* One row, as in Google Calendar: [Mon, 16 Nov 2026] [14:00] to [15:00] EET */}
              <div className="sm:col-span-2">
                <span className={labelClass}>When</span>
                <div className="flex flex-wrap items-center gap-2">
                  <DatePicker defaultValue={day} formatValue={readableDay} hideLabel id="interviewDate" key={dateKey} label={`Date (${zoneName})`} name="interviewDate" onChange={setDay} required />
                  <TimeSelect fallbackIndex={NINE_O_CLOCK} id="interviewTime" label={`Start time (${zoneName})`} name="interviewTime" onChange={changeStart} options={startOptions} required value={start} />
                  <span className="text-sm text-slate-500">to</span>
                  <TimeSelect id="interviewEndTime" label={`End time (${zoneName})`} name="interviewEndTime" onChange={setEnd} options={endTimeOptions(start)} required value={end} />
                  <ZoneSelect
                    className="h-10 w-28 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    id="interviewZone"
                    label="Time zone for this interview"
                    onChange={changeZone}
                    short
                    value={entryZone}
                  />
                </div>
                {sameTime && <p className="mt-1.5 text-xs text-slate-500">Same time in {sameTime}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="meetingLink">Meeting link</label>
                <input className={inputClass} defaultValue={record?.meetingLink ?? ""} id="meetingLink" maxLength={2048} name="meetingLink" placeholder="https://zoom.us/j/…" type="url" />
              </div>
              <div>
                <label className={labelClass} htmlFor="result">Result</label>
                <select className={inputClass} defaultValue={record?.result ?? "waiting"} id="result" name="result">
                  {interviewResults.map((result) => <option key={result.key} value={result.key}>{result.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass} htmlFor="comment">Comment</label>
                <textarea className={`${inputClass} h-auto py-2`} defaultValue={record?.comment ?? ""} id="comment" maxLength={2000} name="comment" rows={3} />
              </div>
            </section>

            {state.error && <p className="text-sm text-rose-700" role="alert">{state.error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={requestClose} type="button">Cancel</button>
              <button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">
                {saving && <LoadingIcon className="size-4" />}
                {saving ? "Saving..." : editing ? "Save changes" : "Add interview"}
              </button>
            </div>
          </form>
        )}
      </div>
      {confirmingClose && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/35 p-4">
          <div aria-modal="true" className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-2xl" role="alertdialog">
            <h2 className="text-lg font-semibold text-fg">Discard unsaved changes?</h2>
            <p className="mt-2 text-sm leading-6 text-fg-muted">You changed this interview but have not saved it.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="min-h-10 rounded-control border border-rose-200 px-4 text-sm font-medium text-rose-700 hover:bg-rose-50" onClick={onClose} type="button">Discard changes</button>
              <button autoFocus className="min-h-10 rounded-control bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700" onClick={() => setConfirmingClose(false)} type="button">Keep editing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Searches the Manager's bids (company, job title or account) as they type, newest first.
function BidPicker({ onPick }: { onPick: (bid: BidChoice) => void }) {
  const [words, setWords] = useState("");
  const zone = useInterviewChoices().settings.timeZone;
  const [results, setResults] = useState<BidChoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      searchBidChoicesAction(words)
        .then((rows) => { if (!cancelled) setResults(rows); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, words ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [words]);

  return (
    <section>
      <label className={labelClass} htmlFor="bid-search">Applied job</label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          className={`${inputClass} pl-9`}
          id="bid-search"
          onChange={(event) => setWords(event.target.value)}
          placeholder="Search company, job title or account"
          type="search"
          value={words}
        />
        {loading && <LoadingIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-indigo-500" />}
      </div>
      <ul aria-label="Applied jobs" className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {(results ?? []).map((choice) => (
          <li key={choice.id}>
            <button className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-indigo-50" onClick={() => onPick(choice)} type="button">
              <span className="text-sm font-medium text-slate-800">{choice.company} — {choice.jobTitle}</span>
              <span className="text-xs text-slate-500">{choice.candidateName}{choice.category ? ` · ${choice.category}` : ""} · applied {zonedDay(new Date(choice.appliedAt), zone)}</span>
            </button>
          </li>
        ))}
        {results && results.length === 0 && !loading && (
          <li className="px-3 py-6 text-center text-sm text-slate-500">{words ? "No applied jobs match" : "No applied jobs yet"}</li>
        )}
      </ul>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{children}</dd>
    </div>
  );
}
