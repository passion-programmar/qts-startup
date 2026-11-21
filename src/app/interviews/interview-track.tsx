"use client";

// A job's track: Intro → Tech → Final → Offer, each step with how its latest round went. The rounds
// load when the line is shown; clicking a step opens that round when the parent allows it.
import { Ban, Check, Circle, Redo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadTrackAction } from "@/app/interviews/actions";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import { summarizeTrack, type InterviewRecord } from "@/server/interviews/interview-record";
import { interviewSteps, resultLabel } from "@/server/interviews/interview-values";
import { zonedDay, zonedTime } from "@/server/interviews/zone-time";

const shortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15 Nov" for a day "2026-11-15". */
export function shortDay(day: string): string {
  return `${Number(day.slice(8))} ${shortMonths[Number(day.slice(5, 7)) - 1] ?? ""}`;
}

/** The mark for a round's result: ✓ passed, ✗ rejected or no-show, ⊘ cancelled, ● waiting. */
export function ResultMark({ result, className = "size-3.5" }: { result: InterviewRecord["result"]; className?: string }) {
  if (result === "passed") return <Check aria-hidden="true" className={`${className} text-emerald-600`} strokeWidth={3} />;
  if (result === "cancelled") return <Ban aria-hidden="true" className={`${className} text-orange-500`} strokeWidth={3} />;
  if (result === "rejected" || result === "no_show") return <X aria-hidden="true" className={`${className} text-rose-600`} strokeWidth={3} />;
  return <Circle aria-hidden="true" className={`${className} fill-amber-400 text-amber-400`} />;
}

export function TrackLine({ trackId, currentId, onOpen }: { trackId: string; currentId?: string; onOpen?: (round: InterviewRecord) => void }) {
  const { settings } = useInterviewChoices();
  const [rounds, setRounds] = useState<InterviewRecord[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTrackAction(trackId).then((rows) => { if (!cancelled) setRounds(rows); }).catch(() => { if (!cancelled) setRounds([]); });
    return () => { cancelled = true; };
  }, [trackId, currentId]);

  if (!rounds) return <p className="text-xs text-slate-500">Loading the track…</p>;
  const { byStep } = summarizeTrack(rounds);
  // A step with no round but a later step that has one was skipped (e.g. Intro → Final).
  const lastWithRound = lastStepIndex(byStep);
  return (
    <ol aria-label="Track" className="flex items-start">
      {interviewSteps.map((step, index) => {
        const round = byStep[step.key];
        const current = round?.id === currentId;
        const skipped = !round && index < lastWithRound;
        const content = (
          <>
            <span className={`flex items-center gap-1 text-xs font-semibold ${round ? "text-slate-800" : "text-slate-400"} ${current ? "underline decoration-2 underline-offset-4" : ""}`}>
              {round ? <ResultMark result={round.result} /> : skipped ? <Redo2 aria-hidden="true" className="size-3.5 text-slate-400" /> : <Circle aria-hidden="true" className="size-3.5 text-slate-300" />}
              <span className={skipped ? "line-through decoration-slate-400" : ""}>{step.label}</span>{round && round.count > 1 ? ` ×${round.count}` : ""}
            </span>
            {skipped && <span className="mt-0.5 block text-[10px] italic leading-tight text-slate-400">Skipped</span>}
            {round && (
              <span className="mt-0.5 block text-[10px] leading-tight text-slate-500">
                {resultLabel(round.result)}<br />
                {shortDay(zonedDay(new Date(round.startsAt), settings.timeZone))} {zonedTime(new Date(round.startsAt), settings.timeZone)}
              </span>
            )}
          </>
        );
        return (
          <li className="flex min-w-0 flex-1 items-start" key={step.key}>
            {round && onOpen && !current ? (
              <button className="min-w-0 rounded-md px-1 text-left hover:bg-slate-100" onClick={() => onOpen(round)} title={`Open the ${step.label} round`} type="button">{content}</button>
            ) : (
              <div className="min-w-0 px-1">{content}</div>
            )}
            {index < interviewSteps.length - 1 && <span aria-hidden="true" className={`mx-1 mt-2 h-0.5 flex-1 ${round && round.result === "passed" ? "bg-emerald-300" : "bg-slate-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** The index of the last step that has a round (-1 when none): steps before it without a round were skipped. */
export function lastStepIndex(byStep: Partial<Record<string, unknown>>): number {
  let last = -1;
  interviewSteps.forEach((step, index) => { if (byStep[step.key]) last = index; });
  return last;
}
