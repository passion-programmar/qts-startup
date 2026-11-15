import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/app/ui/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "soft" | "ghost";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-55";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-sm hover:bg-primary-hover",
  secondary: "border border-line bg-card text-fg-soft shadow-sm hover:border-slate-300 hover:bg-subtle",
  danger: "bg-danger text-white shadow-sm hover:bg-danger-hover",
  soft: "border border-primary-ring bg-primary-soft text-primary-text hover:border-indigo-300",
  ghost: "text-fg-muted hover:bg-line-soft hover:text-fg",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

// The classes of a button, for the rare element that must look like one but is neither a button nor a link.
export function buttonClass({ variant = "primary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

type Shared = { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

/** A button. While loading it shows a spinner in place of the icon and cannot be pressed. */
export function Button({
  variant,
  size,
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ComponentProps<"button"> & Shared & { loading?: boolean }) {
  return (
    <button
      className={buttonClass({ variant, size, className })}
      disabled={disabled || loading}
      type={type}
      {...props}
      aria-busy={loading || undefined}
    >
      {loading ? <LoaderCircle aria-hidden="true" className={size === "sm" ? "size-3.5 animate-spin" : "size-4 animate-spin"} /> : icon}
      {children}
    </button>
  );
}

/** A link that looks like a button. */
export function LinkButton({ variant, size, icon, className, children, ...props }: ComponentProps<typeof Link> & Shared) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...props}>
      {icon}
      {children}
    </Link>
  );
}
