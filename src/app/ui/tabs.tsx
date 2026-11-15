import Link from "next/link";
import type { ReactNode } from "react";
import { Count } from "@/app/ui/badge";
import { cn } from "@/app/ui/cn";

export type TabItem = { href: string; label: ReactNode; count?: number; active: boolean };

/**
 * Tabs that are page addresses (e.g. ?tab=prompts), so a refresh or a shared link keeps the tab.
 * They scroll sideways on a narrow screen. "trailing" sits at the right end of the row.
 */
export function LinkTabs({ items, label, trailing, className }: { items: TabItem[]; label: string; trailing?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <nav aria-label={label} className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-card border border-line bg-card p-1 shadow-sm">
        {items.map((item) => (
          <Link
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-control px-3 py-1.5 text-sm font-medium transition-colors",
              item.active ? "bg-primary text-white shadow-sm" : "text-fg-muted hover:bg-line-soft hover:text-fg",
            )}
            href={item.href}
            key={item.href}
            scroll={false}
          >
            {item.label}
            {item.count !== undefined ? <Count active={item.active} value={item.count} /> : null}
          </Link>
        ))}
      </nav>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
