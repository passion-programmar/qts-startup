"use client";

// A round's details card (opened from the calendar or the By job table): the job, times in both
// zones, its track (click another step to see that round), and Join, result, Edit and the ⋯ menu.
import { ExternalLink, Video, X } from "lucide-react";
import { useState } from "react";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import { InterviewCountdown } from "@/app/interviews/interview-countdown";
import { InterviewRowActions } from "@/app/interviews/interview-controls";
import { ResultMark, shortDay, TrackLine } from "@/app/interviews/interview-track";
import type { InterviewRecord } from "@/server/interviews/interview-record";
import { resultLabel, stepClasses, stepLabel, type InterviewStep } from "@/server/interviews/interview-values";
import { timeRange, weekdayOf, zonedDay, zoneShortName } from "@/server/interviews/zone-time";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const stepDotClasses: Record<InterviewStep, string> = {
  intro: "bg-slate-500",
  tech: "bg-blue-600",
  final: "bg-violet-600",
  offer: "bg-emerald-600",
};

export function DetailsCard({ record, onClose }: { record: InterviewRecord; onClose: () => void }) {
  const { settings, today } = useInterviewChoices();
  // Another round of the track, when one was clicked on the Track line.
  const [opened, setOpened] = useState<InterviewRecord | null>(null);
  const shown = opened ?? record;
  const zone = settings.timeZone;
  const start = new Date(shown.startsAt);
  const day = zonedDay(start, zone);
  return (
    <div aria-labelledby="interview-details-title" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => {
        // Escape in a window opened from the card (Edit) closes that window, not the card.
        if (event.key === "Escape" && (event.target as HTMLElement).closest("[role='dialog']") === event.currentTarget) onClose();
      }} role="dialog">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={`mt-1.5 size-3.5 shrink-0 rounded ${stepDotClasses[shown.step]}`} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900" id="interview-details-title">{shown.company} · {stepLabel(shown.step)}</h2>
            <p className="text-sm text-slate-600">{weekdayNames[weekdayOf(day)]}, {day} · {timeRange(shown, zone)} {zoneShortName(zone, start)}</p>
            {settings.secondTimeZone && <p className="text-xs text-slate-500">{zonedDay(start, settings.secondTimeZone)} · {timeRange(shown, settings.secondTimeZone)} {zoneShortName(settings.secondTimeZone, start)}</p>}
            {/* Today's rounds only: the countdown to the start, then its progress. */}
            {day === today && <InterviewCountdown className="mt-2" endsAt={shown.endsAt} startsAt={shown.startsAt} />}
          </div>
          <button aria-label="Close" autoFocus className="flex size-8 items-center justify-center rounded-lg hover:bg-slate-100" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
        <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Track</h3>
          <TrackLine currentId={shown.id} onOpen={setOpened} trackId={shown.trackId} />
        </section>
        <dl className="mt-4 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-slate-500">Job</dt>
          <dd><a className="inline-flex items-center gap-1 text-blue-700 hover:underline" href={shown.jobUrl} rel="noreferrer" target="_blank">{shown.jobTitle}<ExternalLink aria-hidden="true" className="size-3" /></a></dd>
          <dt className="text-slate-500">Account</dt><dd className="text-slate-800">{shown.candidateName}</dd>
          <dt className="text-slate-500">Category</dt><dd className="text-slate-800">{shown.category || "—"}</dd>
          <dt className="text-slate-500">Applied</dt><dd className="text-slate-800">{zonedDay(new Date(shown.appliedAt), zone)}</dd>
          <dt className="text-slate-500">Interviewer</dt><dd className="text-slate-800">{shown.interviewer || "—"}</dd>
          <dt className="text-slate-500">Caller</dt><dd className="text-slate-800">{shown.callerName ? `${shown.callerName}${shown.callerLabel ? ` · ${shown.callerLabel}` : ""}` : "—"}</dd>
          <dt className="text-slate-500">Step</dt><dd><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${stepClasses[shown.step]}`}>{stepLabel(shown.step)}</span> <span className="text-xs text-slate-500">{resultLabel(shown.result)}</span></dd>
          {shown.comment && (<><dt className="text-slate-500">Comment</dt><dd className="whitespace-pre-line break-words text-slate-800">{shown.comment}</dd></>)}
        </dl>
        <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-slate-100 pt-4">
          {shown.meetingLink && new Date(shown.endsAt) > new Date() && (
            <a className="inline-flex h-8 items-center gap-1.5 rounded-control bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700" href={shown.meetingLink} rel="noreferrer" target="_blank">
              <Video aria-hidden="true" className="size-3.5" /> Join
            </a>
          )}
          <InterviewRowActions key={shown.id} onDone={onClose} record={shown} />
        </div>
      </div>
    </div>
  );
}

/** A step's cell in the By job table: its latest round's mark and day; clicking opens the round. */
export function TrackStepCell({ round, count }: { round: InterviewRecord | null; count: number }) {
  const { settings } = useInterviewChoices();
  const [open, setOpen] = useState(false);
  if (!round) return <span className="text-slate-300">–</span>;
  const start = new Date(round.startsAt);
  return (
    <>
      <button className="flex items-start gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-slate-100" onClick={() => setOpen(true)} title={`${stepLabel(round.step)} · ${resultLabel(round.result)}`} type="button">
        <ResultMark className="mt-0.5 size-3.5 shrink-0" result={round.result} />
        <span className="text-xs leading-tight">
          <span className={round.result === "waiting" ? "font-semibold text-slate-800" : "text-slate-700"}>{shortDay(zonedDay(start, settings.timeZone))}</span>
          {round.result === "waiting" && <span className="block text-[11px] text-slate-500">{timeRange(round, settings.timeZone)}</span>}
          {count > 1 && <span className="block text-[10px] text-slate-500">×{count} rounds</span>}
        </span>
      </button>
      {open && <DetailsCard onClose={() => setOpen(false)} record={round} />}
    </>
  );
}
