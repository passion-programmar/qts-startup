"use client";

// Today's rounds: a bar counting down to the start (it fills over the last day), coloured by how
// close it is, then the round's progress while it runs, then Done. Every bar on the page shares one
// clock that ticks every 30 seconds; the time is read in the browser only.
import { useSyncExternalStore } from "react";
import { interviewCountdown, type CountdownPhase } from "@/server/interviews/interview-values";

const TICK = 30_000;
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, TICK);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
  };
}
const nowInBrowser = () => current || (current = Date.now());
// On the server (and while the page wakes up) the time is unknown: an empty bar, no text.
const nowOnServer = () => 0;

const phaseClasses: Record<CountdownPhase, { bar: string; text: string; label: string }> = {
  later: { bar: "bg-slate-400", text: "text-slate-500", label: "More than a day away" },
  day: { bar: "bg-blue-500", text: "text-blue-700", label: "Within a day" },
  hour: { bar: "bg-amber-500", text: "text-amber-700", label: "Within an hour" },
  soon: { bar: "bg-rose-500", text: "text-rose-700", label: "Within 15 minutes" },
  live: { bar: "bg-emerald-500", text: "text-emerald-700", label: "Happening now" },
  done: { bar: "bg-slate-300", text: "text-slate-400", label: "Ended" },
};

export function InterviewCountdown({ startsAt, endsAt, className = "" }: { startsAt: string; endsAt: string; className?: string }) {
  const now = useSyncExternalStore(subscribe, nowInBrowser, nowOnServer);
  const state = now ? interviewCountdown(startsAt, endsAt, now) : null;
  const look = state ? phaseClasses[state.phase] : null;
  return (
    <div className={`w-36 ${className}`} title={look?.label}>
      <div
        aria-label={state ? `${state.text} (${look?.label})` : "Time to the interview"}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={state ? Math.round(state.fill * 100) : undefined}
        className="h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        {state && look && (
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${look.bar} ${state.phase === "live" || state.phase === "soon" ? "animate-pulse" : ""}`}
            // A sliver stays visible even far ahead, so the bar never looks missing.
            style={{ width: `${Math.max(state.fill * 100, state.phase === "done" ? 100 : 3)}%` }}
          />
        )}
      </div>
      <span className={`mt-1 block whitespace-nowrap text-[11px] font-semibold ${look?.text ?? "text-transparent"}`}>{state?.text ?? "…"}</span>
    </div>
  );
}
