import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/app/ui/cn";

/** A grey placeholder block shown while data loads. Size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-line-soft", className)} style={style} />;
}

/** Placeholder rows for a table that is loading. */
export function SkeletonRows({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-line-soft" role="status">
      {Array.from({ length: rows }, (_, row) => (
        <div className="flex items-center gap-4 px-4 py-3.5" key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton className={cn("h-3.5", column === 0 ? "w-1/4" : "flex-1")} key={column} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** What a list shows when it has nothing in it, with an optional next step. */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? (
        <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-line-soft text-fg-faint [&>svg]:size-5">{icon}</span>
      ) : null}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-5 text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

const noticeTones = {
  info: { box: "bg-primary-soft text-primary-text ring-primary-ring", Icon: Info },
  success: { box: "bg-success-soft text-success-text ring-success-ring", Icon: CheckCircle2 },
  warning: { box: "bg-warning-soft text-warning-text ring-warning-ring", Icon: AlertTriangle },
  danger: { box: "bg-danger-soft text-danger-text ring-danger-ring", Icon: XCircle },
} as const;

/** A coloured message box: a save result, a warning, or a short explanation. */
export function Notice({ tone = "info", title, children, className }: { tone?: keyof typeof noticeTones; title?: ReactNode; children: ReactNode; className?: string }) {
  const { box, Icon } = noticeTones[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-control px-3.5 py-3 text-xs leading-5 ring-1 ring-inset", box, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
