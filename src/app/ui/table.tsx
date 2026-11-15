import type { ComponentProps } from "react";
import { cn } from "@/app/ui/cn";

/**
 * Table parts with the shared look: a rounded frame that scrolls sideways when the table is wider
 * than the screen, a quiet header row, and row hover. Searching and paging stay with the page.
 */
export function TableFrame({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0 overflow-x-auto rounded-card border border-line bg-card shadow-sm", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-left text-[13px] text-fg-soft", className)} {...props} />;
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-subtle text-[11px] font-semibold uppercase tracking-wider text-fg-muted", className)} {...props} />;
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("whitespace-nowrap border-b border-line px-4 py-3 font-semibold", className)} scope="col" {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line-soft", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-subtle", className)} {...props} />;
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-top", className)} {...props} />;
}

/** A heading row that starts a group inside a table (e.g. a category). */
export function TGroupRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr className="bg-subtle">
      <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted" colSpan={colSpan} scope="colgroup">
        {children}
      </th>
    </tr>
  );
}
