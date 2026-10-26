import { ChevronDown } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

// A folded card for long forms (candidate profile): its title and a one-line summary show, and the
// fields open on click. Folded fields are still sent with the form.
export function FormCard({
  title,
  summary,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  summary?: ReactNode;
  // Buttons shown in the opened card above its fields (e.g. "Add education").
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group/card rounded-xl border border-slate-200 bg-white ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">{title}</span>
          {summary && <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>}
        </span>
        <ChevronDown className="size-5 shrink-0 text-slate-400 transition group-open/card:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-slate-100 px-4 py-4 sm:px-5">
        {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
        {children}
      </div>
    </details>
  );
}

/**
 * For a form's onInvalidCapture: opens the folded card holding a field that needs fixing, so the
 * browser can show its message instead of silently refusing to save.
 */
export function openCardOfInvalidField(event: FormEvent<HTMLFormElement>): void {
  const details = (event.target as HTMLElement).closest("details");
  if (details && !details.open) details.open = true;
}
