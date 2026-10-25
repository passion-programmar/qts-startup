"use client";

import { useSyncExternalStore } from "react";

type ZoneFormats = { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat; zone: Intl.DateTimeFormat };

// Formatters are costly to build, so each time zone's are built once and shared by every clock.
const formatsByZone = new Map<string, ZoneFormats>();

function formatsFor(timeZone: string) {
  let formats = formatsByZone.get(timeZone);
  if (!formats) {
    formats = {
      time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }),
      date: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      zone: new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }),
    };
    formatsByZone.set(timeZone, formats);
  }
  return formats;
}

function subscribeToSeconds(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}

// The current second; stable within a second, as useSyncExternalStore requires.
const currentSecond = () => Math.floor(Date.now() / 1000);

// A live clock for one time zone, e.g. "Pacific time · PDT" over "5:45:04 AM" and the date.
export function ZoneClock({ label, timeZone, className = "" }: { label: string; timeZone: string; className?: string }) {
  // The server snapshot is empty, so the server's time never mismatches the browser's first paint.
  const second = useSyncExternalStore(subscribeToSeconds, currentSecond, () => null);
  const now = second === null ? null : new Date(second * 1000);
  const formats = formatsFor(timeZone);
  const zone = now ? formats.zone.formatToParts(now).find((part) => part.type === "timeZoneName")?.value : "";

  return (
    <div
      aria-label={`Current ${label}`}
      aria-live="off"
      className={`flex shrink-0 flex-col justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm ${className}`}
      role="timer"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label} {zone ? `· ${zone}` : ""}
      </span>
      <span className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-slate-900">
        {now ? formats.time.format(now) : "—"}
      </span>
      <span className="text-xs text-slate-500">{now ? formats.date.format(now) : " "}</span>
    </div>
  );
}
