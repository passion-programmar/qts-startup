import type { ReactNode } from "react";
import { WorkspaceClocks } from "@/app/components/workspace-clocks";

// The title block every workspace page starts with; actions wrap below the title on narrow screens.
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-600">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px] sm:leading-9">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {/* Hidden when there are no actions and the viewer is not shown the clocks. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 empty:hidden">
        <WorkspaceClocks />
        {actions}
      </div>
    </header>
  );
}
