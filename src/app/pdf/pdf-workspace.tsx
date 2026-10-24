"use client";

import html2canvas from "html2canvas";
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PdfPackage } from "@/app/pdf/document-data";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import { paginatePdfCanvas } from "@/app/pdf/pdf-pagination";
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

type ResumeDownloadDirectory = FileSystemDirectoryHandle & {
  queryPermission: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission: (options: { mode: "readwrite" }) => Promise<PermissionState>;
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
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
      startIn?: "downloads";
    }) => Promise<ResumeDownloadDirectory>;
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
  const [previewSource, setPreviewSource] = useState(example);
  const [previewPackage, setPreviewPackage] = useState(samplePreviewData);
  const [error, setError] = useState<string | null>(
    () => initialDocumentError(),
  );
  const [busy, setBusy] = useState(false);
  const [downloadDirectoryName, setDownloadDirectoryName] = useState<string | null>(null);
  const [downloadDirectoryReady, setDownloadDirectoryReady] = useState(false);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const pendingPreviewRef = useRef<PendingPreview | null>(null);
  const activeDocumentRef = useRef<PreviewDocumentType>("resume");
  const downloadDirectoryRef = useRef<ResumeDownloadDirectory | null>(null);
  const templateData = useMemo(
    () => toResumeTemplateData(previewPackage, selectedTemplate),
    [previewPackage, selectedTemplate],
  );
  const previewOutOfDate = source !== previewSource;
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
          setError(reason instanceof Error ? reason.message : "The saved download folder could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setDownloadDirectoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
    const root = previewHostRef.current?.querySelector<HTMLElement>(".qts-document-host");
    if (
      activeDocumentRef.current === documentType
      && previewStatus === "ready"
      && root?.dataset.document === documentType
      && root.dataset.renderState === "ready"
    ) {
      return Promise.resolve();
    }
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
          ? "Folder selection was canceled; the previously saved folder is unchanged."
          : reason instanceof Error
            ? reason.message
            : "The download folder could not be saved.",
      );
    }
  }

  async function downloadPair() {
    const startingDocument = activeDocumentRef.current;
    try {
      if (!parsed) throw new Error("Enter valid résumé and cover-letter JSON before downloading.");
      setBusy(true);
      setError(null);
      const directory = await getDownloadDirectoryForSave(
        downloadDirectoryRef.current,
        (selected) => {
          downloadDirectoryRef.current = selected;
          setDownloadDirectoryName(selected.name);
        },
      );
      const resume = await captureDocument("resume");
      const coverLetter = await captureDocument("cover-letter");
      if (startingDocument !== "cover-letter") {
        await prepareDocument(startingDocument);
      }
      const candidateName = safePathPart(parsed.resume.candidate.fullName);
      const jobTitle = safePathPart(parsed.resume.targetRole);
      const company = safePathPart(parsed.resume.targetCompany ?? parsed.coverLetter.targetCompany);
      const folder = `QTS_Resume/${safePathPart(managerName)}/${candidateName}/${packageTimestamp()}_${jobTitle}_${company}`;
      const files = [
        { name: `${candidateName}.pdf`, bytes: resume },
        { name: `${candidateName}_Cover_Letter.pdf`, bytes: coverLetter },
      ];
      if (directory) {
        await savePdfPairToDirectory(directory, folder, files);
      } else {
        downloadPdfPairInBrowser(files);
      }
    } catch (reason) {
      setError(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "Folder selection was canceled; no PDFs were saved."
          : reason instanceof Error
            ? reason.message
            : "The resume and cover letter could not be downloaded.",
      );
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
            <div className="mt-4">
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !parsed || previewOutOfDate || previewStatus !== "ready" || !downloadDirectoryReady}
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
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState("");
  const [initialPreview] = useState(() => ({ documentData, documentType }));

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
      // The extension highlighter skips marked subtrees, keeping its marks out of the preview and PDF.
      root.setAttribute("data-qts-text-highlight", "");
      root.lang = documentData.theme.language ?? "en";
      root.dir = documentData.theme.direction ?? "ltr";
      const mount = root.querySelector<HTMLElement>("#resume-root")
        ?? document.createElement("main");
      mount.id = "resume-root";
      mount.className = "is-embed";
      if (mount.parentElement !== root) root.replaceChildren(mount);
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
      if (cancelled || !result) return;
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
    <div ref={hostRef} className="min-h-[calc(100dvh-14rem)] overflow-auto rounded-sm bg-white shadow-xl shadow-slate-900/15 xl:min-h-[calc(100dvh-16rem)]">
      <div
        className="qts-document-host is-embed"
        data-qts-text-highlight=""
        data-document={initialPreview.documentType}
        data-render-state="loading"
        dir={initialPreview.documentData.theme.direction ?? "ltr"}
        lang={initialPreview.documentData.theme.language ?? "en"}
      >
        <main className="is-embed" id="resume-root">
          <StaticDocumentPreview
            documentData={initialPreview.documentData}
            documentType={initialPreview.documentType}
          />
        </main>
      </div>
    </div>
  </section>;
}

