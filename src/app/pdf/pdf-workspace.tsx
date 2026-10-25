"use client";

import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { WorkspaceClocks } from "@/app/components/workspace-clocks";
import type { PdfPackage } from "@/app/pdf/document-data";
import { parsePdfPackage } from "@/app/pdf/document-data";
import sampleFull from "@/app/pdf/sample-full.json";
import { TemplatePagesPreview } from "@/app/pdf/template-pages-preview";
import {
  isPdfTemplate,
  pdfTemplateLabels,
  pdfTemplateValues,
  type PdfTemplate,
} from "@/server/pdf/pdf-templates";

type PreviewDocumentType = "resume" | "cover-letter";

const previewDocuments = [
  { type: "resume", label: "Resume" },
  { type: "cover-letter", label: "Cover letter" },
] as const;

// Both PDFs as the server printed them for one JSON and template combination.
type PrintedPdfs = {
  resume: Uint8Array;
  coverLetter: Uint8Array;
  renderer: "template" | "fallback";
};

type ResumeDownloadDirectory = FileSystemDirectoryHandle & {
  queryPermission: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
      startIn?: "downloads";
    }) => Promise<ResumeDownloadDirectory>;
  }
}

const example = JSON.stringify(sampleFull, null, 2);

const samplePreviewData = parsePdfPackage(example);

