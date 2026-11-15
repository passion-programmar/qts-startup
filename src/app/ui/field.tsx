import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/app/ui/cn";

const control =
  "w-full min-w-0 rounded-control border border-line bg-card px-3 text-sm text-fg shadow-sm transition-colors " +
  "placeholder:text-fg-faint hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary-soft " +
  "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-muted aria-invalid:border-danger aria-invalid:ring-danger-soft";

/**
 * A label, the control, then a hint or an error. Pass the control's id as htmlFor. With an error the
 * hint is replaced, and the control should get aria-invalid so it turns red.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label className="block text-xs font-semibold text-fg-soft" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs leading-5 text-danger-text" id={`${htmlFor}-error`} role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-5 text-fg-muted" id={`${htmlFor}-hint`}>{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "py-2 leading-6", className)} rows={rows} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-10 cursor-pointer pr-8", className)} {...props}>
      {children}
    </select>
  );
}
