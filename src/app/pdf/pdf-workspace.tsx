"use client";

import { Download, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PdfPackage } from "@/app/pdf/document-data";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
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

const example = JSON.stringify({
  resume: {
    candidate: { fullName: "Jordan Taylor", email: "jordan@example.com", phone: "+1 555 0100", linkedinUrl: "https://linkedin.com/in/jordan-taylor", location: "Austin, TX", headline: "Program Coordinator" },
    targetRole: "Program Coordinator", targetCompany: "Example Company",
    summary: "Organized program coordinator experienced in reporting, stakeholder communication, and delivery tracking.",
    sections: [
      { title: "Core Skills", items: [{ bullets: ["Program coordination", "Reporting and documentation", "Stakeholder communication"] }] },
      { title: "Professional Experience", items: [{ heading: "Program Coordinator", subheading: "Example Organization", dateRange: "2022 – Present", bullets: ["Coordinated schedules, records, and deliverables across multiple programs."] }] },
      { title: "Education", items: [{ heading: "Bachelor of Business Administration", subheading: "Example University", dateRange: "2018 – 2022" }] },
    ],
  },
  coverLetter: {
    candidate: { fullName: "Jordan Taylor", email: "jordan@example.com", phone: "+1 555 0100", linkedinUrl: "https://linkedin.com/in/jordan-taylor" },
    targetRole: "Program Coordinator", targetCompany: "Example Company", date: "October 20, 2026", salutation: "Dear Hiring Manager,",
    bodyParagraphs: ["I am applying for the Program Coordinator position at Example Company.", "My experience coordinating schedules, maintaining records, and communicating with stakeholders aligns well with this role."],
    closing: "Sincerely,", signatureName: "Jordan Taylor",
  },
}, null, 2);

const samplePreviewData = parsePdfPackage(example);

type RenderedPreview = {
  data: PdfPackage;
  template: PdfTemplate;
  resumeUrl: string;
  coverLetterUrl: string;
  resumeBytes: Uint8Array;
  coverLetterBytes: Uint8Array;
};

