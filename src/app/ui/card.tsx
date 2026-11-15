import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/app/ui/cn";

/** A rounded panel. "flush" drops the padding, for a table or list that runs to the edges. */
export function Card({ className, flush = false, ...props }: ComponentProps<"section"> & { flush?: boolean }) {
  return (
    <section
      className={cn("min-w-0 rounded-card border border-line bg-card shadow-sm", !flush && "p-5 sm:p-6", className)}
      {...props}
    />
  );
}

/** A card's title row: optional icon, title, one-line description and actions on the right. */
export function CardHeader({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary-text ring-1 ring-primary-ring [&>svg]:size-4.5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] leading-5 text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A titled block inside a page or a card, separated from the one above by a line. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 border-t border-line-soft pt-5 first:border-t-0 first:pt-0", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-5 text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
