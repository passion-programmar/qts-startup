"use client";

import { ChevronDown } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useNow, utcOffsetMinutes, ZoneClock } from "@/app/components/zone-clock";

// `place` heads the clock; `name` is what the zone list shows. Zones with daylight saving time list
// their standard and summer abbreviations, and the clock shows whichever is in effect.
type ClockZone = { timeZone: string; place: string; name: string; codes: [string] | [string, string] };

const zoneGroups: { label: string; zones: ClockZone[] }[] = [
  {
    label: "Asia & Pacific",
    zones: [
      { timeZone: "Asia/Shanghai", place: "China", name: "China (Beijing, Shanghai)", codes: ["CST"] },
      { timeZone: "Asia/Singapore", place: "Singapore", name: "Singapore", codes: ["SGT"] },
      { timeZone: "Asia/Kolkata", place: "India", name: "India (New Delhi, Mumbai)", codes: ["IST"] },
      { timeZone: "Asia/Dubai", place: "Dubai", name: "UAE (Dubai)", codes: ["GST"] },
      { timeZone: "Australia/Sydney", place: "Sydney", name: "Australia (Sydney)", codes: ["AEST", "AEDT"] },
    ],
  },
  {
    label: "Europe",
    zones: [
      { timeZone: "Europe/Bucharest", place: "Romania", name: "Romania (Bucharest)", codes: ["EET", "EEST"] },
      { timeZone: "Europe/Paris", place: "Central EU", name: "Central Europe (Berlin, Paris, Rome)", codes: ["CET", "CEST"] },
      { timeZone: "Europe/London", place: "London", name: "United Kingdom (London)", codes: ["GMT", "BST"] },
      { timeZone: "Europe/Moscow", place: "Moscow", name: "Russia (Moscow)", codes: ["MSK"] },
    ],
  },
  {
    label: "Americas",
    zones: [
      { timeZone: "America/New_York", place: "New York", name: "US Eastern (New York)", codes: ["EST", "EDT"] },
      { timeZone: "America/Chicago", place: "Chicago", name: "US Central (Chicago)", codes: ["CST", "CDT"] },
      { timeZone: "America/Denver", place: "Denver", name: "US Mountain (Denver)", codes: ["MST", "MDT"] },
      { timeZone: "America/Los_Angeles", place: "Los Angeles", name: "US Pacific (Los Angeles)", codes: ["PST", "PDT"] },
    ],
  },
  {
    label: "Universal",
    zones: [{ timeZone: "UTC", place: "UTC", name: "Coordinated Universal Time", codes: ["UTC"] }],
  },
];

const zonesByTimeZone = new Map(zoneGroups.flatMap((group) => group.zones.map((zone) => [zone.timeZone, zone])));

// The first clock starts on US Pacific time, the zone job times use, and the second on Romania time.
const defaultZones = ["America/Los_Angeles", "Europe/Bucharest"];

// Each clock's chosen zone is remembered in this browser; the header and in-page copies share it.
const storageKey = (slot: number) => `qts-clock-zone-${slot}`;
const unsavedChoices = new Map<number, string>();
const choiceListeners = new Set<() => void>();

function subscribeToChoices(onChange: () => void) {
  choiceListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    choiceListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function chosenZone(slot: number) {
  let choice: string | null | undefined;
  try {
    choice = localStorage.getItem(storageKey(slot));
  } catch {
    // Storage can be blocked (e.g. private windows); the choice then lasts until the page reloads.
    choice = unsavedChoices.get(slot);
  }
  return choice && zonesByTimeZone.has(choice) ? choice : defaultZones[slot];
}

function chooseZone(slot: number, timeZone: string) {
  unsavedChoices.set(slot, timeZone);
  try {
    localStorage.setItem(storageKey(slot), timeZone);
  } catch {}
  choiceListeners.forEach((listener) => listener());
}

// "EST" in winter and "EDT" in summer: summer is when the offset is above the year's lower one.
function currentCode(zone: ClockZone, now: Date | null) {
  const [standard, summer] = zone.codes;
  if (!summer || !now) return standard;
  const year = now.getUTCFullYear();
  const january = utcOffsetMinutes(zone.timeZone, new Date(Date.UTC(year, 0, 1)));
  const july = utcOffsetMinutes(zone.timeZone, new Date(Date.UTC(year, 6, 1)));
  return utcOffsetMinutes(zone.timeZone, now) > Math.min(january, july) ? summer : standard;
}

// The zone's abbreviation as a button at the clock's right; it opens the full list of zones.
function ZonePicker({ slot, zone }: { slot: number; zone: ClockZone }) {
  const now = useNow();
  return (
    <label
      className="relative flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold tracking-wide text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200"
      title="Change time zone"
    >
      {currentCode(zone, now)}
      <ChevronDown aria-hidden="true" className="size-3.5" />
      <select
        aria-label={`Time zone of clock ${slot + 1}`}
        className="absolute inset-0 cursor-pointer bg-white text-sm text-slate-900 opacity-0"
        onChange={(event) => chooseZone(slot, event.target.value)}
        value={zone.timeZone}
      >
        {zoneGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.zones.map((option) => (
              <option key={option.timeZone} value={option.timeZone}>
                {option.codes.join("/")} — {option.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function SelectableClock({ slot, compact, className }: { slot: number; compact: boolean; className: string }) {
  const timeZone = useSyncExternalStore(subscribeToChoices, () => chosenZone(slot), () => defaultZones[slot]);
  const zone = zonesByTimeZone.get(timeZone)!;
  return (
    <ZoneClock
      aside={<ZonePicker slot={slot} zone={zone} />}
      className={className}
      compact={compact}
      label={zone.place}
      timeZone={zone.timeZone}
      zoneName="shortOffset"
    />
  );
}

const clockPair = (compact: boolean, className: string) =>
  [0, 1].map((slot) => <SelectableClock className={className} compact={compact} key={slot} slot={slot} />);

// Two clocks, US Pacific and Romania time unless changed, shown on every manager and admin page. The compact
// pair sits in the workspace header on wide screens. Elsewhere phones stack compact clocks and wider
// screens put the full-size pair side by side.
export function WorkspaceClocks({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  if (compact) return <div className={`flex gap-2 ${className}`}>{clockPair(true, "w-64")}</div>;
  return (
    <div className={`w-full sm:w-auto ${className}`}>
      <div className="grid gap-2 sm:hidden">{clockPair(true, "w-full")}</div>
      <div className="hidden gap-3 sm:flex">{clockPair(false, "w-64")}</div>
    </div>
  );
}
