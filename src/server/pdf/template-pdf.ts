import "server-only";

import { readFile } from "node:fs/promises";
import { DocumentPageLimitError } from "@/app/pdf/document-page-limit-error";
import type { Browser, HTTPRequest } from "puppeteer-core";
import { type PdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";
import { resolveTemplateRenderAsset, templateRenderOrigin } from "@/server/pdf/template-pdf-assets";

const renderTimeoutMs = 25_000;

// The templates compact content first; this check prevents a successful PDF from exceeding
// the résumé and cover-letter page policies without silently truncating content.
const pageLimits = {
  resume: { pages: 3, message: "The résumé exceeds three A4 pages. Its content was not truncated." },
  "cover-letter": { pages: 1, message: "The cover letter exceeds one A4 page. Shorten its paragraphs." },
} as const;

export type TemplatePdfPackage = {
  resume: Uint8Array;
  coverLetter: Uint8Array;
  // The template's own notes, such as "needs about 3 pages"; empty when there are none.
  warnings: { resume: string; coverLetter: string };
};

/**
 * Prints the résumé and cover letter with the HTML templates in public/resume-templates.
 * Callers use the built-in renderer if Chromium fails, except when a document exceeds its page limit.
 */
export async function renderTemplatePdfPackage(
  data: PdfPackage,
  template: PdfTemplate,
  { enforcePageLimits = true }: { enforcePageLimits?: boolean } = {},
): Promise<TemplatePdfPackage> {
  const browser = await getBrowser();
  const templateData = toResumeTemplateData(data, template);
  const [resume, coverLetter] = await Promise.all([
    printDocument(browser, "resume", template, templateData, enforcePageLimits),
    printDocument(browser, "cover-letter", template, templateData, enforcePageLimits),
  ]);
  return {
    resume: resume.pdf,
    coverLetter: coverLetter.pdf,
    warnings: { resume: resume.warnings, coverLetter: coverLetter.warnings },
  };
}

async function printDocument(
  browser: Browser,
  document: "resume" | "cover-letter",
  template: PdfTemplate,
  templateData: ReturnType<typeof toResumeTemplateData>,
  enforcePageLimits: boolean,
): Promise<{ pdf: Uint8Array; warnings: string }> {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (request) => void answerRequest(request));
    // Lay out like the Resume page preview (on screen, the sheet at its full paper width) so
    // automatic compact density is decided the same way; only page.pdf() switches to print.
    await page.setViewport({ width: 1240, height: 1754 });
    await page.evaluateOnNewDocument((value) => {
      (window as unknown as { RESUME_DATA: unknown }).RESUME_DATA = value;
    }, templateData);
    await page.goto(
      `${templateRenderOrigin}/resume-templates/${document}.html?template=${encodeURIComponent(template)}`,
      { waitUntil: "load", timeout: renderTimeoutMs },
    );
    await page.waitForSelector('html[data-render-state="ready"], html[data-render-state="error"]', { timeout: renderTimeoutMs });
    const { state, warnings } = await page.evaluate(() => ({
      state: window.document.documentElement.dataset.renderState,
      warnings: window.document.documentElement.dataset.warnings ?? "",
    }));
    if (state !== "ready") throw new Error(`The ${template} ${document} template did not render.`);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: renderTimeoutMs });
    if (enforcePageLimits) {
      const { PDFDocument } = await import("pdf-lib");
      const limit = pageLimits[document];
      if ((await PDFDocument.load(pdf)).getPageCount() > limit.pages) throw new DocumentPageLimitError(limit.message);
    }
    return { pdf, warnings };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const fileCache = new Map<string, Promise<Buffer>>();

// Template files never change in a deployment; in development they are read fresh, so edits print
// at once instead of after a server restart.
function readCachedFile(filePath: string): Promise<Buffer> {
  if (process.env.NODE_ENV !== "production") return readFile(filePath);
  let file = fileCache.get(filePath);
  if (!file) {
    file = readFile(filePath);
    fileCache.set(filePath, file);
    file.catch(() => fileCache.delete(filePath));
  }
  return file;
}

async function answerRequest(request: HTTPRequest): Promise<void> {
  if (request.isInterceptResolutionHandled()) return;
  const asset = resolveTemplateRenderAsset(request.url());
  if (!asset) {
    await request.abort("blockedbyclient").catch(() => undefined);
    return;
  }
  try {
    const body = await readCachedFile(asset.filePath);
    await request.respond({ status: 200, contentType: asset.contentType, body });
  } catch {
    await request.respond({ status: 404, contentType: "text/plain", body: "" }).catch(() => undefined);
  }
}

let browserPromise: Promise<Browser> | null = null;

// One Chromium per server instance, shared by concurrent renders; a crashed or closed
// browser, or a failed launch, is relaunched on the next render.
function getBrowser(): Promise<Browser> {
  browserPromise ??= launchBrowser().then(
    (browser) => {
      browser.once("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    },
    (error: unknown) => {
      browserPromise = null;
      throw error;
    },
  );
  return browserPromise;
}

async function launchBrowser(): Promise<Browser> {
  const { default: puppeteer } = await import("puppeteer-core");
  // Local development (Windows or macOS) prints with an installed Chrome or Edge.
  const localExecutable = process.env.PDF_CHROME_EXECUTABLE_PATH?.trim();
  if (localExecutable) {
    return puppeteer.launch({ executablePath: localExecutable, headless: true });
  }
  if (process.platform !== "linux") {
    throw new Error("Set PDF_CHROME_EXECUTABLE_PATH to a local Chrome or Edge to print template PDFs on this computer.");
  }
  const { default: chromium } = await import("@sparticuz/chromium");
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}
