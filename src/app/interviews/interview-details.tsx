"use client";

// A round's details card (opened from the calendar or the By job table): the job, times in both
// zones, its track (click another step to see that round), and Join, result, Edit and the ⋯ menu.
import { ExternalLink, Video, X } from "lucide-react";
import { useState } from "react";
import { categoryColors, colorOf } from "@/app/interviews/category-colors";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import { InterviewCountdown } from "@/app/interviews/interview-countdown";
import { CopyInterviewButton } from "@/app/interviews/interview-hover-card";
import { InterviewRowActions } from "@/app/interviews/interview-controls";
import { ResultMark, shortDay, TrackLine } from "@/app/interviews/interview-track";
import type { InterviewRecord } from "@/server/interviews/interview-record";
import { isEndedResult, resultLabel, resultLook, stepClasses, stepLabel, type InterviewStep } from "@/server/interviews/interview-values";
import { timeRange, weekdayOf, zonedDay, zoneShortName } from "@/server/interviews/zone-time";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fullWeekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Tomorrow", "In 3 days", "Yesterday", "5 days ago", with a colour for each. */
function relativeDay(day: string, today: string): { text: string; tone: string } {
  const diff = today ? Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : Number.NaN;
  if (Number.isNaN(diff)) return { text: day, tone: "bg-slate-100 text-slate-600" };
  if (diff === 0) return { text: "Today", tone: "bg-amber-400 text-amber-950" };
  if (diff === 1) return { text: "Tomorrow", tone: "bg-blue-600 text-white" };
  if (diff > 1) return { text: `In ${diff} days`, tone: "bg-blue-100 text-blue-800" };
  if (diff === -1) return { text: "Yesterday", tone: "bg-slate-200 text-slate-700" };
  return { text: `${-diff} days ago`, tone: "bg-slate-200 text-slate-700" };
}
export const stepDotClasses: Record<InterviewStep, string> = {
  intro: "bg-slate-500",
  tech: "bg-blue-600",
  final: "bg-violet-600",
  offer: "bg-emerald-600",
};

export function DetailsCard({ record, onClose }: { record: InterviewRecord; onClose: () => void }) {
  const { settings, today, categories } = useInterviewChoices();
  // Another round of the track, when one was clicked on the Track line.
  const [opened, setOpened] = useState<InterviewRecord | null>(null);
  const shown = opened ?? record;
  const zone = settings.timeZone;
  const second = settings.secondTimeZone;
  const start = new Date(shown.startsAt);
  const day = zonedDay(start, zone);
  const minutes = Math.round((new Date(shown.endsAt).getTime() - start.getTime()) / 60000);
  const color = colorOf(categoryColors(categories), shown.category);
  const relative = relativeDay(day, today);
  const look = resultLook[shown.result];
  const ended = isEndedResult(shown.result);
  return (
    <div aria-labelledby="interview-details-title" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => {
        // Escape in a window opened from the card (Edit) closes that window, not the card.
        if (event.key === "Escape" && (event.target as HTMLElement).closest("[role='dialog']") === event.currentTarget) onClose();
      }} role="dialog">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-1.5 size-3.5 shrink-0 rounded" style={{ backgroundColor: color.background }} />
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold text-slate-900" id="interview-details-title">
              {shown.company} · {stepLabel(shown.step)}
              {/* The result as a small coloured badge beside the title. */}
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" role="status" style={{ backgroundColor: look.background, color: look.text }}>
                <span aria-hidden="true">{look.symbol}</span> {resultLabel(shown.result)}
              </span>
            </h2>
            {/* Only a round that ended gets a one-line hint: the company may still offer a new date. */}
            {ended && <p className="mt-0.5 text-xs text-slate-500">{look.hint}</p>}
          </div>
          <CopyInterviewButton record={shown} />
          <button aria-label="Close" autoFocus className="flex size-8 items-center justify-center rounded-lg hover:bg-slate-100" onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
        {/* When: a calendar tile in the category's colour, then the time large, the second zone, and how far away it is. */}
        <section aria-label="When" className="mt-3 flex items-stretch gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg py-1.5 shadow-sm" style={{ backgroundColor: color.background, color: color.text }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{monthNames[Number(day.slice(5, 7)) - 1]}</span>
            <span className="text-2xl font-bold leading-none tabular-nums">{Number(day.slice(8))}</span>
            <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider opacity-90">{weekdayNames[weekdayOf(day)]}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{fullWeekdayNames[weekdayOf(day)]}, {Number(day.slice(8))} {monthNames[Number(day.slice(5, 7)) - 1]} {day.slice(0, 4)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${relative.tone}`}>{relative.text}</span>
            </div>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className={`text-2xl font-bold tabular-nums text-slate-900 ${ended ? "line-through decoration-2 opacity-60" : ""}`}>{timeRange(shown, zone).replace("–", " – ")}</span>
              <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{zoneShortName(zone, start)}</span>
              <span className="text-xs text-slate-500">{minutes} min</span>
            </p>
            {second && (
              <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                {timeRange(shown, second).replace("–", " – ")} <span className="font-semibold">{zoneShortName(second, start)}</span>
                {zonedDay(start, second) !== day && ` · ${zonedDay(start, second)}`}
              </p>
            )}
            {/* Today's rounds only: the countdown to the start, then its progress. */}
            {day === today && !ended && <InterviewCountdown className="mt-2" endsAt={shown.endsAt} startsAt={shown.startsAt} />}
          </div>
        </section>
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
        {/* One line: Join, result, next step or new date, then Edit and Delete apart at the end. No Join once the round has ended. */}
        <div className="mt-4 overflow-x-auto border-t border-slate-100 pt-4">
          <InterviewRowActions
            inline
            key={shown.id}
            lead={shown.meetingLink && !ended && new Date(shown.endsAt) > new Date() ? (
              <a className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700" href={shown.meetingLink} rel="noreferrer" target="_blank">
                <Video aria-hidden="true" className="size-3.5" /> Join
              </a>
            ) : null}
            onDone={onClose}
            record={shown}
          />
        </div>
      </div>
    </div>
  );
}

/** A step's cell in the By job table: its latest round's mark and day; clicking opens the round. */
export function TrackStepCell({ round, count, skipped = false }: { round: InterviewRecord | null; count: number; skipped?: boolean }) {
  const { settings } = useInterviewChoices();
  const [open, setOpen] = useState(false);
  if (!round) return skipped ? <span className="text-[11px] italic text-slate-400" title="The company went to a later step">Skipped</span> : <span className="text-slate-300">–</span>;
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
