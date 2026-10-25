import "server-only";

import { readFile } from "node:fs/promises";
import type { Browser, HTTPRequest } from "puppeteer-core";
import { type PdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";
import {
  resolveTemplateRenderAsset,
  templateFontStylesheet,
  templateFontStylesheetPath,
  templateRenderOrigin,
} from "@/server/pdf/template-pdf-assets";

const renderTimeoutMs = 25_000;

/**
 * Prints the résumé and cover letter with the same HTML templates the Resume page previews,
 * so downloaded PDFs match the preview. Callers fall back to the built-in renderer on error.
 */
export async function renderTemplatePdfPackage(
  data: PdfPackage,
  template: PdfTemplate,
): Promise<{ resume: Uint8Array; coverLetter: Uint8Array }> {
  const browser = await getBrowser();
  const templateData = toResumeTemplateData(data, template);
  const [resume, coverLetter] = await Promise.all([
    printDocument(browser, "resume", template, templateData),
    printDocument(browser, "cover-letter", template, templateData),
  ]);
  return { resume, coverLetter };
}

async function printDocument(
  browser: Browser,
  document: "resume" | "cover-letter",
  template: PdfTemplate,
  templateData: ReturnType<typeof toResumeTemplateData>,
): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (request) => void answerRequest(request));
    // Layout is measured for print, so page fitting matches the printed result.
    await page.emulateMediaType("print");
    await page.evaluateOnNewDocument((value) => {
      (window as unknown as { RESUME_DATA: unknown }).RESUME_DATA = value;
    }, templateData);
    await page.goto(
      `${templateRenderOrigin}/resume-templates/${document}.html?template=${encodeURIComponent(template)}`,
      { waitUntil: "load", timeout: renderTimeoutMs },
    );
    await page.waitForSelector('html[data-render-state="ready"], html[data-render-state="error"]', { timeout: renderTimeoutMs });
    const state = await page.evaluate(() => window.document.documentElement.dataset.renderState);
    if (state !== "ready") throw new Error(`The ${template} ${document} template did not render.`);
    return await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: renderTimeoutMs });
  } finally {
    await page.close().catch(() => undefined);
  }
}

const fileCache = new Map<string, Promise<Buffer>>();

function readCachedFile(filePath: string): Promise<Buffer> {
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
    if (asset.kind === "font-stylesheet") {
      await request.respond({ status: 200, contentType: "text/css; charset=utf-8", body: await templateFontStylesheet() });
      return;
    }
    let body: Buffer | string = await readCachedFile(asset.filePath);
    if (asset.contentType.startsWith("text/html")) {
      body = body.toString("utf8").replace("</head>", `  <link rel="stylesheet" href="${templateFontStylesheetPath}">\n</head>`);
    }
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
