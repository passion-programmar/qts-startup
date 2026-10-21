"use client";

import { Download, FileText, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { CoverLetterDocument, PdfPackage, ResumeDocument } from "@/app/pdf/document-data";
import { parsePdfPackage } from "@/app/pdf/document-data";
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

export function PdfWorkspace({
  managerName,
  savedJobs,
}: {
  managerName: string;
  savedJobs: PdfSavedJob[];
}) {
  const [selectedJobId, setSelectedJobId] = useState(savedJobs[0]?.id ?? "");
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplate>(
    savedJobs[0]?.pdfTemplate ?? "professional",
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
    setSelectedTemplate(job?.pdfTemplate ?? "professional");
    updateSource(job ? generatedDocumentSource(job) : savedJobs.length ? "" : example);
  }
  async function downloadPair() {
    try {
      const data = parsePdfPackage(source);
      setParsed(data); setError(null); setBusy(true);
      const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
      const downloads = picker
        ? await picker.call(window, { mode: "readwrite", startIn: "downloads" })
        : null;
      const [resumeBytes, coverLetterBytes] = await Promise.all([
        resumePdf(data.resume, selectedTemplate),
        coverLetterPdf(data.coverLetter, selectedTemplate),
      ]);
      const candidateName = safePathPart(data.resume.candidate.fullName);
      const jobTitle = safePathPart(data.resume.targetRole);
      const company = safePathPart(data.resume.targetCompany ?? data.coverLetter.targetCompany);
      const fileStem = safeFileStem(data.resume.candidate.fullName);
      if (downloads) {
        const qtsFolder = await downloads.getDirectoryHandle("QTS_Resume", { create: true });
        const managerFolder = await qtsFolder.getDirectoryHandle(safePathPart(managerName), { create: true });
        const candidateFolder = await managerFolder.getDirectoryHandle(candidateName, { create: true });
        const jobFolder = await candidateFolder.getDirectoryHandle(`${packageTimestamp()}_${jobTitle}_${company}`, { create: true });
        await Promise.all([
          writeFile(jobFolder, `${fileStem}_Resume.pdf`, resumeBytes),
          writeFile(jobFolder, `${fileStem}_Cover_Letter.pdf`, coverLetterBytes),
        ]);
      } else {
        saveBlob(new Blob([new Uint8Array(resumeBytes)], { type: "application/pdf" }), `${fileStem}_Resume.pdf`);
        saveBlob(new Blob([new Uint8Array(coverLetterBytes)], { type: "application/pdf" }), `${fileStem}_Cover_Letter.pdf`);
      }
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
            <p className="mt-3 text-xs text-slate-500">Choose your Downloads folder to save two files under: QTS_Resume / {managerName} / candidate / date_time_job title_company</p>
            <div className="mt-4 flex flex-wrap gap-2"><button className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={busy || !parsed} onClick={() => void downloadPair()} type="button"><Download className="size-4" />{busy ? "Creating application files..." : "Save résumé and cover letter"}</button></div>
          </div>
        </section>
        <section className="space-y-5">{parsed ? <><ResumePreview document={parsed.resume} template={selectedTemplate} /><CoverPreview document={parsed.coverLetter} template={selectedTemplate} /></> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"><FileText className="mx-auto mb-3 size-8" />Enter valid JSON to preview the documents.</div>}</section>
      </div>
    </main>
  );
}

function ResumePreview({ document, template }: { document: ResumeDocument; template: PdfTemplate }) { return <article className={previewClass(template)}><p className={previewLabelClass(template)}>Resume preview · {pdfTemplateLabels[template]}</p><h2 className="mt-3 text-2xl font-bold">{document.candidate.fullName}</h2><p className="text-sm font-medium text-slate-600">{document.candidate.headline ?? document.targetRole}</p><p className="mt-1 text-xs text-slate-500">{[document.candidate.email, document.candidate.phone, document.candidate.location].filter(Boolean).join(" · ")}</p>{document.summary && <p className="mt-5 text-sm leading-6 text-slate-700">{document.summary}</p>}{document.sections.map((section, index) => <section className={template === "compact" ? "mt-3" : "mt-5"} key={`${section.title}-${index}`}><h3 className={`border-b pb-1 text-xs font-bold uppercase tracking-wider ${template === "modern" ? "border-cyan-600 text-cyan-800" : "border-slate-200"}`}>{section.title}</h3>{section.items.map((item, itemIndex) => <div className="mt-3" key={itemIndex}><div className="flex justify-between gap-3 text-sm"><strong>{item.heading}</strong><span className="shrink-0 text-xs text-slate-500">{item.dateRange}</span></div>{item.subheading && <p className="text-xs text-slate-600">{item.subheading}</p>}<ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">{item.bullets?.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet.replaceAll("**", "")}</li>)}</ul></div>)}</section>)}</article>; }
function CoverPreview({ document, template }: { document: CoverLetterDocument; template: PdfTemplate }) { return <article className={previewClass(template)}><p className={previewLabelClass(template)}>Cover letter preview · {pdfTemplateLabels[template]}</p><h2 className="mt-3 text-xl font-bold">{document.candidate.fullName}</h2><p className="text-xs text-slate-500">{document.candidate.email}{document.candidate.phone ? ` · ${document.candidate.phone}` : ""}</p><p className="mt-5 text-sm">{document.date}</p><p className="mt-5 text-sm">{document.salutation ?? "Dear Hiring Manager,"}</p>{document.bodyParagraphs.map((paragraph, index) => <p className="mt-4 text-sm leading-6 text-slate-700" key={index}>{paragraph}</p>)}<p className="mt-5 text-sm">{document.closing ?? "Sincerely,"}<br />{document.signatureName ?? document.candidate.fullName}</p></article>; }

function previewClass(template: PdfTemplate): string {
  return `rounded-xl border bg-white shadow-sm ${template === "modern" ? "border-cyan-200 border-l-4 border-l-cyan-700 p-6" : template === "compact" ? "border-slate-300 p-4" : "border-slate-200 p-6"}`;
}
function previewLabelClass(template: PdfTemplate): string {
  return `text-[10px] font-bold uppercase tracking-widest ${template === "modern" ? "text-cyan-700" : "text-blue-600"}`;
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

async function resumePdf(document: ResumeDocument, template: PdfTemplate): Promise<Uint8Array> {
  const pdf = await createWriter(template, 2);
  pdf.heading(document.candidate.fullName, 19);
  pdf.line([document.candidate.headline ?? document.targetRole, document.candidate.email, document.candidate.phone, document.candidate.linkedinUrl, document.candidate.location].filter(Boolean).join(" | "), 9, "gray");
  if (document.summary) { pdf.section("Professional Summary"); pdf.paragraph(document.summary); }
  for (const section of document.sections) { pdf.section(section.title); for (const item of section.items) { if (item.heading) pdf.heading(`${item.heading}${item.dateRange ? `  |  ${item.dateRange}` : ""}`, 11); if (item.subheading) pdf.line(item.subheading, 9, "gray"); for (const bullet of item.bullets ?? []) pdf.bullet(bullet.replaceAll("**", "")); } }
  return pdf.save();
}
async function coverLetterPdf(document: CoverLetterDocument, template: PdfTemplate): Promise<Uint8Array> {
  const pdf = await createWriter(template, 1);
  pdf.heading(document.candidate.fullName, 17);
  pdf.line([document.candidate.email, document.candidate.phone, document.candidate.linkedinUrl].filter(Boolean).join(" | "), 9, "gray");
  pdf.space(22); pdf.line(document.date ?? new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date()), 10); pdf.space(16);
  pdf.line(document.salutation ?? "Dear Hiring Manager,", 11); pdf.space(8);
  for (const paragraph of document.bodyParagraphs) { pdf.paragraph(paragraph, 11); pdf.space(8); }
  pdf.line(document.closing ?? "Sincerely,", 11); pdf.space(15); pdf.heading(document.signatureName ?? document.candidate.fullName, 11);
  return pdf.save();
}

async function createWriter(template: PdfTemplate, maxPages: number) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create(); const regular = await document.embedFont(StandardFonts.Helvetica); const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28, height = 841.89;
  const style = template === "modern"
    ? { margin: 48, heading: rgb(.04, .36, .55), text: rgb(.08, .12, .18), sectionGap: 10, lineGap: 4 }
    : template === "compact"
      ? { margin: 42, heading: rgb(.12, .15, .2), text: rgb(.08, .1, .13), sectionGap: 4, lineGap: 2 }
      : { margin: 54, heading: rgb(.05, .09, .18), text: rgb(.08, .1, .13), sectionGap: 8, lineGap: 4 };
  const margin = style.margin; let page = document.addPage([width, height]); let y = height - margin;
  const clean = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const ensure = (needed = 18) => { if (y < margin + needed) { if (document.getPageCount() >= maxPages) throw new Error(maxPages === 1 ? "The cover letter exceeds one A4 page. Shorten its paragraphs." : "The résumé exceeds two A4 pages. Shorten its content."); page = document.addPage([width, height]); y = height - margin; } };
  const wrap = (text: string, size: number, maxWidth: number) => { const words = clean(text).split(/\s+/); const lines: string[] = []; let line = ""; for (const word of words) { const next = line ? `${line} ${word}` : word; if (regular.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next; else { lines.push(line); line = word; } } if (line) lines.push(line); return lines; };
  const line = (text: string, size = 10, color: "black" | "gray" = "black") => { for (const part of wrap(text, size, width - margin * 2)) { ensure(size + 5); page.drawText(part, { x: margin, y, size, font: regular, color: color === "gray" ? rgb(.35, .39, .44) : style.text }); y -= size + style.lineGap; } };
  const heading = (text: string, size = 12) => { ensure(size + 7); page.drawText(clean(text), { x: margin, y, size, font: bold, color: style.heading, maxWidth: width - margin * 2 }); y -= size + 6; };
  const paragraph = (text: string, size = 10) => { line(text, size); };
  const section = (text: string) => { y -= style.sectionGap; ensure(24); heading(text.toUpperCase(), 11); page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: template === "modern" ? 1.5 : .7, color: template === "modern" ? style.heading : rgb(.75, .79, .84) }); y -= 5; };
  const bullet = (text: string) => { const parts = wrap(text, 9.5, width - margin * 2 - 15); parts.forEach((part, index) => { ensure(14); page.drawText(index === 0 ? `• ${part}` : `  ${part}`, { x: margin + 6, y, size: 9.5, font: regular, color: rgb(.12, .15, .2) }); y -= 13; }); };
  return { line, heading, paragraph, section, bullet, space(amount: number) { y -= amount; }, async save() { return new Uint8Array(await document.save()); } };
}
function saveBlob(blob: Blob, fileName: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function safePathPart(value: string): string { return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").trim() || "Unknown"; }
function safeFileStem(value: string): string { return safePathPart(value).replace(/\s+/g, "_"); }
function packageTimestamp(date = new Date()): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}-${part(date.getSeconds())}`;
}
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
};
async function writeFile(directory: FileSystemDirectoryHandle, name: string, data: Uint8Array | string): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(typeof data === "string" ? data : new Uint8Array(data));
  await writable.close();
}
