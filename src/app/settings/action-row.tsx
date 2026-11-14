"use client";

import { useState, type ReactNode } from "react";
import { ChevronUp, FolderOpen, History, Pencil, Plus, SlidersHorizontal, type LucideIcon } from "lucide-react";

// Icons are named, not passed, because a server component cannot hand a component to a client one.
const ICONS = {
  create: Plus,
  edit: Pencil,
  versions: History,
  change: SlidersHorizontal,
  open: FolderOpen,
} satisfies Record<string, LucideIcon>;

export type ActionRowAction = {
  id: string;
  label: string;
  icon: keyof typeof ICONS;
  /** The box that opens under the row when this button is clicked. */
  content: ReactNode;
  /** A filled button for the one main action of a row, such as Create new prompt. */
  primary?: boolean;
};

// One line of a Settings tab: what it is on the left, its buttons on the right. Each button opens
// its own box under the line; clicking it again, or Close, folds the box. Only one is open at a time.
export function ActionRow({
  children,
  actions,
  className = "",
}: {
  children: ReactNode;
  actions: ActionRowAction[];
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = actions.find((action) => action.id === openId);

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {actions.map((action) => {
            const active = action.id === openId;
            const Icon = active ? ChevronUp : ICONS[action.icon];
            return (
              <button
                aria-expanded={active}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                  active
                    ? "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200"
                    : action.primary
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25 hover:bg-indigo-700"
                      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
                key={action.id}
                onClick={() => setOpenId(active ? null : action.id)}
                type="button"
              >
                <Icon aria-hidden="true" className="size-3.5" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
      {open && (
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
          {open.content}
          <div className="mt-3 flex justify-end">
            <button
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              onClick={() => setOpenId(null)}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
