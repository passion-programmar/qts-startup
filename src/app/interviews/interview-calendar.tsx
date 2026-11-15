"use client";

// The Interviews calendar, like Google Calendar: Day and Week show a 24-hour grid with each round as a
// block at its time (rounds at the same time sit side by side) and a red line at the current time;
// Month shows each day's rounds as short lines. Clicking a round opens its details. Times are in the
// Manager's zone, with the optional second zone beside the hours.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import { DetailsCard } from "@/app/interviews/interview-details";
import type { InterviewRecord } from "@/app/interviews/interview-dialog";
import { stepLabel, type InterviewStep } from "@/server/interviews/interview-values";
import { interviewsHref, type InterviewsQuery } from "@/server/interviews/interviews-query";
import { timeRange, weekdayOf, zonedDay, zonedMoment, zonedTime, zoneShortName } from "@/server/interviews/zone-time";

const HOUR_HEIGHT = 48;
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const blockClasses: Record<InterviewStep, string> = {
  intro: "bg-slate-600 text-white",
  tech: "bg-blue-600 text-white",
  final: "bg-violet-600 text-white",
  offer: "bg-emerald-600 text-white",
};
const dotClasses: Record<InterviewStep, string> = {
  intro: "bg-slate-500",
  tech: "bg-blue-600",
  final: "bg-violet-600",
  offer: "bg-emerald-600",
};

function minutesOf(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

type Placed = { record: InterviewRecord; top: number; height: number; lane: number; lanes: number };

/** The rounds on one day of the grid, clipped to the day, with side-by-side lanes for overlaps. */
function placeDay(day: string, records: InterviewRecord[], zone: string): Placed[] {
  const pieces = records.flatMap((record) => {
    const start = new Date(record.startsAt);
    const end = new Date(record.endsAt);
    const startDay = zonedDay(start, zone);
    const endDay = zonedDay(end, zone);
    if (startDay > day || endDay < day || (endDay === day && startDay < day && zonedTime(end, zone) === "00:00")) return [];
    const from = startDay === day ? minutesOf(zonedTime(start, zone)) : 0;
    const to = endDay === day ? minutesOf(zonedTime(end, zone)) : 24 * 60;
    if (to <= from) return [];
    return [{ record, from, to }];
  }).sort((a, b) => a.from - b.from || b.to - a.to);

  const placed: Placed[] = [];
  let group: { piece: (typeof pieces)[number]; lane: number }[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((entry) => entry.lane + 1));
    for (const entry of group) {
      placed.push({
        record: entry.piece.record,
        top: (entry.piece.from / 60) * HOUR_HEIGHT,
        height: Math.max(((entry.piece.to - entry.piece.from) / 60) * HOUR_HEIGHT - 2, 18),
        lane: entry.lane,
        lanes,
      });
    }
    group = [];
  };
  for (const piece of pieces) {
    if (group.length && piece.from >= groupEnd) flush();
    const laneEnds: number[] = [];
    for (const entry of group) laneEnds[entry.lane] = Math.max(laneEnds[entry.lane] ?? 0, entry.piece.to);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= piece.from);
    if (lane === -1) lane = laneEnds.length;
    group.push({ piece, lane });
    groupEnd = Math.max(groupEnd, piece.to);
  }
  flush();
  return placed;
}

export function InterviewCalendar({
  mode,
  days,
  month,
  records,
  query,
}: {
  mode: "day" | "week" | "month";
  // Day: one day; Week: seven; Month: the 42 days of the six weeks shown.
  days: string[];
  // Month mode: "YYYY-MM" of the month itself (other days are dimmed).
  month: string;
  records: InterviewRecord[];
  query: InterviewsQuery;
}) {
  const { settings } = useInterviewChoices();
  const [selected, setSelected] = useState<InterviewRecord | null>(null);
  // A round shown in the details card follows its newest version after a save.
  const shown = selected ? records.find((record) => record.id === selected.id) ?? null : null;

  return (
    <>
      {mode === "month"
        ? <MonthGrid days={days} month={month} onOpen={setSelected} query={query} records={records} zone={settings.timeZone} />
        : <TimeGrid days={days} onOpen={setSelected} query={query} records={records} />}
      {selected && <DetailsCard onClose={() => setSelected(null)} record={shown ?? selected} />}
    </>
  );
}

