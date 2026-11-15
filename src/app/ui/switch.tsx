import type { ComponentProps, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/app/ui/cn";

/**
 * An on/off toggle. Give it onClick to toggle in place, or type="submit" inside a form whose action
 * saves the change. "label" is the text shown beside it; the accessible name comes from aria-label.
 */
export function Switch({
  checked,
  loading = false,
  tone = "primary",
  label,
  className,
  disabled,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "role" | "aria-checked"> & {
  checked: boolean;
  loading?: boolean;
  tone?: "primary" | "success";
  label?: ReactNode;
}) {
  const on = tone === "success" ? "bg-success" : "bg-primary";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <button
        aria-checked={checked}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-55",
          checked ? on : "bg-slate-300 enabled:hover:bg-slate-400",
          loading && "cursor-wait",
        )}
        disabled={disabled || loading}
        role="switch"
        type={type}
        {...props}
      >
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full bg-white shadow transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        >
          {loading ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin text-slate-500" /> : null}
        </span>
      </button>
      {label ? (
        <span className={cn("whitespace-nowrap text-xs font-medium", checked ? "text-fg" : "text-fg-muted")}>{label}</span>
      ) : null}
    </span>
  );
}
