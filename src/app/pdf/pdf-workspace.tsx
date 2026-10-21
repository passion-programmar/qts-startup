"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CoverLetterDocument,
  PdfPackage,
  ResumeDocument,
} from "@/app/pdf/document-data";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import {
  isPdfTemplate,
  pdfTemplateDesigns,
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
  const [busy, setBusy] = useState(false);
  const prettySize = useMemo(() => new Blob([source]).size.toLocaleString(), [source]);
  const selectedJob = savedJobs.find((job) => job.id === selectedJobId) ?? null;

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
      const data = parsePdfPackage(source);
      setParsed(data); setError(null); setBusy(true);
      const { resume: resumeBytes, coverLetter: coverLetterBytes } =
        await renderPdfPackage(data, selectedTemplate);
      const candidateName = safePathPart(data.resume.candidate.fullName);
      const jobTitle = safePathPart(data.resume.targetRole);
      const company = safePathPart(data.resume.targetCompany ?? data.coverLetter.targetCompany);
      const folder = `QTS_Resume/${safePathPart(managerName)}/${candidateName}/${packageTimestamp()}_${jobTitle}_${company}`;
      await requestExtensionDownloads([
        { downloadPath: `${folder}/${candidateName}.pdf`, mimeType: "application/pdf", base64: bytesToBase64(resumeBytes) },
        { downloadPath: `${folder}/${candidateName}_Cover_Letter.pdf`, mimeType: "application/pdf", base64: bytesToBase64(coverLetterBytes) },
        { downloadPath: `${folder}/JD.txt`, mimeType: "text/plain;charset=utf-8", base64: bytesToBase64(new TextEncoder().encode(selectedJob.description)) },
      ]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "PDF pair could not be created."); } finally { setBusy(false); }
  }

  return (
    <main className="py-1">
      <header className="mb-7"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">PDF</h1><p className="mt-1 text-sm text-slate-500">Create a matching resume and cover letter from one JSON object. Processing stays in this browser.</p></header>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">Document package</h2><p className="text-xs text-slate-500">{prettySize} bytes · resume + cover letter</p><p className="mt-1 text-xs font-semibold text-blue-700">{pdfTemplateLabels[selectedTemplate]} template</p></div><button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold hover:bg-slate-50" onClick={() => updateSource(example)} type="button"><RefreshCw className="size-3.5" />Load example</button></div>
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
            <div className="mt-4 flex flex-wrap gap-2"><button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || !parsed} onClick={() => void downloadPair()} type="button"><Download className="size-4" />{busy ? "Creating application files..." : "Save résumé and cover letter"}</button></div>
          </div>
        </section>
        <section className="space-y-5">{parsed ? <><ResumePreview document={parsed.resume} template={selectedTemplate} /><CoverPreview document={parsed.coverLetter} template={selectedTemplate} /></> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><FileText className="mx-auto mb-3 size-8" />Enter valid JSON to preview the documents.</div>}</section>
      </div>
    </main>
  );
}

