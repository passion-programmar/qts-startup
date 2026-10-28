"use client";

import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DatePicker } from "@/app/components/date-picker";

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

// Saves the job URLs of one chosen day as a .txt file, one URL per line and none twice.
export function ExportUrlsButton({ entries, fileLabel, today }: { entries: ExportUrlEntry[]; fileLabel: string; today: string }) {
  // The panel is fixed under the button so the table frame (overflow-clip) can't cut it off.
  // A calendar opened near the bottom of the window makes the panel scroll inside itself.
  const [panelPosition, setPanelPosition] = useState<{ top: number; right: number; maxHeight: number } | null>(null);
  const [day, setDay] = useState(today);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const open = panelPosition !== null;
  const urls = day ? uniqueUrlsOn(entries, day) : [];

  useEffect(() => {
    if (!open) return;
    const close = () => setPanelPosition(null);
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // The page scrolling moves the button away from the panel; scrolling inside the panel is fine.
    const closeOnPageScroll = (event: Event) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", closeOnPageScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", closeOnPageScroll, true);
    };
  }, [open]);

  function toggle() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    setPanelPosition(open || !rect ? null : {
      top: rect.bottom + 8,
      right: Math.max(16, window.innerWidth - rect.right),
      maxHeight: window.innerHeight - rect.bottom - 24,
    });
  }

  function download() {
    const blob = new Blob([`${urls.join("\r\n")}\r\n`], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileLabel}-urls_${day}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setPanelPosition(null);
  }

  return (
    <div className="sm:ml-auto" ref={wrapperRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-600"
        onClick={toggle}
        type="button"
      >
        <Download aria-hidden="true" className="size-4" />
        Export URLs
      </button>
      {panelPosition && (
        <div
          aria-label="Export job URLs"
          className="fixed z-50 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
          role="dialog"
          style={panelPosition}
        >
          <p className="text-xs font-semibold text-slate-700">Export job URLs (.txt)</p>
          <p className="mt-0.5 text-[11px] text-slate-500">One URL per line, each job once. Dates are Romania time.</p>
          {/* The same calendar as the birthday field. */}
          <DatePicker className="mt-3" defaultValue={day} id={`${fileLabel}-export-day`} label="Date" name="exportDay" onChange={setDay} required />

          <p className="mt-3 text-xs text-slate-600">
            {day ? `${urls.length} unique URL${urls.length === 1 ? "" : "s"}` : "Choose a date"}
          </p>
          <button
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-xs font-semibold text-white shadow-sm shadow-indigo-500/25 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            disabled={urls.length === 0}
            onClick={download}
            type="button"
          >
            <Download aria-hidden="true" className="size-4" />
            Download .txt
          </button>
        </div>
      )}
    </div>
  );
}
