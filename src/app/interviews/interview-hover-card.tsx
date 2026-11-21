"use client";

// The card that floats beside a calendar round while the pointer is on it (or it has keyboard focus):
// the round's details at a glance, in the round's category colour. Clicking still opens the full card.
import { Clock, Mic, MessageSquare, Phone, Tag, User } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CategoryColor } from "@/app/interviews/category-colors";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import type { InterviewRecord } from "@/app/interviews/interview-dialog";
import { resultClasses, resultLabel, stepClasses, stepLabel } from "@/server/interviews/interview-values";
import { timeRange, weekdayOf, zonedDay, zoneShortName } from "@/server/interviews/zone-time";

export type Hovered = { record: InterviewRecord; rect: DOMRect };

const CARD_WIDTH = 320;
const GAP = 10;
const EDGE = 8;
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function readableDay(day: string): string {
  return `${weekdayNames[weekdayOf(day)]}, ${Number(day.slice(8))} ${monthNames[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden="true" className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <div className="break-words text-[13px] text-slate-800">{children}</div>
      </div>
    </div>
  );
}

export function InterviewHoverCard({ hovered, color }: { hovered: Hovered; color: CategoryColor }) {
  const { settings } = useInterviewChoices();
  const ref = useRef<HTMLDivElement>(null);
  const { record, rect } = hovered;
  // Beside the round (right, or left when there is no room), kept inside the window once measured.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const roomRight = window.innerWidth - rect.right - GAP - EDGE >= CARD_WIDTH;
    const left = roomRight ? rect.right + GAP : Math.max(EDGE, rect.left - GAP - CARD_WIDTH);
    const top = Math.min(Math.max(EDGE, rect.top), Math.max(EDGE, window.innerHeight - height - EDGE));
    setPosition({ left, top });
  }, [rect]);

  const zone = settings.timeZone;
  const second = settings.secondTimeZone;
  const start = new Date(record.startsAt);
  const minutes = Math.round((new Date(record.endsAt).getTime() - start.getTime()) / 60000);

  return (
    <div
      className="pointer-events-none fixed z-[80] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition-opacity duration-100"
      ref={ref}
      role="tooltip"
      style={{ width: CARD_WIDTH, left: position?.left ?? -9999, top: position?.top ?? 0, opacity: position ? 1 : 0 }}
    >
      <div className="px-4 pb-3 pt-3.5" style={{ backgroundColor: color.background, color: color.text }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{record.category ?? "No category"}</p>
        <p className="mt-0.5 text-base font-semibold leading-snug">{record.company}</p>
        <p className="text-[13px] leading-snug opacity-90">{record.jobTitle}</p>
      </div>
      <div className="space-y-3 px-4 py-3.5">
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${stepClasses[record.step]}`}>{stepLabel(record.step)}</span>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${resultClasses[record.result]}`}>{resultLabel(record.result)}</span>
        </div>
        <Row icon={<Clock className="size-4" />} label="When">
          <span className="font-medium">{readableDay(zonedDay(start, zone))}</span>
          <span className="block tabular-nums">{timeRange(record, zone)} {zoneShortName(zone, start)} · {minutes} min</span>
          {second && <span className="block text-xs tabular-nums text-slate-500">{timeRange(record, second)} {zoneShortName(second, start)}</span>}
        </Row>
        <Row icon={<User className="size-4" />} label="Account">{record.candidateName}</Row>
        <Row icon={<Phone className="size-4" />} label="Caller">
          {record.callerName ? <>{record.callerName}{record.callerLabel && <span className="text-slate-500"> · {record.callerLabel}</span>}</> : <span className="text-slate-400">No caller</span>}
        </Row>
        {record.interviewer && <Row icon={<Mic className="size-4" />} label="Interviewer">{record.interviewer}</Row>}
        {record.comment && <Row icon={<MessageSquare className="size-4" />} label="Comment"><span className="line-clamp-3 whitespace-pre-line">{record.comment}</span></Row>}
        {!record.comment && !record.interviewer && <Row icon={<Tag className="size-4" />} label="Applied">{zonedDay(new Date(record.appliedAt), zone)}</Row>}
      </div>
      <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">Click for details, edit and result</p>
    </div>
  );
}
