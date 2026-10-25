"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { type PdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";

// What the template page reports once the pages are drawn, in its own CSS pixels.
type PagesLayout = {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  gap: number;
  height: number;
};

// One blank A4 page until the first pages are drawn.
const blankPage: PagesLayout = { pageCount: 1, pageWidth: 793.7, pageHeight: 1122.52, gap: 24, height: 1122.52 };

// Edits are drawn this long after the last change, so typing stays smooth.
const drawDelayMs = 80;

/**
 * Shows a document as its printed pages, drawn at once in the browser by the same HTML template
 * the server prints the PDFs with (public/resume-templates, page view). The template page lays
 * the pages out with Chromium's print fragmentation, so they break exactly where the PDF's do.
 * The pages are scaled to the width of the panel.
 */
export function TemplatePagesPreview({
  data,
  documentType,
  hidden,
  label,
  template,
}: {
  data: PdfPackage;
  documentType: "resume" | "cover-letter";
  // A hidden preview keeps drawing, so switching documents shows it at once.
  hidden: boolean;
  label: string;
  template: PdfTemplate;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const requestRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<PagesLayout | null>(null);
  const [warnings, setWarnings] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const shown = layout ?? blankPage;
  const scale = width / shown.pageWidth;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Only the answer to the newest request is shown; the page drops answers to replaced requests.
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
      const message: unknown = event.data;
      if (!isRecord(message) || message.type !== "QTS_RESUME_TEMPLATE_RENDERED") return;
      if (message.requestId !== String(requestRef.current)) return;
      if (message.ok === true && isPagesLayout(message.layout)) {
        setLayout(message.layout);
        setWarnings(typeof message.warnings === "string" ? message.warnings : "");
        setFailure(null);
      } else {
        setFailure(typeof message.error === "string" ? message.error : "The preview could not be drawn.");
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      requestDraw(frameRef.current, requestRef, toResumeTemplateData(data, template), template);
    }, drawDelayMs);
    return () => window.clearTimeout(timer);
  }, [data, template]);

  return (
    <div
      aria-hidden={hidden || undefined}
      className={hidden ? "pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden" : "relative"}
      ref={hostRef}
    >
      {failure && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{failure}</p>}
      {warnings && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{warnings}</p>}
      <div
        aria-label={layout ? `${label}, ${layout.pageCount} ${layout.pageCount === 1 ? "page" : "pages"}` : `${label}, loading`}
        className="theme-light relative"
        role="img"
        style={{ height: shown.height * scale }}
      >
        {Array.from({ length: shown.pageCount }, (_, index) => (
          <div
            className={`absolute inset-x-0 bg-white shadow-md ring-1 ring-slate-900/10 ${layout ? "" : "animate-pulse"}`}
            key={index}
            style={{ top: index * (shown.pageHeight + shown.gap) * scale, height: shown.pageHeight * scale }}
          />
        ))}
        {/* The template page draws the pages at paper size; scaling the frame fits them to the panel. */}
        <iframe
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          onLoad={(event) => {
            if (!requestDraw(event.currentTarget, requestRef, toResumeTemplateData(data, template), template)) {
              setFailure("The template preview could not be loaded. Reload the page to try again.");
            }
          }}
          ref={frameRef}
          src={`/resume-templates/${documentType}.html?embed=1&view=pages`}
          style={{ width: shown.pageWidth, height: shown.height, transform: `scale(${scale})` }}
          tabIndex={-1}
          title={`${label} preview`}
        />
      </div>
    </div>
  );
}

// Sends the document to the template page, or returns false while the page has not loaded its
// renderer yet (its load event sends the document then).
function requestDraw(
  frame: HTMLIFrameElement | null,
  request: RefObject<number>,
  document: unknown,
  template: PdfTemplate,
): boolean {
  let target: Window | null = null;
  try {
    const page = frame?.contentWindow as (Window & { renderResume?: unknown }) | null | undefined;
    if (page && typeof page.renderResume === "function") target = page;
  } catch {
    // A browser error page in the frame is another origin; treat it as not loaded.
  }
  if (!target) return false;
  request.current += 1;
  target.postMessage(
    { type: "QTS_RESUME_TEMPLATE_RENDER", requestId: String(request.current), document, template },
    window.location.origin,
  );
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPagesLayout(value: unknown): value is PagesLayout {
  return isRecord(value)
    && [value.pageCount, value.pageWidth, value.pageHeight, value.gap, value.height].every(
      (number) => typeof number === "number" && Number.isFinite(number) && number >= 0,
    )
    && (value.pageCount as number) >= 1
    && (value.pageWidth as number) > 0;
}
