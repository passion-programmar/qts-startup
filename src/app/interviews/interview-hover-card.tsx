"use client";

// The card shown in the middle of the screen while the pointer is on a calendar round or on the card (or the round has focus):
// the round's details at a glance, in the round's category colour. Clicking still opens the full card.
import { Check, Clock, Copy, Mic, MessageSquare, Phone, Tag, User } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CategoryColor } from "@/app/interviews/category-colors";
import { useInterviewChoices } from "@/app/interviews/interview-context";
import type { InterviewRecord } from "@/app/interviews/interview-dialog";
import { resultClasses, resultLabel, stepClasses, stepLabel } from "@/server/interviews/interview-values";
import { timeRange, weekdayOf, zonedDay, zonedTime12, zoneShortName } from "@/server/interviews/zone-time";

export type Hovered = { record: InterviewRecord; rect: DOMRect };

const CARD_WIDTH = 320;
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

export function InterviewHoverCard({ hovered, color, onEnter, onLeave }: { hovered: Hovered; color: CategoryColor; onEnter?: () => void; onLeave?: () => void }) {
  const { settings } = useInterviewChoices();
  const { record } = hovered;
  const zone = settings.timeZone;
  const second = settings.secondTimeZone;
  const start = new Date(record.startsAt);
  const minutes = Math.round((new Date(record.endsAt).getTime() - start.getTime()) / 60000);

  return (
    <div
      // In the middle of the screen, kept inside it on small screens.
      className="fixed left-1/2 top-1/2 z-[80] max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role="dialog"
      aria-label={`${record.company} · ${stepLabel(record.step)}`}
      style={{ width: CARD_WIDTH }}
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
          {/* The time in bold, so it is the first thing read. */}
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-base font-bold tabular-nums text-slate-900">{timeRange(record, zone).replace("–", " – ")}</span>
            <span className="text-xs font-semibold text-slate-600">{zoneShortName(zone, start)} · {minutes} min</span>
          </span>
          {second && <span className="block text-xs tabular-nums text-slate-500">{timeRange(record, second).replace("–", " – ")} {zoneShortName(second, start)}</span>}
        </Row>
        <Row icon={<User className="size-4" />} label="Account">{record.candidateName}</Row>
        <Row icon={<Phone className="size-4" />} label="Caller">
          {record.callerName ? <>{record.callerName}{record.callerLabel && <span className="text-slate-500"> · {record.callerLabel}</span>}</> : <span className="font-bold text-amber-600" title="No caller chosen yet">??</span>}
        </Row>
        {record.interviewer && <Row icon={<Mic className="size-4" />} label="Interviewer">{record.interviewer}</Row>}
        {record.comment && <Row icon={<MessageSquare className="size-4" />} label="Comment"><span className="line-clamp-3 whitespace-pre-line">{record.comment}</span></Row>}
        {!record.comment && !record.interviewer && <Row icon={<Tag className="size-4" />} label="Applied">{zonedDay(new Date(record.appliedAt), zone)}</Row>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2">
        <span className="text-[11px] text-slate-500">Click the round for details</span>
        <CopyInterviewButton record={record} />
      </div>
    </div>
  );
}

/** "02:20 PM" for "14:20": the hour with two digits, as the copied line writes it. */
function paddedTime(moment: Date, zone: string): string {
  return zonedTime12(moment, zone).padStart(8, "0");
}

/**
 * The round as one line to paste into a chat:
 * "02:20 PM – 02:40 PM CET - @Shayan - Job title - Interviewer - Intro". "??" when no caller is chosen.
 */
export function interviewCopyText(record: InterviewRecord, zone: string): string {
  const start = new Date(record.startsAt);
  const time = `${paddedTime(start, zone)} – ${paddedTime(new Date(record.endsAt), zone)} ${zoneShortName(zone, start)}`;
  return [time, `@${record.callerName ?? "??"}`, record.jobTitle, record.interviewer || "—", stepLabel(record.step)].join(" - ");
}

/** A rectangle "Copy" button that copies the round's line and says "Copied" for a moment. */
export function CopyInterviewButton({ record, className = "" }: { record: InterviewRecord; className?: string }) {
  const { settings } = useInterviewChoices();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const text = interviewCopyText(record, settings.timeZone);
  async function copy(event: React.MouseEvent) {
    event.stopPropagation();
    let done = false;
    try { await navigator.clipboard.writeText(text); done = true; } catch { done = false; }
    setCopied(done ? "yes" : "no");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  }
  return (
    <button
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold ${copied === "yes" ? "border-emerald-600 bg-emerald-600 text-white" : "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"} ${className}`}
      onClick={copy}
      title={text}
      type="button"
    >
      {copied === "yes" ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
      {copied === "yes" ? "Copied" : copied === "no" ? "Copy failed" : "Copy"}
    </button>
  );
}
