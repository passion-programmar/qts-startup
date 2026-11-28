import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/**
 * The title block a page starts with: optional back link, title and actions. No explanation line
 * under the title (2026-11-28: the user found them unneeded on every page).
 */
export function PageHeader({
  title,
  back,
  actions,
}: {
  title: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {back ? (
        <Link className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg" href={back.href}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 text-2xl font-bold tracking-tight text-fg sm:text-[28px] sm:leading-9">{title}</h1>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
