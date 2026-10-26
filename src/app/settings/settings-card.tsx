import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

// A folded card for the Settings page: its title and a one-line summary show, and the rest opens
// on click. Sections hold item cards (a prompt, a reusable answer); both start folded.
export function SettingsCard({
  title,
  summary,
  children,
  item = false,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  item?: boolean;
}) {
  return item ? (
    <details className="group/item rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-slate-800">{title}</span>
          {summary && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{summary}</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-slate-400 transition group-open/item:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">{children}</div>
    </details>
  ) : (
    <details className="group/section mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">{title}</span>
          {summary && <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>}
        </span>
        <ChevronDown className="size-5 shrink-0 text-slate-400 transition group-open/section:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-5 sm:px-6">{children}</div>
    </details>
  );
}
