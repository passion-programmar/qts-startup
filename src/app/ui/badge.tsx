import type { ReactNode } from "react";
import { cn } from "@/app/ui/cn";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, { box: string; dot: string }> = {
  neutral: { box: "bg-line-soft text-fg-muted ring-line", dot: "bg-slate-400" },
  primary: { box: "bg-primary-soft text-primary-text ring-primary-ring", dot: "bg-primary" },
  success: { box: "bg-success-soft text-success-text ring-success-ring", dot: "bg-success" },
  warning: { box: "bg-warning-soft text-warning-text ring-warning-ring", dot: "bg-warning" },
  danger: { box: "bg-danger-soft text-danger-text ring-danger-ring", dot: "bg-danger" },
};

/** A small status label. "dot" adds a coloured dot before the text. */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
  className,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        tones[tone].box,
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", tones[tone].dot)} /> : null}
      {children}
    </span>
  );
}

/** A number in a pill, for tab and heading counts. */
export function Count({ value, active = false }: { value: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        active ? "bg-white/20 text-white" : "bg-line-soft text-fg-muted",
      )}
    >
      {value}
    </span>
  );
}
