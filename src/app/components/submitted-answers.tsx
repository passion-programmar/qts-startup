"use client";

import { ListChecks, X } from "lucide-react";
import { useState } from "react";

export type SubmittedAnswer = { question: string; answer: string; source: string };

const sourceLabels: Record<string, string> = {
  profile: "Profile",
  reusable: "Reusable answer",
  ai: "ChatGPT",
  saved: "Saved answer",
  documents: "Documents",
  consent: "Consent",
  rule: "Rule",
  manager: "Manager",
};
const sourceClasses: Record<string, string> = {
  profile: "bg-blue-50 text-blue-700",
  reusable: "bg-indigo-50 text-indigo-700",
  ai: "bg-violet-50 text-violet-700",
  saved: "bg-sky-50 text-sky-700",
  manager: "bg-amber-50 text-amber-800",
};

// The answers a bid was submitted with, read-only, each with where it came from.
export function SubmittedAnswersButton({ answers, title }: { answers: SubmittedAnswer[]; title: string }) {
  const [open, setOpen] = useState(false);
  if (!answers.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <>
      <button
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        onClick={() => setOpen(true)}
        type="button"
      >
        <ListChecks aria-hidden="true" className="size-3.5" />
        {answers.length}
      </button>
      {open && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4"
          onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
          role="dialog"
        >
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900">Submitted answers</h2>
                <p className="truncate text-xs text-slate-500">{title}</p>
              </div>
              <button aria-label="Close" autoFocus className="flex size-9 items-center justify-center rounded-lg hover:bg-slate-100" onClick={() => setOpen(false)} type="button">
                <X className="size-4" />
              </button>
            </header>
            <ul className="divide-y divide-slate-100 px-5 py-2">
              {answers.map((answer, index) => (
                <li className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:gap-3" key={`${answer.question}-${index}`}>
                  <span className="text-xs font-medium text-slate-700">{answer.question}</span>
                  <span className="whitespace-pre-wrap break-words text-xs text-slate-900">{answer.answer || "—"}</span>
                  <span className={`h-fit w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceClasses[answer.source] ?? "bg-slate-100 text-slate-600"}`}>
                    {sourceLabels[answer.source] ?? answer.source}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