function ResumePreview({ document, template }: { document: ResumeDocument; template: PdfTemplate }) {
  if (template === "vellum") return <VellumResumePreview document={document} />;
  const design = pdfTemplateDesigns[template];
  return <article className="overflow-hidden rounded-xl border bg-white shadow-sm" style={previewStyle(template)}>
    <div className={previewHeaderClass(template)} style={previewHeaderStyle(template)}>
      <p className="text-[10px] font-bold uppercase tracking-[.18em] opacity-75">Resume preview · {pdfTemplateLabels[template]}</p>
      <h2 className="mt-3 text-2xl font-bold tracking-wide">{document.candidate.fullName}</h2>
      <p className="text-sm font-medium opacity-80">{document.candidate.headline ?? document.targetRole}</p>
      <p className="mt-1 text-xs opacity-65">{[document.candidate.email, document.candidate.phone, document.candidate.location].filter(Boolean).join(" · ")}</p>
    </div>
    <div className={design.compact ? "p-4" : "p-6"}>
      {document.summary && <p className="text-sm leading-6 text-slate-700">{document.summary}</p>}
      {document.sections.map((section, index) => <section className={design.compact ? "mt-3" : "mt-5"} key={`${section.title}-${index}`}>
        <h3 className={previewSectionClass(template)} style={previewSectionStyle(template)}>{section.title}</h3>
        {section.items.map((item, itemIndex) => <div className="mt-3" key={itemIndex}><div className="flex justify-between gap-3 text-sm"><strong>{item.heading}</strong><span className="shrink-0 text-xs text-slate-500">{item.dateRange}</span></div>{item.subheading && <p className="text-xs text-slate-600">{item.subheading}</p>}<ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">{item.bullets?.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet.replaceAll("**", "")}</li>)}</ul></div>)}
      </section>)}
    </div>
  </article>;
}

function VellumResumePreview({ document }: { document: ResumeDocument }) {
  const contact = [
    document.candidate.email,
    document.candidate.phone,
    document.candidate.linkedinUrl,
    document.candidate.location,
  ].filter(Boolean).join(" · ");
  return <article className="overflow-hidden rounded-xl border border-slate-300 bg-white p-6 text-left font-sans text-slate-900 shadow-sm">
    <header className="border-t border-slate-400 pt-2 text-center">
      <h2 className="text-xl font-bold">{document.candidate.fullName}</h2>
      <p className="mt-0.5 text-sm text-slate-700">{document.candidate.headline ?? document.targetRole}</p>
      <div className="mt-2 border-b-4 border-double border-slate-800" />
      {contact && <p className="mt-2 break-words text-[10px] text-slate-600">{contact}</p>}
    </header>
    <div className="mt-5 space-y-4 text-xs leading-5">
      {document.summary && <section>
        <VellumSectionHeading title="Summary" />
        <p className="mt-2 text-slate-700">{document.summary}</p>
      </section>}
      {document.sections.map((section, index) => {
        const isSkills = /^(skills|technical skills|core skills|languages)$/i.test(section.title);
        const skillItems = section.items.flatMap((item) => [
          item.heading,
          item.subheading,
          item.dateRange,
          ...(item.bullets ?? []),
        ].filter((value): value is string => Boolean(value)));
        return <section key={`${section.title}-${index}`}>
          <VellumSectionHeading title={section.title} />
          {isSkills ? <p className="mt-2 text-slate-700">{skillItems.map((item, itemIndex) => (
            <span key={`${item}-${itemIndex}`}>{itemIndex > 0 && <span className="mx-1.5">·</span>}{item.replaceAll("**", "")}</span>
          ))}</p> : section.items.map((item, itemIndex) => <div className="mt-2.5" key={itemIndex}>
            <div className="flex items-baseline justify-between gap-3">
              <strong className="min-w-0">{item.heading}</strong>
              <span className="shrink-0 text-[10px] text-slate-500">{item.dateRange}</span>
            </div>
            {item.subheading && <p className="text-slate-600">{item.subheading}</p>}
            {item.bullets?.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
              {item.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet.replaceAll("**", "")}</li>)}
            </ul> : null}
          </div>)}
        </section>;
      })}
    </div>
  </article>;
}

function VellumSectionHeading({ title }: { title: string }) {
  return <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
    <span aria-hidden="true" className="h-px flex-1 bg-slate-400" />
    <span>{title}</span>
    <span aria-hidden="true" className="h-px flex-1 bg-slate-400" />
  </h3>;
}

