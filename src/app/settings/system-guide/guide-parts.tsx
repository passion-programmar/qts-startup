import { ArrowDown, ArrowRight, ArrowLeftRight, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

// Small drawing pieces for the System guide: coloured boxes for the parts of QTS, arrows between
// them (sideways on a wide screen, downwards on a phone) and numbered steps. The colours come from
// the theme's scales, so every box reads in light and dark.

export type Tone = "ext" | "web" | "db" | "ai" | "pc" | "git";

const TONES: Record<Tone, { box: string; title: string }> = {
  ext: { box: "border-violet-300 bg-violet-50", title: "text-violet-800" },
  web: { box: "border-blue-300 bg-blue-50", title: "text-blue-800" },
  db: { box: "border-emerald-300 bg-emerald-50", title: "text-emerald-800" },
  ai: { box: "border-amber-300 bg-amber-50", title: "text-amber-800" },
  pc: { box: "border-slate-300 bg-slate-50", title: "text-slate-800" },
  git: { box: "border-indigo-300 bg-indigo-50", title: "text-indigo-800" },
};

export const TONE_LEGEND: { tone: Tone; label: string }[] = [
  { tone: "ext", label: "Chrome extension" },
  { tone: "web", label: "Website on Vercel" },
  { tone: "db", label: "Database" },
  { tone: "ai", label: "AI services" },
  { tone: "pc", label: "Files on the PC" },
  { tone: "git", label: "Code and builds" },
];

/** One part of the system: a coloured box with a title and a few short lines. */
export function Node({ tone, title, lines, children }: { tone: Tone; title: ReactNode; lines?: ReactNode[]; children?: ReactNode }) {
  return (
    <div className={`min-w-0 rounded-xl border-2 px-3.5 py-3 ${TONES[tone].box}`}>
      <p className={`text-sm font-bold ${TONES[tone].title}`}>{title}</p>
      {lines?.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-5 text-fg-soft">
          {lines.map((line, index) => <li className="break-words" key={index}>{line}</li>)}
        </ul>
      ) : null}
      {children}
    </div>
  );
}

/** An arrow with a label: across on a wide screen, down on a narrow one. both: it goes both ways. */
export function Arrow({ label, both = false, vertical = false }: { label?: ReactNode; both?: boolean; vertical?: boolean }) {
  const Across = both ? ArrowLeftRight : ArrowRight;
  const Down = both ? ArrowUpDown : ArrowDown;
  return (
    <div className={`flex items-center justify-center gap-1.5 text-fg-muted ${vertical ? "flex-row py-1" : "flex-row py-1 lg:flex-col lg:px-1 lg:py-0"}`}>
      {vertical ? <Down aria-hidden="true" className="size-5 shrink-0" /> : (
        <>
          <Down aria-hidden="true" className="size-5 shrink-0 lg:hidden" />
          <Across aria-hidden="true" className="hidden size-5 shrink-0 lg:block" />
        </>
      )}
      {label ? <span className="text-center text-[11px] font-semibold leading-4">{label}</span> : null}
    </div>
  );
}

/** A dashed area that groups boxes (the Manager's PC, the cloud). */
export function Area({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-2xl border-2 border-dashed border-line p-3 ${className}`}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-muted">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      {TONE_LEGEND.map(({ tone, label }) => (
        <span className="inline-flex items-center gap-1.5" key={tone}>
          <span aria-hidden="true" className={`size-3 rounded-sm border-2 ${TONES[tone].box}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

export type FlowStep = { title: ReactNode; text: ReactNode; tone: Tone; where: string };

/** Steps in their real order, numbered, each saying where it happens. */
export function Flow({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => (
        <li className={`relative min-w-0 rounded-xl border-2 py-3 pl-11 pr-3 ${TONES[step.tone].box}`} key={index}>
          <span aria-hidden="true" className="absolute left-3 top-3 flex size-6 items-center justify-center rounded-full bg-card text-xs font-bold text-fg ring-1 ring-line">{index + 1}</span>
          <p className={`text-sm font-bold ${TONES[step.tone].title}`}>{step.title}</p>
          <p className="mt-0.5 text-[12.5px] leading-5 text-fg-soft">{step.text}</p>
          <p className="mt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-fg-muted">{step.where}</p>
        </li>
      ))}
    </ol>
  );
}

/** A numbered checklist step with its commands or notes underneath. */
export function Step({ number, title, children }: { number: number; title: ReactNode; children: ReactNode }) {
  return (
    <li className="relative min-w-0 pl-10">
      <span aria-hidden="true" className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{number}</span>
      <h3 className="pt-0.5 text-sm font-semibold text-fg">{title}</h3>
      <div className="mt-1.5 space-y-2 text-[13px] leading-6 text-fg-soft">{children}</div>
    </li>
  );
}

/** A short warning or tip box. */
export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode }) {
  const style = tone === "danger" ? "border-rose-300 bg-rose-50 text-rose-800" : tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-blue-300 bg-blue-50 text-blue-800";
  return <div className={`rounded-lg border px-3 py-2 text-[12.5px] leading-5 ${style}`}>{children}</div>;
}

/** Inline code. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-line-soft px-1 py-0.5 font-mono text-[12px] text-fg">{children}</code>;
}
