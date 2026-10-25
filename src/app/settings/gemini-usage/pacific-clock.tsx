"use client";

import { useSyncExternalStore } from "react";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const zoneFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

function subscribeToSeconds(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}

// The current second; stable within a second, as useSyncExternalStore requires.
const currentSecond = () => Math.floor(Date.now() / 1000);

// The current Pacific time, so request times in the tables can be compared at a glance.
export function PacificClock() {
  // The server snapshot is empty, so the server's time never mismatches the browser's first paint.
  const second = useSyncExternalStore(subscribeToSeconds, currentSecond, () => null);
  const now = second === null ? null : new Date(second * 1000);
  const zone = now ? zoneFormat.formatToParts(now).find((part) => part.type === "timeZoneName")?.value : "";

  return (
    <div
      aria-label="Current Pacific time"
      aria-live="off"
      className="flex shrink-0 flex-col justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm sm:w-52"
      role="timer"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Pacific time {zone ? `· ${zone}` : ""}
      </span>
      <span className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
        {now ? timeFormat.format(now) : "—"}
      </span>
      <span className="text-xs text-slate-500">{now ? dateFormat.format(now) : " "}</span>
    </div>
  );
}
