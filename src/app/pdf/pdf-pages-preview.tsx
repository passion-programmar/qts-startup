"use client";

import { useEffect, useRef, useState } from "react";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsPromise: Promise<PdfJs> | null = null;

// pdf.js parses on the page itself instead of in a separate worker file: a résumé is one or two
// pages, and this avoids serving a worker script that must match the library version.
function loadPdfJs(): Promise<PdfJs> {
  pdfJsPromise ??= (async () => {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })().catch((error: unknown) => {
    pdfJsPromise = null;
    throw error;
  });
  return pdfJsPromise;
}

/**
 * Draws every page of a PDF scaled to exactly the container's width, keeping each page's
 * proportions, one under another like a PDF viewer. The pages are the printed file itself, so
 * page breaks, margins, and line breaks are what the download contains.
 */
export function PdfPagesPreview({
  pdf,
  label,
  dimmed,
}: {
  pdf: Uint8Array;
  label: string;
  dimmed: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [failure, setFailure] = useState<{ pdf: Uint8Array; message: string } | null>(null);

  // Redraw at the new width after resizing settles; in between, the drawn pages simply scale.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer = 0;
    const observer = new ResizeObserver(([entry]) => {
      window.clearTimeout(timer);
      const next = Math.floor(entry.contentRect.width);
      timer = window.setTimeout(() => setWidth(next), 120);
    });
    observer.observe(container);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const pagesHost = pagesRef.current;
    if (!pagesHost || width <= 0) return;
    let cancelled = false;
    (async () => {
      const pdfjs = await loadPdfJs();
      // pdf.js takes ownership of the bytes it is given, so pass a copy.
      const pdfDocument = await pdfjs.getDocument({ data: pdf.slice(), isEvalSupported: false }).promise;
      try {
        const pages: HTMLElement[] = [];
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber);
          const scale = width / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: scale * pixelRatio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "block h-auto w-full";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${label}, page ${pageNumber} of ${pdfDocument.numPages}`);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("This browser cannot draw the PDF preview.");
          await page.render({ canvasContext: context, viewport }).promise;
          if (cancelled) return;
          const sheet = document.createElement("div");
          sheet.className = "overflow-hidden bg-white shadow-md ring-1 ring-slate-900/10";
          sheet.append(canvas);
          pages.push(sheet);
        }
        if (!cancelled) pagesHost.replaceChildren(...pages);
      } finally {
        void pdfDocument.destroy();
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      setFailure({ pdf, message: error instanceof Error ? error.message : "The PDF preview could not be drawn." });
    });
    return () => {
      cancelled = true;
    };
  }, [label, pdf, width]);

  return (
    <div className="min-w-0" ref={containerRef}>
      {failure?.pdf === pdf && (
        <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{failure.message}</p>
      )}
      <div
        className={`flex flex-col gap-4 transition-opacity ${dimmed ? "opacity-60" : "opacity-100"}`}
        ref={pagesRef}
      />
    </div>
  );
}