export function PdfWorkspace({
  managerName,
  savedJobs,
}: {
  managerName: string;
  savedJobs: PdfSavedJob[];
}) {
  const [selectedJobId, setSelectedJobId] = useState(savedJobs[0]?.id ?? "");
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>(
    savedJobs[0]?.pdfTemplate ?? "heritage",
  );
  const [source, setSource] = useState(() => initialDocumentSource(savedJobs));
  const [parsed, setParsed] = useState<PdfPackage | null>(
    () => tryParsePdfPackage(initialDocumentSource(savedJobs)),
  );
  const [error, setError] = useState<string | null>(
    () => initialDocumentError(savedJobs),
  );
  const [previewError, setPreviewError] = useState<{
    data: PdfPackage;
    template: PdfTemplate;
    message: string;
  } | null>(null);
  const [renderedPreview, setRenderedPreview] = useState<RenderedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const prettySize = useMemo(() => new Blob([source]).size.toLocaleString(), [source]);
  const selectedJob = savedJobs.find((job) => job.id === selectedJobId) ?? null;
  const previewData = parsed ?? samplePreviewData;
  const currentPreview = renderedPreview?.data === previewData
    && renderedPreview.template === selectedTemplate
    ? renderedPreview
    : null;
  const currentPreviewError = previewError?.data === previewData
    && previewError.template === selectedTemplate
    ? previewError.message
    : null;

  useEffect(() => {
    let cancelled = false;
    let objectUrls: string[] = [];

    void renderPdfPackage(previewData, selectedTemplate).then((pdfs) => {
      if (cancelled) return;
      const resumeUrl = URL.createObjectURL(new Blob([
        Uint8Array.from(pdfs.resume).buffer,
      ], { type: "application/pdf" }));
      const coverLetterUrl = URL.createObjectURL(new Blob([
        Uint8Array.from(pdfs.coverLetter).buffer,
      ], { type: "application/pdf" }));
      objectUrls = [resumeUrl, coverLetterUrl];
      setPreviewError(null);
      setRenderedPreview({
        data: previewData,
        template: selectedTemplate,
        resumeUrl,
        coverLetterUrl,
        resumeBytes: pdfs.resume,
        coverLetterBytes: pdfs.coverLetter,
      });
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setPreviewError(
          {
            data: previewData,
            template: selectedTemplate,
            message: reason instanceof Error
              ? reason.message
              : "The PDF preview could not be rendered.",
          },
        );
      }
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewData, selectedTemplate]);

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
    setSelectedTemplate(job?.pdfTemplate ?? "heritage");
    updateSource(job ? generatedDocumentSource(job) : savedJobs.length ? "" : example);
  }
  async function downloadPair() {
    try {
      if (!selectedJob) throw new Error("Select a saved extension job before downloading.");
      if (!parsed) throw new Error("Enter valid résumé and cover-letter JSON before downloading.");
      if (!currentPreview) {
        throw new Error("Wait for the preview of the selected template to finish rendering.");
      }
      const data = parsed;
      setError(null); setBusy(true);
      const candidateName = safePathPart(data.resume.candidate.fullName);
      const jobTitle = safePathPart(data.resume.targetRole);
      const company = safePathPart(data.resume.targetCompany ?? data.coverLetter.targetCompany);
      const folder = `QTS_Resume/${safePathPart(managerName)}/${candidateName}/${packageTimestamp()}_${jobTitle}_${company}`;
      await requestExtensionDownloads([
        { downloadPath: `${folder}/${candidateName}.pdf`, mimeType: "application/pdf", base64: bytesToBase64(currentPreview.resumeBytes) },
        { downloadPath: `${folder}/${candidateName}_Cover_Letter.pdf`, mimeType: "application/pdf", base64: bytesToBase64(currentPreview.coverLetterBytes) },
        { downloadPath: `${folder}/JD.txt`, mimeType: "text/plain;charset=utf-8", base64: bytesToBase64(new TextEncoder().encode(selectedJob.description)) },
      ]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDF pair could not be created."); } finally { setBusy(false); }
  }

  return (
    <main className="py-1">
      <header className="mb-7"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">PDF</h1><p className="mt-1 text-sm text-slate-500">Create a matching resume and cover letter from one JSON object. Processing stays in this browser.</p></header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
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
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-template">Built-in PDF template
              <select className={inputClass} id="pdf-template" onChange={(event) => {
                if (isPdfTemplate(event.target.value)) setSelectedTemplate(event.target.value);
              }} value={selectedTemplate}>
                {pdfTemplateValues.map((template) => <option key={template} value={template}>{pdfTemplateLabels[template]}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700" htmlFor="pdf-json">Generated document JSON</label><textarea className="min-h-[440px] w-full resize-y rounded-lg border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" id="pdf-json" onChange={(event) => updateSource(event.target.value)} spellCheck={false} value={source} />
            {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
            <p className="mt-3 text-xs text-slate-500">Files save automatically under Downloads / QTS_Resume / {managerName} / candidate / date_time_job title_company. No folder selection is required.</p>
            <div className="mt-4 flex flex-wrap gap-2"><button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || !parsed || !currentPreview} onClick={() => void downloadPair()} type="button"><Download className="size-4" />{busy ? "Creating application files..." : "Save résumé and cover letter"}</button></div>
          </div>
        </section>
        <section className="space-y-5">
          {!parsed && <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">Sample preview — enter valid resume JSON to preview your document. The selected template is shown below.</p>}
          {currentPreviewError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{currentPreviewError}</p>}
          {currentPreview ? <>
            <PdfPreviewFrame title={`Resume preview · ${pdfTemplateLabels[selectedTemplate]}`} url={currentPreview.resumeUrl} />
            <PdfPreviewFrame title={`Cover letter preview · ${pdfTemplateLabels[selectedTemplate]}`} url={currentPreview.coverLetterUrl} />
          </> : !currentPreviewError && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><FileText className="mx-auto mb-3 size-8" />Rendering template preview…</div>}
        </section>
      </div>
    </main>
  );
}

function PdfPreviewFrame({ title, url }: { title: string; url: string }) {
  return <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-lg shadow-slate-900/15">
    <h2 className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-slate-100">{title}</h2>
    <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-slate-800 p-4 sm:p-6">
      <iframe className="h-[900px] w-full rounded-md bg-slate-700 shadow-xl shadow-black/30" src={url} title={title} />
    </div>
  </section>;
}

function initialDocumentSource(savedJobs: PdfSavedJob[]): string {
  if (!savedJobs.length) return example;
  return generatedDocumentSource(savedJobs[0]);
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

function safePathPart(value: string): string { return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim() || "Unknown"; }
function packageTimestamp(date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}
type ExtensionDownloadFile = {
  downloadPath: string;
  mimeType: "application/pdf" | "text/plain;charset=utf-8";
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
