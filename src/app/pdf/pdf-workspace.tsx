"use client";

import html2canvas from "html2canvas";
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PdfPackage } from "@/app/pdf/document-data";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import sampleFull from "@/app/pdf/sample-full.json";
import {
  isPdfTemplate,
  pdfTemplateLabels,
  pdfTemplateValues,
  type PdfTemplate,
} from "@/server/pdf/pdf-templates";

type PreviewDocumentType = "resume" | "cover-letter";
type PreviewStatus = "loading" | "ready" | "error";

type PendingPreview = {
  documentType: PreviewDocumentType;
  resolve: () => void;
  reject: (reason: Error) => void;
  timeoutId: number;
};

type DirectRenderContext = {
  documentType: PreviewDocumentType;
  mount: HTMLElement;
  root: HTMLElement;
  styleRoot: Document["head"];
  scopeStyle: (style: HTMLStyleElement) => void;
};

declare global {
  interface Window {
    QTS_RESUME_DIRECT_RENDER?: boolean;
    RESUME_OPTIONS?: Record<string, unknown>;
    RESUME_TEMPLATES?: unknown[];
    renderResume?: (
      data: ReturnType<typeof toResumeTemplateData>,
      overrides: { template: PdfTemplate },
      context: DirectRenderContext,
    ) => Promise<unknown>;
  }
}

const example = JSON.stringify(sampleFull, null, 2);

const samplePreviewData = parsePdfPackage(example);
let rendererPromise: Promise<void> | null = null;
let baseStylesPromise: Promise<void> | null = null;
const scriptPromises = new Map<string, Promise<void>>();

