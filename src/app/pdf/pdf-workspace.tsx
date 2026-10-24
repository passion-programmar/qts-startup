"use client";

import html2canvas from "html2canvas";
import { Download, ExternalLink } from "lucide-react";
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

type PdfSavedJob = {
  id: string;
  candidateName: string;
  jobTitle: string;
  company: string;
  jobUrl: string;
  location: string;
  description: string;
  generatedDocument: unknown;
  pdfTemplate: PdfTemplate;
};

type PreviewDocumentType = "resume" | "cover-letter";

const example = JSON.stringify(sampleFull, null, 2);

const samplePreviewData = parsePdfPackage(example);

export function PdfWorkspace({
  managerName,
  savedJobs,
}: {
  managerName: string;
  savedJobs: PdfSavedJob[];
}) {
  const [selectedJobId, setSelectedJobId] = useState(savedJobs[0]?.id ?? "");
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>(
    savedJobs[0]?.pdfTemplate ?? "qts-standard",
  );
  const [source, setSource] = useState(() => initialDocumentSource(savedJobs));
  const [parsed, setParsed] = useState<PdfPackage | null>(
    () => tryParsePdfPackage(initialDocumentSource(savedJobs)),
  );
  const [error, setError] = useState<string | null>(
    () => initialDocumentError(savedJobs),
  );
  const [previewStatuses, setPreviewStatuses] = useState<Record<PreviewDocumentType, "loading" | "ready" | "error">>({
    resume: "loading",
    "cover-letter": "loading",
  });
  const [busy, setBusy] = useState(false);
  const resumeFrameRef = useRef<HTMLIFrameElement>(null);
  const coverLetterFrameRef = useRef<HTMLIFrameElement>(null);
  const prettySize = useMemo(() => new Blob([source]).size.toLocaleString(), [source]);
  const selectedJob = savedJobs.find((job) => job.id === selectedJobId) ?? null;
  const sampleSourceSelected = source === example && !selectedJob?.generatedDocument;
  const previewData = parsed ?? samplePreviewData;
  const templateData = useMemo(
    () => toResumeTemplateData(previewData, selectedTemplate),
    [previewData, selectedTemplate],
  );
  const updatePreviewStatus = useCallback(
    (documentType: PreviewDocumentType, status: "loading" | "ready" | "error") => {
      setPreviewStatuses((current) => ({ ...current, [documentType]: status }));
    },
    [],
  );

  function updateSource(nextSource: string) {
    setSource(nextSource);
    if (!nextSource.trim()) {
      setParsed(null);
      setError(null);
      return;
    }
    try { setParsed(parsePdfPackage(nextSource)); setError(null); } catch (reason) { setParsed(null); setError(reason instanceof Error ? reason.message : "JSON is invalid."); }
  }
  function selectSavedJob(jobId: string) {
    setSelectedJobId(jobId);
    const job = savedJobs.find((savedJob) => savedJob.id === jobId) ?? null;
    updateSource(job ? generatedDocumentSource(job) || example : example);
  }
  async function downloadPair() {
    try {
      if (!parsed) throw new Error("Enter valid résumé and cover-letter JSON before downloading.");
      if (previewStatuses.resume !== "ready" || previewStatuses["cover-letter"] !== "ready") {
        throw new Error("Wait for both document previews to finish rendering.");
      }
      setBusy(true);
      setError(null);
      const [resume, coverLetter] = await Promise.all([
        renderTemplatePdf(resumeFrameRef.current, "resume"),
        renderTemplatePdf(coverLetterFrameRef.current, "cover-letter"),
      ]);
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
      setBusy(false);
    }
  }

  return (
    <main className="py-1">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Resume</h1>
          <p className="mt-1 text-sm text-slate-500">Choose a resume template and create a matching cover letter from one JSON object. Processing stays in this browser.</p>
        </div>
        <a
          className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          href="/resume-template"
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-4" />
          Resume
        </a>
      </header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3.5fr)_minmax(0,6fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Document package</h2><p className="text-xs text-slate-500">{prettySize} bytes · resume + cover letter</p><p className="mt-1 text-xs font-semibold text-blue-700">{pdfTemplateLabels[selectedTemplate]} template</p></div>
          <div className="space-y-4 p-5">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-saved-job">Saved job from extension
              <select className={inputClass} id="pdf-saved-job" onChange={(event) => selectSavedJob(event.target.value)} value={selectedJobId}>
                {!savedJobs.length && <option value="">No saved jobs</option>}
                {savedJobs.map((job) => <option key={job.id} value={job.id}>{job.candidateName} · {job.jobTitle} · {job.company}</option>)}
              </select>
            </label>
            {selectedJob && <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
              <p className="text-xs font-semibold text-slate-700">Job description captured by the extension</p>
              <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{selectedJob.description || "No saved description is available for this job."}</p>
              <a className="mt-2 inline-block break-all text-xs text-blue-700 underline" href={selectedJob.jobUrl} rel="noreferrer" target="_blank">{selectedJob.jobUrl}</a>
              {!selectedJob.generatedDocument && <p className="mt-2 text-xs text-amber-800">No completed extension Generation result is linked to this saved job yet. Start Generation from its job page, then return here to load the generated documents.</p>}
            </div>}
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-template">Resume and cover-letter template
              <select className={inputClass} id="pdf-template" onChange={(event) => {
                if (isPdfTemplate(event.target.value)) setSelectedTemplate(event.target.value);
              }} value={selectedTemplate}>
                {pdfTemplateValues.map((template) => <option key={template} value={template}>{pdfTemplateLabels[template]}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-json">Generated document JSON</label><textarea className="min-h-[440px] w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" id="pdf-json" onChange={(event) => updateSource(event.target.value)} spellCheck={false} value={source} />
            {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
            {sampleSourceSelected && <p className="text-xs text-amber-800">Sample template JSON is prefilled for preview. Replace it with your generated resume data before saving files.</p>}
            <p className="text-xs text-slate-500">Download both PDFs using the selected template. Files save under Downloads / QTS_Resume / {managerName} / candidate.</p>
            <div className="mt-4">
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !parsed || previewStatuses.resume !== "ready" || previewStatuses["cover-letter"] !== "ready"}
                onClick={() => void downloadPair()}
                type="button"
              >
                <Download className="size-4" />
                {busy ? "Preparing PDFs..." : "Download résumé and cover letter"}
              </button>
            </div>
          </div>
        </section>
        <section className="space-y-5">
          {!parsed && <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Sample preview — enter valid resume JSON to preview your document. The selected template is shown below.</p>}
          <PdfTemplatePreviewFrame
            documentData={templateData}
            documentType="resume"
            template={selectedTemplate}
            title={`Resume preview · ${pdfTemplateLabels[selectedTemplate]}`}
            iframeRef={resumeFrameRef}
            onStatusChange={updatePreviewStatus}
          />
          <PdfTemplatePreviewFrame
            documentData={templateData}
            documentType="cover-letter"
            template={selectedTemplate}
            title={`Cover letter preview · ${pdfTemplateLabels[selectedTemplate]}`}
            iframeRef={coverLetterFrameRef}
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
  iframeRef,
  onStatusChange,
}: {
  documentData: ReturnType<typeof toResumeTemplateData>;
  documentType: PreviewDocumentType;
  template: PdfTemplate;
  title: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onStatusChange: (documentType: PreviewDocumentType, status: "loading" | "ready" | "error") => void;
}) {
  const requestId = useRef("");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState("");

  useEffect(() => onStatusChange(documentType, status), [documentType, onStatusChange, status]);

  useEffect(() => {
    function sendDocument() {
      const frame = iframeRef.current;
      if (!iframeLoaded || !frame?.contentWindow) return;
      const id = crypto.randomUUID();
      requestId.current = id;
      setStatus("loading");
      setMessage("");
      setWarnings("");
      frame.contentWindow.postMessage({
        type: "QTS_RESUME_TEMPLATE_RENDER",
        requestId: id,
        document: documentData,
        template,
      }, window.location.origin);
    }

    function handleRender(event: MessageEvent) {
      if (
        event.origin !== window.location.origin
        || event.source !== iframeRef.current?.contentWindow
        || event.data?.type !== "QTS_RESUME_TEMPLATE_RENDERED"
        || event.data.requestId !== requestId.current
      ) return;
      if (event.data.ok) {
        setWarnings(typeof event.data.warnings === "string" ? event.data.warnings : "");
        setStatus("ready");
      } else {
        setMessage(typeof event.data.error === "string" ? event.data.error : "The preview could not be rendered.");
        setStatus("error");
      }
    }

    window.addEventListener("message", handleRender);
    sendDocument();
    return () => window.removeEventListener("message", handleRender);
  }, [documentData, iframeLoaded, iframeRef, template]);

  return <section aria-label={title} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-3 shadow-sm sm:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
    </div>
    {status === "error" && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{message}</p>}
    {warnings && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{warnings}</p>}
    {status === "loading" && <p className="mb-3 text-xs text-slate-500" role="status">Rendering {documentType} template…</p>}
    <div className="mx-auto max-w-[820px] overflow-hidden rounded-sm bg-white shadow-xl shadow-slate-900/15">
      <iframe
        className="block h-[1100px] w-full border-0 bg-white"
        onLoad={() => setIframeLoaded(true)}
        ref={iframeRef}
        src={`/resume-templates/${documentType === "resume" ? "resume" : "cover-letter"}.html?embed=1`}
        title={title}
      />
    </div>
  </section>;
}

function initialDocumentSource(savedJobs: PdfSavedJob[]): string {
  if (!savedJobs.length) return example;
  return generatedDocumentSource(savedJobs[0]) || example;
}

function generatedDocumentSource(job: PdfSavedJob): string {
  if (
    typeof job.generatedDocument !== "object"
    || job.generatedDocument === null
    || Array.isArray(job.generatedDocument)
  ) {
    return "";
  }
  return JSON.stringify(job.generatedDocument, null, 2);
}

function tryParsePdfPackage(source: string): PdfPackage | null {
  if (!source.trim()) return null;
  try {
    return parsePdfPackage(source);
  } catch {
    return null;
  }
}

function initialDocumentError(savedJobs: PdfSavedJob[]): string | null {
  const source = initialDocumentSource(savedJobs);
  if (!source.trim()) return null;
  try {
    parsePdfPackage(source);
    return null;
  } catch (reason) {
    return reason instanceof Error ? reason.message : "Generated JSON is invalid.";
  }
}

const inputClass = "mt-1 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

async function renderTemplatePdf(
  frame: HTMLIFrameElement | null,
  documentType: PreviewDocumentType,
): Promise<Uint8Array> {
  const frameDocument = frame?.contentDocument;
  const root = frameDocument?.documentElement;
  const article = frameDocument?.querySelector<HTMLElement>(".doc");
  if (!frameDocument || !root || !article || root.dataset.renderState !== "ready") {
    throw new Error(`The ${documentType} preview is not ready to download.`);
  }

  await frameDocument.fonts.ready;
  const frameWindow = frame?.contentWindow;
  if (!frameWindow) throw new Error(`The ${documentType} preview window is unavailable.`);
  const pageWidthMm = cssMillimeters(frameWindow.getComputedStyle(root).getPropertyValue("--page-width"));
  const pageHeightMm = cssMillimeters(frameWindow.getComputedStyle(root).getPropertyValue("--page-height"));
  const pageWidthPoints = pageWidthMm * 72 / 25.4;
  const pageHeightPoints = pageHeightMm * 72 / 25.4;
  const captureStyle = frameDocument.createElement("style");
  captureStyle.textContent = ".sheet { background: #fff !important; box-shadow: none !important; }";
  frameDocument.head.append(captureStyle);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(article, {
      backgroundColor: "#ffffff",
      height: article.scrollHeight,
      logging: false,
      scale: 2,
      useCORS: true,
      width: article.scrollWidth,
      windowHeight: Math.max(frameDocument.documentElement.clientHeight, article.scrollHeight),
      windowWidth: Math.max(frameDocument.documentElement.clientWidth, article.scrollWidth),
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    captureStyle.remove();
  }

  const pixelsPerPage = canvas.width * pageHeightMm / pageWidthMm;
  const previewPages = Number(root.dataset.pages) || 1;
  const pageCount = Math.max(previewPages, Math.ceil(canvas.height / pixelsPerPage - 0.01));
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageCanvas = frameDocument.createElement("canvas");
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
        Math.ceil(pixelsPerPage),
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
