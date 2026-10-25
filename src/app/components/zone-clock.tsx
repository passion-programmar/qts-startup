"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

type ZoneFormats = {
  time: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  zone: Intl.DateTimeFormat;
  offset: Intl.DateTimeFormat;
};

// Formatters are costly to build, so each time zone's are built once and shared by every clock.
const formatsByZone = new Map<string, ZoneFormats>();

function formatsFor(timeZone: string) {
  let formats = formatsByZone.get(timeZone);
  if (!formats) {
    formats = {
      time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }),
      date: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      weekday: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }),
      zone: new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }),
      offset: new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }),
    };
    formatsByZone.set(timeZone, formats);
  }
  return formats;
}

const zoneNameOf = (format: Intl.DateTimeFormat, date: Date) =>
  format.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";

// The zone's offset from UTC in minutes at that moment, read from e.g. "GMT+5:30".
export function utcOffsetMinutes(timeZone: string, date: Date) {
  const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(zoneNameOf(formatsFor(timeZone).offset, date));
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function subscribeToSeconds(onTick: () => void) {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}

// The current second; stable within a second, as useSyncExternalStore requires.
const currentSecond = () => Math.floor(Date.now() / 1000);

// The current time, updated every second. The server snapshot is empty, so the server's time never
// mismatches the browser's first paint.
export function useNow() {
  const second = useSyncExternalStore(subscribeToSeconds, currentSecond, () => null);
  return second === null ? null : new Date(second * 1000);
}

// A live clock for one time zone, e.g. "Pacific time · PDT" over "5:45:04 AM" and the date.
// The compact form puts the time and the weekday on one line, to fit in the workspace header.
// `zoneName` picks "PDT"-style names or "GMT-7"-style offsets; `aside` sits at the right, centered.
export function ZoneClock({
  label,
  timeZone,
  compact = false,
  zoneName = "short",
  aside,
  className = "",
}: {
  label: string;
  timeZone: string;
  compact?: boolean;
  zoneName?: "short" | "shortOffset";
  aside?: ReactNode;
  className?: string;
}) {
  const now = useNow();
  const formats = formatsFor(timeZone);
  const zone = now ? zoneNameOf(zoneName === "short" ? formats.zone : formats.offset, now) : "";
  const time = now ? formats.time.format(now) : "—";
  const heading = `${label}${zone ? ` · ${zone}` : ""}`;

  return (
    <div
      aria-label={`${label} clock`}
      aria-live="off"
      className={`flex shrink-0 items-center gap-3 border border-slate-200 bg-white shadow-sm ${compact ? "rounded-lg py-1 pl-3 pr-2" : "rounded-xl px-4 py-2.5"} ${className}`}
      role="timer"
      title={now ? formats.date.format(now) : undefined}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-semibold uppercase leading-4 tracking-wider text-slate-500">{heading}</span>
        {compact ? (
          <span className="flex items-baseline gap-2 leading-6">
            <span className="font-mono text-base font-semibold tabular-nums text-slate-900">{time}</span>
            <span className="text-[13px] text-slate-500">{now ? formats.weekday.format(now) : ""}</span>
          </span>
        ) : (
          <>
            <span className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-slate-900">{time}</span>
            <span className="text-sm text-slate-500">{now ? formats.date.format(now) : " "}</span>
          </>
        )}
      </div>
      {aside}
    </div>
  );
}
