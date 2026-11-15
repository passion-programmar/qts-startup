"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { urlsAddedOnDayAction } from "@/app/components/export-urls-action";
import { romaniaClock } from "@/lib/romania-time";

/** A URL and its date (YYYY-MM-DD, Romania time) as the table shows it. */
export type ExportUrlEntry = { url: string; date: string };

/** The same job reached by a slightly different link counts once: case, "www.", the #fragment and a trailing slash are ignored. */
function urlKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.host.toLowerCase().replace(/^www\./, "")}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Unique URLs dated on one day, in the order the table lists them. */
export function uniqueUrlsOn(entries: ExportUrlEntry[], day: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of entries) {
    if (entry.date !== day || !entry.url.trim()) continue;
    const key = urlKey(entry.url);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(entry.url.trim());
  }
  return urls;
}

type Outcome = { tone: "done" | "empty" | "error"; text: string };

// One click saves one .txt file with the URLs added today (Romania time) on both the Jobs and Bids
// pages: one URL per line, each once. The same button sits on both pages.
// "Today" is read at the click, so a page left open past midnight exports the new day.
export function ExportUrlsButton() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // The result line hides itself after a few seconds.
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => setOutcome(null), 5000);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  async function exportToday() {
    const day = romaniaClock().day;
    setBusy(true);
    setOutcome(null);
    try {
      const urls = uniqueUrlsOn(await urlsAddedOnDayAction(day), day);
      if (urls.length === 0) {
        setOutcome({ tone: "empty", text: "No job or bid URLs were added today." });
        return;
      }
      const blob = new Blob([`${urls.join("\r\n")}\r\n`], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `jobs-and-bids-urls_${day}.txt`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setOutcome({ tone: "done", text: `Saved ${urls.length} unique URL${urls.length === 1 ? "" : "s"} from Jobs and Bids.` });
    } catch {
      setOutcome({ tone: "error", text: "The URLs could not be loaded. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 sm:ml-auto">
      {outcome ? (
        <span
          className={`text-xs ${outcome.tone === "error" ? "text-danger-text" : outcome.tone === "empty" ? "text-fg-muted" : "text-success-text"}`}
          role={outcome.tone === "error" ? "alert" : "status"}
        >
          {outcome.text}
        </span>
      ) : null}
      <button
        className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-card px-3 text-xs font-semibold text-fg-soft shadow-sm transition-colors hover:border-primary-ring hover:text-primary-text disabled:cursor-wait disabled:opacity-70"
        disabled={busy}
        onClick={exportToday}
        title="Download one .txt file with today's job and bid URLs (Romania time), one per line, each once"
        type="button"
      >
        {busy ? <LoadingIcon className="size-4" /> : <Download aria-hidden="true" className="size-4" />}
        {busy ? "Exporting…" : "Export today's URLs"}
      </button>
    </div>
  );
}