function StaticDocumentPreview({
  documentData,
  documentType,
}: {
  documentData: ReturnType<typeof toResumeTemplateData>;
  documentType: PreviewDocumentType;
}) {
  const { candidate, resume, coverLetter } = documentData;
  const articleStyle = {
    boxSizing: "border-box" as const,
    color: "#1a1a1a",
    fontFamily: "Arial, sans-serif",
    fontSize: "10.5pt",
    lineHeight: 1.4,
    margin: 0,
    maxWidth: "none",
    minHeight: "297mm",
    padding: "15mm 16mm 17mm",
    width: "210mm",
  };
  const contactValues = [
    candidate.email,
    candidate.phone,
    candidate.location,
    candidate.linkedinUrl,
    ...(candidate.links ?? []).map((link) => link.url),
  ].filter((value): value is string => Boolean(value));
  const header = (
    <header className="resume-header" style={{ borderBottom: "1px solid #b4bec8", marginBottom: "12pt", paddingBottom: "9pt" }}>
      <h1 className="candidate-name" style={{ color: "#1f3a5f", fontSize: "22pt", fontWeight: 700 }}>
        {candidate.fullName}
      </h1>
      {(candidate.headline || resume.targetRole) && (
        <p className="candidate-headline" style={{ color: "#4a4f55", marginTop: "3pt" }}>
          {candidate.headline || resume.targetRole}
        </p>
      )}
      {contactValues.length > 0 && (
        <address className="contact" style={{ fontSize: "9.5pt", fontStyle: "normal", marginTop: "5pt" }}>
          <ul className="contact-list" style={{ display: "flex", flexWrap: "wrap", gap: "3pt 10pt", listStyle: "none" }}>
            {contactValues.map((value) => <li key={value}><bdi>{value}</bdi></li>)}
          </ul>
        </address>
      )}
    </header>
  );

  if (documentType === "cover-letter") {
    const recipient = coverLetter.recipient;
    const recipientLines = [
      recipient?.name,
      recipient?.title,
      recipient?.company || coverLetter.targetCompany,
      ...(recipient?.address ?? []),
    ].filter((value): value is string => Boolean(value));
    return (
      <article className="doc letter sheet doc--uniform-content" style={articleStyle}>
        {header}
        <div className="doc-body letter-body" style={{ display: "grid", gap: "12pt" }}>
          {coverLetter.date && <p className="letter-date">{coverLetter.date}</p>}
          {recipientLines.length > 0 && (
            <div className="letter-recipient">
              {recipientLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
            </div>
          )}
          <h2 className="letter-subject">{coverLetter.subject || `Re: ${resume.targetRole}`}</h2>
          <p className="letter-greeting">{coverLetter.greeting || `Dear ${recipient?.name || "Hiring Manager"},`}</p>
          {coverLetter.paragraphs.map((paragraph, index) => (
            <p className="letter-paragraph" key={`${index}-${paragraph}`}>{fallbackRichText(paragraph)}</p>
          ))}
          <div className="letter-signoff">
            <p className="letter-closing">{coverLetter.closing || "Sincerely,"}</p>
            <p className="letter-signature">{coverLetter.signature || candidate.fullName}</p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="doc resume sheet doc--uniform-content" style={articleStyle}>
      {header}
      <div className="doc-body resume-body">
        {resume.summary && (
          <section aria-labelledby="section-summary" className="section section--summary" style={{ marginBottom: "12pt" }}>
            <h2 className="section-title" id="section-summary" style={{ borderBottom: "1px solid #b4bec8", color: "#1f3a5f", fontWeight: 700, marginBottom: "5pt" }}>
              Summary
            </h2>
            <p className="summary">{fallbackRichText(resume.summary)}</p>
          </section>
        )}
        {resume.sections.map((section, index) => {
          const sectionKey = (section.id || fallbackSectionSlug(section.title)).toLowerCase();
          const headingId = `section-${index + (resume.summary ? 1 : 0)}`;
          return (
            <section
              aria-labelledby={headingId}
              className={section.type === "skills" ? "section section--skills" : "section"}
              data-section={sectionKey}
              key={sectionKey}
              style={{ marginBottom: "12pt" }}
            >
              <h2 className="section-title" id={headingId} style={{ borderBottom: "1px solid #b4bec8", color: "#1f3a5f", fontWeight: 700, marginBottom: "5pt" }}>
                {section.title}
              </h2>
              {section.type === "skills"
                ? <div className="skills">{section.items.map((item, itemIndex) => {
                    const skills = item.bullets ?? [];
                    return (
                      <div className="skill-group" key={`${itemIndex}-${item.heading ?? ""}`}>
                        {item.heading && <h3 className="skill-group-title">{item.heading}:</h3>}
                        <ul className="skill-list" style={{ display: "flex", flexWrap: "wrap", gap: "3pt 10pt", listStyle: "none" }}>
                          {skills.map((skill, skillIndex) => {
                            const name = typeof skill === "string" ? skill : skill.name;
                            const detail = typeof skill === "string" ? "" : skill.detail;
                            return (
                              <li className="skill" key={`${skillIndex}-${name}`}>
                                <span className="skill-name">{fallbackRichText(name)}</span>
                                {detail && <span className="skill-detail"> ({detail})</span>}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}</div>
                : section.items.map((item, itemIndex) => (
                    <div className="item" key={`${itemIndex}-${item.heading ?? ""}`} style={{ marginBottom: "7pt" }}>
                      {(item.heading || item.dateRange) && (
                        <div className="item-header">
                          {item.heading && <h3 className="item-heading" style={{ display: "inline", fontWeight: 700 }}>{item.heading}</h3>}
                          {item.dateRange && <p className="item-date" style={{ display: "inline", marginLeft: "6pt" }}>{item.dateRange}</p>}
                        </div>
                      )}
                      {item.subheading && <p className="item-subheading" style={{ color: "#4a4f55" }}>{item.subheading}</p>}
                      {item.description && <p className="item-description">{fallbackRichText(item.description)}</p>}
                      {item.bullets && item.bullets.length > 0 && (
                        <ul className="item-bullets" style={{ paddingInlineStart: "10pt" }}>
                          {item.bullets.map((bullet, bulletIndex) => (
                            <li key={`${bulletIndex}-${typeof bullet === "string" ? bullet : bullet.name}`}>
                              {typeof bullet === "string" ? fallbackRichText(bullet) : <>{fallbackRichText(bullet.name)}{bullet.detail && ` (${bullet.detail})`}</>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
            </section>
          );
        })}
      </div>
    </article>
  );
}

function fallbackRichText(value: string) {
  return value.split(/(\*\*[^*]+?\*\*)/g).map((part, index) => {
    const keyword = /^\*\*([^*]+?)\*\*$/.exec(part);
    return keyword
      ? <strong className="keyword" key={index}>{keyword[1]}</strong>
      : part;
  });
}

function fallbackSectionSlug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z\d]+/g, "-").replace(/^-+|-+$/g, "");
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
        try {
          scopeResumeStyles(style);
        } catch (reason) {
          style.remove();
          throw reason;
        }
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
  const host = ".qts-document-host";
  let scoped = selector
    .replace(/:root\b/g, host)
    .replace(/(^|[\s>+~])html(?=$|[\s.#:[>+~])/g, `$1${host}`)
    .replace(/(^|[\s>+~])body(?=$|[\s.#:[>+~])/g, `$1${host}`);
  scoped = scoped
    .replace(/^\.is-embed(?=$|[\s>+~.#:[\]])/, `${host}.is-embed`)
    .replace(new RegExp(`^${host}\\.is-embed\\s+${host}(?=$|[\\s>+~.#:[\\]])`), `${host}.is-embed`)
    .replace(/^\[dir=(["']?)(ltr|rtl)\1\]\s+\.qts-document-host$/, `${host}[dir="$2"]`);
  return scoped === selector ? `${host} ${selector}` : scoped;
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
  if (
    !host
    || !root
    || !article
    || root.dataset.document !== documentType
    || root.dataset.renderState !== "ready"
  ) {
    throw new Error(`The ${documentType} preview is not ready to download.`);
  }

  await document.fonts.ready;
  const pageWidthMm = cssMillimeters(window.getComputedStyle(root).getPropertyValue("--page-width"));
  const pageHeightMm = cssMillimeters(window.getComputedStyle(root).getPropertyValue("--page-height"));
  const pageMarginTopMm = cssMillimeters(window.getComputedStyle(root).getPropertyValue("--page-margin-top"));
  const pageMarginBottomMm = cssMillimeters(window.getComputedStyle(root).getPropertyValue("--page-margin-bottom"));
  const pageContentHeightMm = pageHeightMm - pageMarginTopMm - pageMarginBottomMm;
  if (pageContentHeightMm <= 0) {
    throw new Error("The preview has invalid page margins.");
  }
  const pageWidthPoints = pageWidthMm * 72 / 25.4;
  const pageHeightPoints = pageHeightMm * 72 / 25.4;
  const canvas = await html2canvas(article, {
    backgroundColor: "#ffffff",
    height: article.scrollHeight,
    logging: false,
    onclone: (clonedDocument, clonedArticle) => {
      movePdfTitleRulesBelowText(clonedDocument, clonedArticle);
      materializePdfBulletMarkers(clonedDocument, clonedArticle);
    },
    scale: 2,
    useCORS: true,
    width: article.scrollWidth,
    windowHeight: Math.max(document.documentElement.clientHeight, article.scrollHeight),
    windowWidth: Math.max(document.documentElement.clientWidth, article.scrollWidth),
    scrollX: 0,
    scrollY: 0,
  });

  const pixelsPerMm = canvas.width / pageWidthMm;
  const articleRect = article.getBoundingClientRect();
  const cssPixelsPerMm = articleRect.width / pageWidthMm;
  const breakConstraints = Array.from(article.querySelectorAll<HTMLElement>(
    ".resume-header, .section--summary, .section-title, .item-header, .item-subheading, .item-link, "
      + ".item-bullets li, .doc:not([data-skills-layout=\"compact\"]) .skill-group, "
      + ".letter-recipient, .letter-signoff, .letter-subject, .letter-greeting",
  ))
    .map((element) => {
      const style = window.getComputedStyle(element);
      if (style.breakInside !== "avoid" && style.breakAfter !== "avoid") return null;
      const bounds = element.getBoundingClientRect();
      return {
        startMm: (bounds.top - articleRect.top) / cssPixelsPerMm,
        endMm: (bounds.bottom - articleRect.top) / cssPixelsPerMm,
      };
    })
    .filter((range): range is { startMm: number; endMm: number } => range !== null);
  const pageSlices = paginatePdfCanvas(
    canvas.height / pixelsPerMm,
    pageHeightMm,
    pageMarginTopMm,
    pageMarginBottomMm,
    breakConstraints,
  );
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const pageSlice of pageSlices) {
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = Math.ceil(pixelsPerMm * pageHeightMm);
    const context = pageCanvas.getContext("2d");
    if (!context) throw new Error("The browser could not prepare a PDF page.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    const sourceY = Math.round(pageSlice.sourceStartMm * pixelsPerMm);
    const sourceHeight = Math.max(
      0,
      Math.min(
        Math.round(pageSlice.sourceEndMm * pixelsPerMm) - sourceY,
        canvas.height - sourceY,
      ),
    );
    if (sourceHeight) {
      const destinationY = Math.round(pageMarginTopMm * pixelsPerMm);
      context.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceHeight,
        0,
        destinationY,
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

function movePdfTitleRulesBelowText(clonedDocument: Document, article: HTMLElement): void {
  article.querySelectorAll<HTMLElement>(".section-title, .letter-subject").forEach((title) => {
    const style = clonedDocument.defaultView?.getComputedStyle(title);
    if (!style || style.borderBottomStyle === "none" || Number.parseFloat(style.borderBottomWidth) <= 0) {
      return;
    }

    const rule = clonedDocument.createElement("span");
    rule.setAttribute("aria-hidden", "true");
    rule.style.position = "absolute";
    rule.style.insetInline = "0";
    rule.style.bottom = "-10px";
    rule.style.borderTop = `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`;
    title.style.position = style.position === "static" ? "relative" : style.position;
    title.style.borderBottomColor = "transparent";
    title.append(rule);
  });
}

function materializePdfBulletMarkers(clonedDocument: Document, article: HTMLElement): void {
  const markerByStyle: Record<string, string> = {
    chevron: "›",
    dash: "–",
    disc: "•",
  };
  const markerText = markerByStyle[article.dataset.bulletStyle ?? ""] ?? markerByStyle.disc;

  article.querySelectorAll<HTMLElement>(".item-bullets li").forEach((item) => {
    const markerStyle = clonedDocument.defaultView?.getComputedStyle(item, "::marker");
    const marker = clonedDocument.createElement("span");
    marker.setAttribute("aria-hidden", "true");
    marker.dataset.pdfBulletMarker = "true";
    marker.textContent = markerText;
    marker.style.display = "inline-block";
    marker.style.width = "0";
    marker.style.marginInlineStart = "-15pt";
    marker.style.marginInlineEnd = "15pt";
    marker.style.whiteSpace = "nowrap";
    if (markerStyle) {
      marker.style.color = markerStyle.color;
      marker.style.fontFamily = markerStyle.fontFamily;
      marker.style.fontSize = markerStyle.fontSize;
      marker.style.fontWeight = markerStyle.fontWeight;
      marker.style.lineHeight = markerStyle.lineHeight;
    }
    item.style.listStyleType = "none";
    item.prepend(marker);
  });
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