function CoverPreview({ document, template }: { document: CoverLetterDocument; template: PdfTemplate }) {
  const design = pdfTemplateDesigns[template];
  if (template === "vellum") return <article className="overflow-hidden rounded-xl border border-slate-300 bg-white p-6 text-left font-sans text-slate-900 shadow-sm">
    <header className="border-t border-slate-400 pt-2 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Cover letter preview · {pdfTemplateLabels[template]}</p>
      <h2 className="mt-2 text-xl font-bold">{document.candidate.fullName}</h2>
      <p className="text-xs text-slate-600">{[document.candidate.email, document.candidate.phone, document.candidate.linkedinUrl].filter(Boolean).join(" · ")}</p>
      <div className="mt-2 border-b-4 border-double border-slate-800" />
    </header>
    <div className="pt-5 text-sm">
      <p>{document.date}</p>
      <p className="mt-5">{document.salutation ?? "Dear Hiring Manager,"}</p>
      {document.bodyParagraphs.map((paragraph, index) => <p className="mt-4 leading-6 text-slate-700" key={index}>{paragraph}</p>)}
      <p className="mt-5">{document.closing ?? "Sincerely,"}<br />{document.signatureName ?? document.candidate.fullName}</p>
    </div>
  </article>;
  return <article className="overflow-hidden rounded-xl border bg-white shadow-sm" style={previewStyle(template)}>
    <div className={previewHeaderClass(template)} style={previewHeaderStyle(template)}><p className="text-[10px] font-bold uppercase tracking-[.18em] opacity-75">Cover letter preview · {pdfTemplateLabels[template]}</p><h2 className="mt-3 text-xl font-bold">{document.candidate.fullName}</h2><p className="text-xs opacity-65">{document.candidate.email}{document.candidate.phone ? ` · ${document.candidate.phone}` : ""}</p></div>
    <div className={design.compact ? "p-4" : "p-6"}><p className="text-sm">{document.date}</p><p className="mt-5 text-sm">{document.salutation ?? "Dear Hiring Manager,"}</p>{document.bodyParagraphs.map((paragraph, index) => <p className="mt-4 text-sm leading-6 text-slate-700" key={index}>{paragraph}</p>)}<p className="mt-5 text-sm">{document.closing ?? "Sincerely,"}<br />{document.signatureName ?? document.candidate.fullName}</p></div>
  </article>;
}

function previewStyle(template: PdfTemplate) {
  const design = pdfTemplateDesigns[template];
  const accent = rgbCss(design.accent);
  return {
    borderColor: `${accent}55`,
    borderTopWidth: design.header === "rule" || design.header === "double-rule" ? 4 : 1,
    borderTopColor: accent,
    fontFamily: design.font === "serif" ? "Georgia, serif" : design.font === "mono" ? "ui-monospace, monospace" : "Arial, sans-serif",
    textAlign: design.align,
  } as const;
}

function previewHeaderClass(template: PdfTemplate): string {
  const header = pdfTemplateDesigns[template].header;
  return `p-6 ${header === "card" ? "m-3 rounded-lg" : ""}`;
}

function previewSectionClass(template: PdfTemplate): string {
  const section = pdfTemplateDesigns[template].section;
  return `pb-1 text-xs font-bold uppercase tracking-wider ${section === "band" || section === "card" ? "rounded px-2 py-1" : section === "pill" ? "inline-block rounded-full px-3 py-1" : section === "marker" ? "border-l-4 pl-2" : section === "plain" ? "" : "border-b"}`;
}

function previewHeaderStyle(template: PdfTemplate) {
  const design = pdfTemplateDesigns[template];
  const accent = rgbCss(design.accent);
  const dark = design.header === "band" || design.header === "card";
  return {
    backgroundColor: dark ? (template === "onyx" || template === "terminal" ? "#202329" : template === "amber-crest" || template === "sentinel" ? "#101f38" : accent) : design.header === "soft" ? "#f1f5f9" : "white",
    color: dark && !["onyx", "amber-crest", "terminal"].includes(template) ? "white" : accent,
    borderBottom: design.header === "double-rule" ? `4px double ${accent}` : design.header === "rule" ? `2px solid ${accent}` : undefined,
  } as const;
}

function previewSectionStyle(template: PdfTemplate) {
  const design = pdfTemplateDesigns[template];
  const accent = rgbCss(design.accent);
  return {
    color: design.section === "band" ? "white" : accent,
    backgroundColor: design.section === "band" ? accent : design.section === "card" || design.section === "pill" ? `${accent}18` : undefined,
    borderColor: accent,
    borderBottomStyle: design.section === "double-rule" ? "double" : undefined,
  } as const;
}

function rgbCss(value: readonly [number, number, number]): string {
  return `rgb(${value.map((part) => Math.round(part * 255)).join(", ")})`;
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
