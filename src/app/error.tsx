"use client";

import { AlertTriangle, LayoutDashboard, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/app/ui/card";

// A page that could not load shows this inside the workspace (the sidebar and top bar stay), with
// Try again, instead of the error screen. The technical details go to the console only: a database
// error can quote its SQL, which is not for a Manager's screen.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    console.error("[QTS] The page could not load:", error);
  }, [error]);
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest || "") : "";

  return (
    <main className="mx-auto max-w-xl py-10">
      <Card className="space-y-5 text-center" role="alert">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
          <AlertTriangle aria-hidden="true" className="size-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-fg">This page couldn&apos;t load</h1>
          <p className="text-sm text-fg-muted">
            QTS could not read its data just now. This is usually brief: try again in a moment.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              retry();
              setTimeout(() => setRetrying(false), 1500);
            }}
            type="button"
          >
            <RotateCcw aria-hidden="true" className={`size-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Trying again…" : "Try again"}
          </button>
          <Link className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-fg hover:bg-line-soft" href="/">
            <LayoutDashboard aria-hidden="true" className="size-4" />
            Go to Overview
          </Link>
        </div>
        {digest ? <p className="text-xs text-fg-muted">Reference: {digest}</p> : null}
      </Card>
    </main>
  );
}