export function PdfWorkspace({
  managerName,
}: {
  managerName: string;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>("qts-standard");
  const [activeDocument, setActiveDocument] = useState<PreviewDocumentType>("resume");
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("loading");
  const [source, setSource] = useState(example);
  const [parsed, setParsed] = useState<PdfPackage | null>(
    () => tryParsePdfPackage(example),
  );
  const [error, setError] = useState<string | null>(
    () => initialDocumentError(),
  );
  const [busy, setBusy] = useState(false);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const pendingPreviewRef = useRef<PendingPreview | null>(null);
  const activeDocumentRef = useRef<PreviewDocumentType>("resume");
  const sampleSourceSelected = source === example;
  const previewData = parsed ?? samplePreviewData;
  const templateData = useMemo(
    () => toResumeTemplateData(previewData, selectedTemplate),
    [previewData, selectedTemplate],
  );
  const updatePreviewStatus = useCallback(
    (documentType: PreviewDocumentType, status: PreviewStatus) => {
      if (documentType === activeDocumentRef.current) setPreviewStatus(status);
      const pending = pendingPreviewRef.current;
      if (pending?.documentType !== documentType || status === "loading") return;
      window.clearTimeout(pending.timeoutId);
      pendingPreviewRef.current = null;
      if (status === "ready") pending.resolve();
      else pending.reject(new Error(`The ${documentType} document could not be rendered.`));
    },
    [],
  );

  function showDocument(documentType: PreviewDocumentType) {
    activeDocumentRef.current = documentType;
    setActiveDocument(documentType);
    setPreviewStatus("loading");
    setPreviewGeneration((generation) => generation + 1);
  }

  function prepareDocument(documentType: PreviewDocumentType): Promise<void> {
    return new Promise((resolve, reject) => {
      if (pendingPreviewRef.current) {
        reject(new Error("A document preview is already being prepared."));
        return;
      }
      const timeoutId = window.setTimeout(() => {
        pendingPreviewRef.current = null;
        reject(new Error(`The ${documentType} document did not finish rendering.`));
      }, 20_000);
      pendingPreviewRef.current = { documentType, resolve, reject, timeoutId };
      showDocument(documentType);
    });
  }

  function captureDocument(documentType: PreviewDocumentType): Promise<Uint8Array> {
    return prepareDocument(documentType).then(() =>
      renderTemplatePdf(previewHostRef.current, documentType),
    );
  }

  function updateSource(nextSource: string) {
    setSource(nextSource);
    if (!nextSource.trim()) {
      setParsed(null);
      setError(null);
      return;
    }
    try { setParsed(parsePdfPackage(nextSource)); setError(null); } catch (reason) { setParsed(null); setError(reason instanceof Error ? reason.message : "JSON is invalid."); }
  }
  async function downloadPair() {
    const startingDocument = activeDocumentRef.current;
    try {
      if (!parsed) throw new Error("Enter valid résumé and cover-letter JSON before downloading.");
      setBusy(true);
      setError(null);
      const resume = await captureDocument("resume");
      const coverLetter = await captureDocument("cover-letter");
      if (startingDocument !== "cover-letter") {
        await prepareDocument(startingDocument);
      }
      const candidateName = safePathPart(parsed.resume.candidate.fullName);
      const jobTitle = safePathPart(parsed.resume.targetRole);
      const company = safePathPart(parsed.resume.targetCompany ?? parsed.coverLetter.targetCompany);
      const folder = `QTS_Resume/${safePathPart(managerName)}/${candidateName}/${packageTimestamp()}_${jobTitle}_${company}`;
      await requestExtensionDownloads([
        { downloadPath: `${folder}/${candidateName}.pdf`, mimeType: "application/pdf", base64: bytesToBase64(resume) },
        { downloadPath: `${folder}/${candidateName}_Cover_Letter.pdf`, mimeType: "application/pdf", base64: bytesToBase64(coverLetter) },
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The resume and cover letter could not be downloaded.");
    } finally {
      const pending = pendingPreviewRef.current;
      if (pending) {
        window.clearTimeout(pending.timeoutId);
        pendingPreviewRef.current = null;
        pending.reject(new Error("The PDF download was cancelled."));
      }
      if (activeDocumentRef.current !== startingDocument) showDocument(startingDocument);
      setBusy(false);
    }
  }

  return (
    <main className="py-1 xl:flex xl:h-[calc(100dvh-8.5rem)] xl:min-h-[28rem] xl:flex-col">
      <header className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <a
          className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          href="/resume-template"
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-4" />
          Resume
        </a>
        <nav aria-label="Document preview selection" className="flex items-center gap-3">
          <button
            aria-label="Show resume"
            className="inline-flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || activeDocument === "resume"}
            onClick={() => showDocument("resume")}
            type="button"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <span className="min-w-24 text-center text-sm font-semibold text-slate-700" aria-live="polite">
            {activeDocument === "resume" ? "Resume" : "Cover letter"}
          </span>
          <button
            aria-label="Show cover letter"
            className="inline-flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || activeDocument === "cover-letter"}
            onClick={() => showDocument("cover-letter")}
            type="button"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        </nav>
      </header>
      <div className="grid items-start gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(17rem,0.34fr)_minmax(0,0.66fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-24 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
          <div className="space-y-4 p-5">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-template">Resume and cover-letter template
              <select className={inputClass} id="pdf-template" onChange={(event) => {
                if (isPdfTemplate(event.target.value)) setSelectedTemplate(event.target.value);
              }} value={selectedTemplate}>
                {pdfTemplateValues.map((template) => <option key={template} value={template}>{pdfTemplateLabels[template]}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-json">Generated document JSON</label><textarea className="h-[min(36vh,28rem)] min-h-[180px] w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" id="pdf-json" onChange={(event) => updateSource(event.target.value)} spellCheck={false} value={source} />
            {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
            {sampleSourceSelected && <p className="text-xs text-amber-800">Sample template JSON is prefilled for preview. Replace it with your generated resume data before saving files.</p>}
            <p className="text-xs text-slate-500">Download both PDFs using the selected template. Files save under Downloads / QTS_Resume / {managerName} / candidate.</p>
            <div className="mt-4">
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !parsed || previewStatus !== "ready"}
                onClick={() => void downloadPair()}
                type="button"
              >
                <Download className="size-4" />
                {busy ? "Preparing PDFs..." : "Download résumé and cover letter"}
              </button>
            </div>
          </div>
        </section>
        <section className="min-w-0 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:pr-2">
          {!parsed && <p className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Sample preview — enter valid resume JSON to preview your document. The selected template is shown below.</p>}
          <PdfTemplatePreviewFrame
            key={`${activeDocument}-${previewGeneration}`}
            documentData={templateData}
            documentType={activeDocument}
            template={selectedTemplate}
            title={`${activeDocument === "resume" ? "Resume" : "Cover letter"} · ${pdfTemplateLabels[selectedTemplate]}`}
            hostRef={previewHostRef}
            onStatusChange={updatePreviewStatus}
          />
        </section>
      </div>
    </main>
  );
}

function PdfTemplatePreviewFrame({
  documentData,
  documentType,
  template,
  title,
  hostRef,
  onStatusChange,
}: {
  documentData: ReturnType<typeof toResumeTemplateData>;
  documentType: PreviewDocumentType;
  template: PdfTemplate;
  title: string;
  hostRef: RefObject<HTMLDivElement | null>;
  onStatusChange: (documentType: PreviewDocumentType, status: PreviewStatus) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState("");

  useEffect(() => onStatusChange(documentType, status), [documentType, onStatusChange, status]);

  useEffect(() => {
    const previewHost = hostRef.current;
    if (!previewHost) return;
    let cancelled = false;
    setStatus("loading");
    setMessage("");
    setWarnings("");

    async function render(host: HTMLDivElement) {
      const root = host.querySelector<HTMLElement>(".qts-document-host")
        ?? document.createElement("div");
      root.className = "qts-document-host";
      root.classList.add("is-embed");
      root.lang = documentData.theme.language ?? "en";
      root.dir = documentData.theme.direction ?? "ltr";
      const mount = root.querySelector<HTMLElement>("#resume-root")
        ?? document.createElement("main");
      mount.id = "resume-root";
      mount.className = "is-embed";
      root.replaceChildren(mount);
      if (!root.isConnected) host.replaceChildren(root);

      const scopeStyle = (style: HTMLStyleElement) => scopeResumeStyles(style);
      await loadBaseStyles();
      if (cancelled) return;

      await loadResumeRenderer();
      if (cancelled) return;
      const renderer = window.renderResume;
      if (!renderer) throw new Error("The resume document renderer did not initialize.");
      const result = await renderer(
        documentData,
        { template },
        { documentType, mount, root, styleRoot: document.head, scopeStyle },
      ) as { warnings?: string[] } | null;
      if (cancelled) return;
      setWarnings(Array.isArray(result?.warnings) ? result.warnings.join(" ") : "");
      setStatus("ready");
    }

    render(previewHost).catch((reason: unknown) => {
      if (cancelled) return;
      setMessage(reason instanceof Error ? reason.message : "The document could not be displayed.");
      setStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, [documentData, documentType, hostRef, template]);

  return <section aria-label={title} className="min-h-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-3 shadow-sm sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
    </div>
    {status === "error" && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{message}</p>}
    {warnings && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{warnings}</p>}
    {status === "loading" && <p className="mb-3 text-xs text-slate-500" role="status">Loading document…</p>}
    <div ref={hostRef} className="min-h-[calc(100dvh-14rem)] overflow-auto rounded-sm bg-white shadow-xl shadow-slate-900/15 xl:min-h-[calc(100dvh-16rem)]" />
  </section>;
}

async function loadBaseStyles(): Promise<void> {
  if (!baseStylesPromise) {
    baseStylesPromise = fetch("/resume-templates/css/base.css")
      .then(async (response) => {
        if (!response.ok) throw new Error("The resume template styles could not be loaded.");
        const style = document.createElement("style");
        style.dataset.qtsResumeBase = "true";
        style.textContent = (await response.text()).replace(/^\s*@charset[^;]+;\s*/i, "");
        document.head.append(style);
        scopeResumeStyles(style);
      })
      .catch((reason: unknown) => {
        baseStylesPromise = null;
        throw reason;
      });
  }
  await baseStylesPromise;
}

async function loadResumeRenderer(): Promise<void> {
  window.QTS_RESUME_DIRECT_RENDER = true;
  if (typeof window.renderResume === "function") return;
  if (!rendererPromise) {
    rendererPromise = (async () => {
      if (!window.RESUME_TEMPLATES || !window.RESUME_OPTIONS) {
        await loadPublicScript("/resume-templates/js/templates.js");
      }
      if (typeof window.renderResume !== "function") {
        await loadPublicScript("/resume-templates/js/render.js");
      }
      if (typeof window.renderResume !== "function") {
        throw new Error("The resume document renderer did not initialize.");
      }
    })().catch((reason: unknown) => {
      rendererPromise = null;
      throw reason;
    });
  }
  await rendererPromise;
}

function loadPublicScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src);
  if (existing) return existing;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load resume renderer script: ${src}`));
    document.head.append(script);
  });
  scriptPromises.set(src, loading);
  loading.catch(() => scriptPromises.delete(src));
  return loading;
}

function scopeResumeStyles(style: HTMLStyleElement): void {
  const sheet = style.sheet;
  if (!sheet) throw new Error("The resume styles could not be parsed.");
  scopeCssRules(sheet.cssRules, sheet);
}

function scopeCssRules(
  rules: CSSRuleList,
  parent: CSSGroupingRule | CSSStyleSheet,
): void {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (!rule) continue;
    if (rule.type === CSSRule.PAGE_RULE) {
      parent.deleteRule(index);
      continue;
    }
    if (rule.type === CSSRule.STYLE_RULE) {
      const styleRule = rule as CSSStyleRule;
      styleRule.selectorText = splitCssSelectorList(styleRule.selectorText)
        .map(scopeResumeSelector)
        .join(", ");
      continue;
    }
    if ("cssRules" in rule) {
      scopeCssRules((rule as CSSGroupingRule).cssRules, rule as CSSGroupingRule);
    }
  }
}

function scopeResumeSelector(selector: string): string {
  let scoped = selector.replace(/:root\b|html\b|body\b/g, ".qts-document-host");
  scoped = scoped
    .replace(/^\.is-embed\s+\.qts-document-host\b/, ".qts-document-host.is-embed")
    .replace(/^\[dir=(["']?)(ltr|rtl)\1\]\s+\.qts-document-host$/, '.qts-document-host[dir="$2"]');
  return scoped === selector ? `.qts-document-host ${selector}` : scoped;
}

function splitCssSelectorList(selectors: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < selectors.length; index += 1) {
    const char = selectors[index];
    if (quote) {
      if (char === quote && selectors[index - 1] !== "\\") quote = "";
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      result.push(selectors.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(selectors.slice(start).trim());
  return result.filter(Boolean);
}

function tryParsePdfPackage(source: string): PdfPackage | null {
  if (!source.trim()) return null;
  try {
    return parsePdfPackage(source);
  } catch {
    return null;
  }
}

function initialDocumentError(): string | null {
  try {
    parsePdfPackage(example);
    return null;
  } catch (reason) {
    return reason instanceof Error ? reason.message : "Generated JSON is invalid.";
  }
}

const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

async function renderTemplatePdf(
  host: HTMLDivElement | null,
  documentType: PreviewDocumentType,
): Promise<Uint8Array> {
  const root = host?.querySelector<HTMLElement>(".qts-document-host");
  const article = host?.querySelector<HTMLElement>(".doc");
  if (!host || !root || !article || root.dataset.renderState !== "ready") {
    throw new Error(`The ${documentType} preview is not ready to download.`);
  }

  await document.fonts.ready;
  const pageWidthMm = cssMillimeters(window.getComputedStyle(root).getPropertyValue("--page-width"));
  const pageHeightMm = cssMillimeters(window.getComputedStyle(root).getPropertyValue("--page-height"));
  const pageWidthPoints = pageWidthMm * 72 / 25.4;
  const pageHeightPoints = pageHeightMm * 72 / 25.4;
  const captureStyle = document.createElement("style");
  captureStyle.textContent = ".sheet { background: #fff !important; box-shadow: none !important; }";
  document.head.append(captureStyle);
  scopeResumeStyles(captureStyle);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(article, {
      backgroundColor: "#ffffff",
      height: article.scrollHeight,
      logging: false,
      scale: 2,
      useCORS: true,
      width: article.scrollWidth,
      windowHeight: Math.max(document.documentElement.clientHeight, article.scrollHeight),
      windowWidth: Math.max(document.documentElement.clientWidth, article.scrollWidth),
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    captureStyle.remove();
  }

  const pixelsPerPage = canvas.width * pageHeightMm / pageWidthMm;
  const previewPages = Number(root.dataset.pages) || 1;
  const pageCount = Math.max(1, previewPages, Math.ceil(canvas.height / pixelsPerPage - 0.01));
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = Math.ceil(pixelsPerPage);
    const context = pageCanvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare a PDF page.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    const sourceY = Math.round(pageIndex * pixelsPerPage);
    const sourceHeight = Math.max(
      0,
      Math.min(Math.ceil(pixelsPerPage), canvas.height - sourceY),
    );
    if (sourceHeight) {
      context.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceHeight,
        0,
        0,
        pageCanvas.width,
        sourceHeight,
      );
    }
    const image = await pdf.embedPng(pageCanvas.toDataURL("image/png"));
    const page = pdf.addPage([pageWidthPoints, pageHeightPoints]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidthPoints, height: pageHeightPoints });
  }
  return pdf.save();
}

function cssMillimeters(value: string): number {
  const normalized = value.trim();
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("The preview has invalid page dimensions.");
  }
  if (normalized.endsWith("mm")) return amount;
  if (normalized.endsWith("in")) return amount * 25.4;
  if (normalized.endsWith("px")) return amount * 25.4 / 96;
  throw new Error("The preview page size is not supported for PDF download.");
}

function safePathPart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim() || "Unknown";
}

function packageTimestamp(date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}

type ExtensionDownloadFile = {
  downloadPath: string;
  mimeType: "application/pdf";
  base64: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function requestExtensionDownloads(files: ExtensionDownloadFile[]): Promise<void> {
  const requestId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The QTS extension did not answer. Reload the updated extension, refresh this page, and try again."));
    }, 10_000);
    function onMessage(event: MessageEvent) {
      if (
        event.source !== window
        || event.origin !== window.location.origin
        || event.data?.type !== "QTS_DOWNLOAD_APPLICATION_FILES_RESULT"
        || event.data.requestId !== requestId
      ) return;
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      if (event.data.ok) resolve();
      else reject(new Error(event.data.error || "The QTS extension could not start the downloads."));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "QTS_DOWNLOAD_APPLICATION_FILES", requestId, files }, window.location.origin);
  });
}
