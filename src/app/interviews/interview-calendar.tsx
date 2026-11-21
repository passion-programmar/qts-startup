"use client";

// The Interviews calendar, like Google Calendar: Day and Week show a 24-hour grid with each round as a
// block at its time (rounds at the same time sit side by side) and a red line at the current time;
// Month shows each day's rounds as short lines. Clicking a round opens its details. Times are in the
// Manager's zone, with the optional second zone beside the hours.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import { DetailsCard } from "@/app/interviews/interview-details";
import { InterviewHoverCard, type Hovered } from "@/app/interviews/interview-hover-card";
import type { InterviewRecord } from "@/app/interviews/interview-dialog";
import { categoryColors, colorOf, type CategoryColor } from "@/app/interviews/category-colors";
import { isEndedResult, resultLabel, resultLook, stepLabel } from "@/server/interviews/interview-values";
import { interviewsHref, type InterviewsQuery } from "@/server/interviews/interviews-query";
import { weekdayOf, zonedDay, zonedMoment, zonedTime, zonedTime12, zoneShortName } from "@/server/interviews/zone-time";

const HOUR_HEIGHT = 48;
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Colors = Map<string, CategoryColor>;
type HoverHandler = (record: InterviewRecord | null, element?: HTMLElement) => void;

/** Pointer and keyboard focus show a round's hover card; leaving hides it. */
function hoverProps(record: InterviewRecord, onHover: HoverHandler) {
  return {
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => onHover(record, event.currentTarget),
    onMouseLeave: () => onHover(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) => onHover(record, event.currentTarget),
    onBlur: () => onHover(null),
  };
}

/** What a round shows in the calendar: caller - step - job title - company - account. */
function roundLine(record: InterviewRecord): string {
  return [record.callerName ?? "No caller", stepLabel(record.step), record.jobTitle, record.company, record.candidateName].join(" - ");
}

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
  const { settings, categories } = useInterviewChoices();
  // Each round is coloured by its category (AI/ML red, DevOps blue, the others their own colour).
  const colors = useMemo(() => categoryColors(categories), [categories]);
  const [selected, setSelected] = useState<InterviewRecord | null>(null);
  // A round shown in the details card follows its newest version after a save.
  const shown = selected ? records.find((record) => record.id === selected.id) ?? null : null;
  // The round under the pointer (or focused), for its hover card; gone once a round is opened.
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const hover: HoverHandler = (record, element) => setHovered(record && element ? { record, rect: element.getBoundingClientRect() } : null);
  const open = (record: InterviewRecord) => { setHovered(null); setSelected(record); };

  return (
    <>
      <CategoryKey colors={colors} records={records} />
      {mode === "month"
        ? <MonthGrid colors={colors} days={days} month={month} onHover={hover} onOpen={open} query={query} records={records} zone={settings.timeZone} />
        : <TimeGrid colors={colors} days={days} onHover={hover} onOpen={open} query={query} records={records} />}
      {hovered && !selected && <InterviewHoverCard color={colorOf(colors, hovered.record.category)} hovered={hovered} key={hovered.record.id} />}
      {selected && <DetailsCard onClose={() => setSelected(null)} record={shown ?? selected} />}
    </>
  );
}

/** The colour of each category shown in the calendar, so a block's colour can be read at a glance. */
function CategoryKey({ colors, records }: { colors: Colors; records: InterviewRecord[] }) {
  const shown = [...new Set(records.map((record) => record.category ?? ""))].sort((a, b) => a.localeCompare(b));
  if (!shown.length) return null;
  return (
    <ul aria-label="Category colours" className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {shown.map((name) => (
        <li className="flex items-center gap-1.5" key={name || "none"}>
          <span aria-hidden="true" className="size-3 rounded-sm" style={{ backgroundColor: colorOf(colors, name || null).background }} />
          {name || "No category"}
        </li>
      ))}
    </ul>
  );
}