function TimeGrid({ days, records, onOpen, query }: { days: string[]; records: InterviewRecord[]; onOpen: (record: InterviewRecord) => void; query: InterviewsQuery }) {
  const { settings, today } = useInterviewChoices();
  const zone = settings.timeZone;
  const second = settings.secondTimeZone;
  const scrollRef = useRef<HTMLDivElement>(null);
  // The current time is read in the browser only (the server's clock would not match it), every minute.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  const placedByDay = useMemo(() => days.map((day) => placeDay(day, records, zone)), [days, records, zone]);

  // Opens scrolled to the first round (or 7:00), an hour before it, like Google Calendar.
  useEffect(() => {
    const firstMinutes = Math.min(7 * 60, ...placedByDay.flat().map((entry) => (entry.top / HOUR_HEIGHT) * 60));
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (firstMinutes / 60 - 1) * HOUR_HEIGHT);
    // Only when the shown days change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join()]);

  const gutters = second ? 2 : 1;
  const columns = `repeat(${gutters}, 3.5rem) repeat(${days.length}, minmax(0, 1fr))`;
  const nowTop = now && days.includes(zonedDay(now, zone)) ? (minutesOf(zonedTime(now, zone)) / 60) * HOUR_HEIGHT : null;
  const nowDay = now ? zonedDay(now, zone) : "";
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="min-w-[640px] overflow-x-auto">
        <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: columns }}>
          {second && <div className="flex items-end justify-end px-1.5 pb-1 text-[10px] text-slate-400">{zoneShortName(second)}</div>}
          <div className="flex items-end justify-end px-1.5 pb-1 text-[10px] text-slate-500">{zoneShortName(zone)}</div>
          {days.map((day) => {
            const isToday = day === today;
            return (
              <Link className="flex flex-col items-center gap-0.5 border-l border-slate-100 py-2 hover:bg-slate-50" href={interviewsHref(query, { mode: "day", date: day })} key={day} scroll={false}>
                <span className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? "text-blue-600" : "text-slate-500"}`}>{weekdayNames[weekdayOf(day)]}</span>
                <span className={`flex size-10 items-center justify-center rounded-full text-xl ${isToday ? "bg-blue-600 text-white" : "text-slate-800"}`}>{Number(day.slice(8))}</span>
              </Link>
            );
          })}
        </div>
        <div className="max-h-[70vh] overflow-y-auto" ref={scrollRef}>
          <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_HEIGHT }}>
            {second && (
              <div className="relative">
                {hours.map((hour) => hour > 0 && (
                  <span className="absolute right-1.5 -translate-y-1/2 text-[10px] text-slate-400" key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                    {zonedTime(zonedMoment(days[0] ?? today, `${String(hour).padStart(2, "0")}:00`, zone), second)}
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              {hours.map((hour) => hour > 0 && (
                <span className="absolute right-1.5 -translate-y-1/2 text-[10px] text-slate-500" key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {days.map((day, dayIndex) => (
              <div
                className="relative border-l border-slate-100"
                key={day}
                style={{ backgroundImage: "linear-gradient(to bottom, rgba(148,163,184,0.25) 1px, transparent 1px)", backgroundSize: `100% ${HOUR_HEIGHT}px` }}
              >
                {placedByDay[dayIndex]?.map((entry) => {
                  const crossedOut = entry.record.result === "rejected" || entry.record.result === "no_show";
                  return (
                    <button
                      className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm ring-1 ring-white/60 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${blockClasses[entry.record.step]} ${crossedOut ? "opacity-60" : ""}`}
                      key={entry.record.id}
                      onClick={() => onOpen(entry.record)}
                      style={{ top: entry.top, height: entry.height, left: `calc(${(entry.lane / entry.lanes) * 100}% + 2px)`, width: `calc(${100 / entry.lanes}% - 4px)` }}
                      title={`${entry.record.company} · ${stepLabel(entry.record.step)} · ${timeRange(entry.record, zone)}`}
                      type="button"
                    >
                      <span className={`block truncate font-semibold ${crossedOut ? "line-through" : ""}`}>{entry.record.company} · {stepLabel(entry.record.step)}</span>
                      {entry.height >= 30 && <span className="block truncate opacity-90">{timeRange(entry.record, zone)}</span>}
                      {entry.height >= 44 && <span className="block truncate opacity-80">{entry.record.candidateName}</span>}
                    </button>
                  );
                })}
                {nowTop !== null && day === nowDay && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }}>
                    <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full bg-red-500" />
                    <span className="block h-0.5 bg-red-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ days, month, records, zone, onOpen, query }: { days: string[]; month: string; records: InterviewRecord[]; zone: string; onOpen: (record: InterviewRecord) => void; query: InterviewsQuery }) {
  const { today } = useInterviewChoices();
  const byDay = useMemo(() => {
    const map = new Map<string, InterviewRecord[]>();
    for (const record of records) {
      const day = zonedDay(new Date(record.startsAt), zone);
      map.set(day, [...(map.get(day) ?? []), record]);
    }
    return map;
  }, [records, zone]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-200">
        {weekdayNames.map((name) => <div className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500" key={name}>{name}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayRecords = byDay.get(day) ?? [];
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          return (
            <div className={`min-h-28 border-slate-100 p-1 ${index % 7 ? "border-l" : ""} ${index >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-slate-50/60"}`} key={day}>
              <Link
                className={`mx-auto mb-1 flex size-7 items-center justify-center rounded-full text-xs font-medium ${isToday ? "bg-blue-600 text-white" : inMonth ? "text-slate-700 hover:bg-slate-100" : "text-slate-400 hover:bg-slate-100"}`}
                href={interviewsHref(query, { mode: "day", date: day })}
                scroll={false}
              >
                {Number(day.slice(8))}
              </Link>
              <div className="space-y-0.5">
                {dayRecords.slice(0, 3).map((record) => (
                  <button className="flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left text-[11px] text-slate-700 hover:bg-slate-100" key={record.id} onClick={() => onOpen(record)} title={`${record.company} · ${stepLabel(record.step)} · ${timeRange(record, zone)}`} type="button">
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dotClasses[record.step]}`} />
                    <span className="tabular-nums text-slate-500">{zonedTime(new Date(record.startsAt), zone)}</span>
                    <span className="truncate font-medium">{record.company}</span>
                  </button>
                ))}
                {dayRecords.length > 3 && (
                  <Link className="block px-1 text-[11px] font-semibold text-slate-600 hover:underline" href={interviewsHref(query, { mode: "day", date: day })} scroll={false}>
                    {dayRecords.length - 3} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