export function PdfWorkspace({
  managerName,
}: {
  managerName: string;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>("qts-standard");
  const [activeDocument, setActiveDocument] = useState<PreviewDocumentType>("resume");
  const [source, setSource] = useState(example);
  const [parsed, setParsed] = useState<PdfPackage | null>(
    () => tryParsePdfPackage(example),
  );
  const [previewSource, setPreviewSource] = useState(example);
  const [previewPackage, setPreviewPackage] = useState(samplePreviewData);
  const [error, setError] = useState<string | null>(
    () => initialDocumentError(),
  );
  const [downloadStep, setDownloadStep] = useState<"printing" | "saving" | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [downloadDirectoryName, setDownloadDirectoryName] = useState<string | null>(null);
  const [downloadDirectoryReady, setDownloadDirectoryReady] = useState(false);
  const downloadDirectoryRef = useRef<ResumeDownloadDirectory | null>(null);
  const busy = downloadStep !== null;
  const previewOutOfDate = source !== previewSource;
  const documentLabel = activeDocument === "resume" ? "Resume" : "Cover letter";

  useEffect(() => {
    let cancelled = false;
    readSavedDownloadDirectory()
      .then((directory) => {
        if (cancelled) return;
        downloadDirectoryRef.current = directory;
        setDownloadDirectoryName(directory?.name ?? null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(describeBrowserError(reason, "The saved download folder could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) setDownloadDirectoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateSource(nextSource: string) {
    setSource(nextSource);
    if (!nextSource.trim()) {
      setParsed(null);
      setError(null);
      return;
    }
    try {
      const nextParsed = parsePdfPackage(nextSource);
      setParsed(nextParsed);
      setPreviewPackage(nextParsed);
      setPreviewSource(nextSource);
      setError(null);
    } catch (reason) {
      setParsed(null);
      setError(reason instanceof Error ? reason.message : "JSON is invalid.");
    }
  }

  async function changeDownloadDirectory() {
    try {
      const directory = await pickDownloadDirectory();
      if (!directory) {
        setError("This browser does not support selecting a download folder.");
        return;
      }
      await saveDownloadDirectory(directory);
      downloadDirectoryRef.current = directory;
      setDownloadDirectoryName(directory.name);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "Folder selection was cancelled; the previously saved folder is unchanged."
          : describeBrowserError(reason, "The download folder could not be saved."),
      );
    }
  }

  async function downloadPair() {
    try {
      if (!parsed || previewOutOfDate) {
        throw new Error("Fix the JSON before downloading; the preview shows the last valid version.");
      }
      setDownloadStep("printing");
      setFallbackUsed(false);
      setError(null);
      // The folder comes first, while the click still allows the browser to ask for it; printing
      // can take a few seconds.
      const directory = await getDownloadDirectoryForSave(
        downloadDirectoryRef.current,
        (selected) => {
          downloadDirectoryRef.current = selected;
          setDownloadDirectoryName(selected.name);
        },
      );
      const printed = await printPdfPair(parsed, selectedTemplate);
      setDownloadStep("saving");
      const candidateName = safePathPart(parsed.resume.candidate.fullName);
      const jobTitle = safePathPart(parsed.resume.targetRole);
      const company = safePathPart(parsed.resume.targetCompany ?? parsed.coverLetter.targetCompany);
      const folder = `QTS_Resume/${safePathPart(managerName)}/${candidateName}/${packageTimestamp()}_${jobTitle}_${company}`;
      const files = [
        { name: `${candidateName}.pdf`, bytes: printed.resume },
        { name: `${candidateName}_Cover_Letter.pdf`, bytes: printed.coverLetter },
      ];
      if (directory) {
        await savePdfPairToDirectory(directory, folder, files);
      } else {
        downloadPdfPairInBrowser(files);
      }
      setFallbackUsed(printed.renderer === "fallback");
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "Folder selection was cancelled; no PDFs were saved."
          : describeBrowserError(reason, "The resume and cover letter could not be downloaded."),
      );
    } finally {
      setDownloadStep(null);
    }
  }

  return (
    <main className="py-1 lg:flex lg:h-[calc(100dvh-8.5rem)] lg:min-h-[28rem] lg:flex-col">
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <nav aria-label="Document preview selection" className="flex items-center gap-3">
            <button
              aria-label="Show resume"
              className="inline-flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={activeDocument === "resume"}
              onClick={() => setActiveDocument("resume")}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <span className="min-w-24 text-center text-sm font-semibold text-slate-700" aria-live="polite">
              {documentLabel}
            </span>
            <button
              aria-label="Show cover letter"
              className="inline-flex size-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={activeDocument === "cover-letter"}
              onClick={() => setActiveDocument("cover-letter")}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </nav>
          <WorkspaceClocks />
        </div>
      </header>
      {/* The JSON and PDF panels keep a 34:66 split from tablet-landscape width up and stack below it.
          Whole-number fr values let the PDF panel take all remaining space when the JSON panel is at
          its minimum width (fractions below 1 would leave part of the row empty). */}
      <div className="grid items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(17rem,34fr)_minmax(0,66fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:max-h-full lg:overflow-y-auto">
          <div className="space-y-4 p-5">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-template">Resume and cover-letter template
              <select className={inputClass} id="pdf-template" onChange={(event) => {
                if (isPdfTemplate(event.target.value)) setSelectedTemplate(event.target.value);
              }} value={selectedTemplate}>
                {pdfTemplateValues.map((template) => <option key={template} value={template}>{pdfTemplateLabels[template]}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-json">Generated document JSON</label><textarea className="theme-light h-[min(36vh,28rem)] min-h-[180px] w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" id="pdf-json" onChange={(event) => updateSource(event.target.value)} spellCheck={false} value={source} />
            {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
            {previewOutOfDate && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">The preview is showing the last valid JSON while the current edits are incomplete or invalid.</p>}
            {previewSource === example && <p className="text-xs text-amber-800">The preview currently shows sample template JSON. Enter valid resume data to update it.</p>}
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-600">
                {downloadDirectoryName
                  ? `Saved folder: ${downloadDirectoryName}. This browser will remember it for future downloads.`
                  : "Choose a folder once in supported browsers; otherwise PDFs use the normal download location."}
              </p>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !downloadDirectoryReady}
                onClick={() => void changeDownloadDirectory()}
                type="button"
              >
                {downloadDirectoryName ? "Change download folder" : "Choose download folder"}
              </button>
            </div>
            <p className="text-xs text-slate-500">Both PDFs are saved under QTS_Resume / {managerName} / candidate within your chosen folder. Browsers without folder access use their normal download location.</p>
            <div className="mt-4 space-y-3">
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !parsed || previewOutOfDate || !downloadDirectoryReady}
                onClick={() => void downloadPair()}
                type="button"
              >
                {busy ? <LoadingIcon className="size-4" /> : <Download className="size-4" />}
                {downloadStep === "printing" ? "Preparing PDFs..." : downloadStep === "saving" ? "Saving PDFs..." : "Download resume and cover letter"}
              </button>
              {fallbackUsed && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
                  The template printer was unavailable, so these PDFs use the simplified built-in layout and differ from the preview.
                </p>
              )}
            </div>
          </div>
        </section>
        <section
          aria-label="PDF preview"
          className="min-w-0 rounded-xl border border-slate-200 bg-slate-100 p-3 shadow-sm sm:p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden"
        >
          <h2 className="mb-3 text-sm font-semibold text-slate-800">{documentLabel} · {pdfTemplateLabels[selectedTemplate]}</h2>
          {!parsed && <p className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Sample preview — enter valid resume JSON to preview your document. The selected template is shown below.</p>}
          {/* Both documents stay drawn, so switching between them is instant. */}
          <div className="relative">
            {previewDocuments.map((preview) => (
              <TemplatePagesPreview
                data={previewPackage}
                documentType={preview.type}
                hidden={preview.type !== activeDocument}
                key={preview.type}
                label={preview.label}
                template={selectedTemplate}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function tryParsePdfPackage(source: string): PdfPackage | null {
  if (!source.trim()) return null;
  try {
    return parsePdfPackage(source);
  } catch {
    return null;
  }
}

// Browser storage and file-system errors carry technical text; show what the Manager can do instead.
function describeBrowserError(reason: unknown, fallback: string): string {
  if (reason instanceof DOMException) {
    return reason.name === "NotAllowedError" || reason.name === "SecurityError"
      ? "The browser blocked access to the download folder. Choose the folder again and allow access."
      : fallback;
  }
  return reason instanceof Error ? reason.message : fallback;
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

// The server prints both PDFs with the same Chromium printing Generation uses, from the template
// the preview draws: real pages with real, selectable text, never a line cut across pages.
async function printPdfPair(data: PdfPackage, template: PdfTemplate): Promise<PrintedPdfs> {
  const response = await fetch("/api/pdf/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document: data, template }),
  });
  let result: unknown = null;
  try {
    result = await response.json();
  } catch {
    // A non-JSON response (for example a gateway timeout) is reported below.
  }
  const body = isRecord(result) ? result : {};
  if (!response.ok || body.success !== true || typeof body.resume !== "string" || typeof body.coverLetter !== "string") {
    throw new Error(typeof body.message === "string" ? body.message : `QTS could not prepare the PDFs (HTTP ${response.status}).`);
  }
  return {
    resume: base64Bytes(body.resume),
    coverLetter: base64Bytes(body.coverLetter),
    renderer: body.renderer === "fallback" ? "fallback" : "template",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function safePathPart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim() || "Unknown";
}

function packageTimestamp(date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}

const DOWNLOAD_DIRECTORY_DATABASE = "qts-resume-downloads";
const DOWNLOAD_DIRECTORY_STORE = "settings";
const DOWNLOAD_DIRECTORY_KEY = "output-folder";

function openDownloadDirectoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOAD_DIRECTORY_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DOWNLOAD_DIRECTORY_STORE)) {
        request.result.createObjectStore(DOWNLOAD_DIRECTORY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not access saved download-folder settings."));
    request.onblocked = () => reject(new Error("Saved download-folder settings are blocked by another browser tab."));
  });
}

async function readSavedDownloadDirectory(): Promise<ResumeDownloadDirectory | null> {
  const database = await openDownloadDirectoryDatabase();
  try {
    const transaction = database.transaction(DOWNLOAD_DIRECTORY_STORE, "readonly");
    const request = transaction.objectStore(DOWNLOAD_DIRECTORY_STORE).get(DOWNLOAD_DIRECTORY_KEY);
    const handle: unknown = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read the saved download folder."));
    });
    if (isResumeDownloadDirectory(handle)) return handle;
    return null;
  } finally {
    database.close();
  }
}

function isResumeDownloadDirectory(value: unknown): value is ResumeDownloadDirectory {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && value.kind === "directory"
    && "name" in value
    && typeof value.name === "string"
    && "getDirectoryHandle" in value
    && typeof value.getDirectoryHandle === "function"
    && "getFileHandle" in value
    && typeof value.getFileHandle === "function"
    && "queryPermission" in value
    && typeof value.queryPermission === "function"
    && "requestPermission" in value
    && typeof value.requestPermission === "function";
}

async function saveDownloadDirectory(directory: ResumeDownloadDirectory): Promise<void> {
  const database = await openDownloadDirectoryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DOWNLOAD_DIRECTORY_STORE, "readwrite");
      transaction.objectStore(DOWNLOAD_DIRECTORY_STORE).put(directory, DOWNLOAD_DIRECTORY_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the selected download folder."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving the selected download folder was aborted."));
    });
  } finally {
    database.close();
  }
}

async function pickDownloadDirectory(): Promise<ResumeDownloadDirectory | null> {
  if (typeof window.showDirectoryPicker !== "function") return null;
  const directory = await window.showDirectoryPicker({ mode: "readwrite", startIn: "downloads" });
  const permission = await directory.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error("Write access was not granted for the selected download folder.");
  }
  return directory;
}

async function getDownloadDirectoryForSave(
  savedDirectory: ResumeDownloadDirectory | null,
  onSelected: (directory: ResumeDownloadDirectory) => void,
): Promise<ResumeDownloadDirectory | null> {
  if (typeof window.showDirectoryPicker !== "function") return null;
  if (savedDirectory) {
    const permission = await savedDirectory.queryPermission({ mode: "readwrite" });
    const renewedPermission = permission === "granted"
      ? permission
      : await savedDirectory.requestPermission({ mode: "readwrite" });
    if (renewedPermission === "granted") return savedDirectory;
  }
  const directory = await pickDownloadDirectory();
  if (!directory) return null;
  await saveDownloadDirectory(directory);
  onSelected(directory);
  return directory;
}

async function savePdfPairToDirectory(
  directory: ResumeDownloadDirectory,
  folderPath: string,
  files: Array<{ name: string; bytes: Uint8Array }>,
): Promise<void> {
  let destination: FileSystemDirectoryHandle = directory;
  for (const segment of folderPath.split("/")) {
    destination = await destination.getDirectoryHandle(segment, { create: true });
  }
  for (const file of files) {
    const handle = await destination.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Blob([Uint8Array.from(file.bytes).buffer], { type: "application/pdf" }));
    await writable.close();
  }
}

function downloadPdfPairInBrowser(files: Array<{ name: string; bytes: Uint8Array }>): void {
  for (const file of files) {
    const blob = new Blob([Uint8Array.from(file.bytes).buffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