function TimeGrid({ colors, days, records, onHover, onOpen, query }: { colors: Colors; days: string[]; records: InterviewRecord[]; onHover: HoverHandler; onOpen: (record: InterviewRecord) => void; query: InterviewsQuery }) {
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
        <div className="max-h-[70vh] overflow-y-auto" onScroll={() => onHover(null)} ref={scrollRef}>
          <div className="relative grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_HEIGHT }}>
            {second && (
              <div className="relative">
                {hours.map((hour) => hour > 0 && (
                  <span className="absolute right-1.5 -translate-y-1/2 text-[10px] text-slate-400" key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                    {zonedTime12(zonedMoment(days[0] ?? today, `${String(hour).padStart(2, "0")}:00`, zone), second).replace(":00 ", " ")}
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              {hours.map((hour) => hour > 0 && (
                <span className="absolute right-1.5 -translate-y-1/2 text-[10px] text-slate-500" key={hour} style={{ top: hour * HOUR_HEIGHT }}>
 {hour < 12 ? "AM" : "PM"}
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
                  const crossedOut = isEndedResult(entry.record.result);
                  const color = colorOf(colors, entry.record.category);
                  return (
                    <button
                      className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm ring-1 ring-black/20 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-indigo-300`}
                      key={entry.record.id}
                      onClick={() => onOpen(entry.record)}
                      style={{ ...blockLook(color, entry.record.result), top: entry.top, height: entry.height, left: `calc(${(entry.lane / entry.lanes) * 100}% + 2px)`, width: `calc(${100 / entry.lanes}% - 4px)` }}
                      {...hoverProps(entry.record, onHover)}
                      type="button"
                    >
                      {/* As many whole lines as the block has room for, the last one ending in "…". */}
                      <span
                        className={`break-words font-semibold ${crossedOut ? "line-through" : ""}`}
                        style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: Math.max(1, Math.floor((entry.height - 4) / 14)), overflow: "hidden" }}
                      >
                        <ResultTag result={entry.record.result} />{roundLine(entry.record)}
                      </span>
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

function MonthGrid({ colors, days, month, records, zone, onHover, onOpen, query }: { colors: Colors; onHover: HoverHandler; days: string[]; month: string; records: InterviewRecord[]; zone: string; onOpen: (record: InterviewRecord) => void; query: InterviewsQuery }) {
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
                  <button className="flex w-full items-center gap-1.5 truncate rounded px-1 py-0.5 text-left text-[11px] font-medium hover:brightness-110" key={record.id} onClick={() => onOpen(record)} style={blockLook(colorOf(colors, record.category), record.result)} {...hoverProps(record, onHover)} type="button">
                    <ResultTag result={record.result} /><span className="whitespace-nowrap tabular-nums opacity-90">{zonedTime12(new Date(record.startsAt), zone)}</span>
                    <span className="truncate font-medium">{roundLine(record)}</span>
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

/**
 * A round's block: its category colour, a bar on the left in the result's colour once it has one,
 * and stripes over a round that ended (Rejected, No-show, Cancelled), so the result shows at a glance.
 */
function blockLook(color: CategoryColor, result: InterviewRecord["result"]): React.CSSProperties {
  const look = resultLook[result];
  return {
    backgroundColor: color.background,
    color: color.text,
    ...(result === "waiting" ? {} : { boxShadow: `inset 4px 0 0 ${look.background}` }),
    ...(isEndedResult(result)
      ? { backgroundImage: "repeating-linear-gradient(135deg, rgba(15,23,42,0.45) 0 6px, rgba(15,23,42,0.15) 6px 12px)" }
      : {}),
  };
}

/** The result as a small tag at the start of a round's text; none while Waiting. */
function ResultTag({ result }: { result: InterviewRecord["result"] }) {
  if (result === "waiting") return null;
  const look = resultLook[result];
  return (
    <span className="mr-1 inline-flex items-center gap-0.5 rounded px-1 align-[1px] text-[10px] font-bold uppercase leading-[14px] no-underline" style={{ backgroundColor: look.background, color: look.text, textDecoration: "none" }}>
      {look.symbol} {resultLabel(result)}
    </span>
  );
}
