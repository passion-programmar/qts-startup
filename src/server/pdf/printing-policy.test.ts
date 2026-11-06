import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { PDFDocument } from "pdf-lib";
import { DocumentPageLimitError } from "@/app/pdf/document-page-limit-error";
import type { PdfPackage } from "@/app/pdf/document-data";

// Exercise production print/count/fallback code with browser I/O stubbed and real PDF bytes.
function loadModule(file: string, imports: Record<string, unknown>): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const testModule = { exports: {} };
  const code = transformSync(readFileSync(file, "utf8"), {
    loader: "ts", format: "cjs", supported: { "dynamic-import": false },
  }).code;
  vm.runInNewContext(code, {
    module: testModule, exports: testModule.exports, console: { error: () => {} },
    process: { env: { PDF_CHROME_EXECUTABLE_PATH: "test-browser" } },
    require: (id: string) => {
      if (id in imports) return imports[id];
      if (id === "server-only" || id === "node:fs/promises") return {};
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return testModule.exports;
}

async function pdfBytes(pages: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([595.28, 841.89]);
  return pdf.save();
}

test("server template printing enforces actual three/one-page limits and closes pages", async () => {
  for (const [resumePages, coverPages] of [[3, 1], [4, 1], [3, 2]]) {
    let closed = 0;
    const resume = await pdfBytes(resumePages);
    const coverLetter = await pdfBytes(coverPages);
    const browser = {
      once: () => {},
      newPage: async () => {
        let isResume = true;
        return {
          setRequestInterception: async () => {}, on: () => {}, setViewport: async () => {},
          evaluateOnNewDocument: async () => {}, waitForSelector: async () => {},
          goto: async (url: string) => { isResume = url.includes("/resume.html"); },
          evaluate: async () => ({ state: "ready", warnings: "" }),
          pdf: async () => isResume ? resume : coverLetter,
          close: async () => { closed += 1; },
        };
      },
    };
    const printing = loadModule("src/server/pdf/template-pdf.ts", {
      "puppeteer-core": { launch: async () => browser },
      "pdf-lib": { PDFDocument },
      "@/app/pdf/document-data": { toResumeTemplateData: (data: PdfPackage) => data },
      "@/app/pdf/document-page-limit-error": { DocumentPageLimitError },
      "@/server/pdf/template-pdf-assets": { templateRenderOrigin: "https://qts.test" },
    });
    const result = printing.renderTemplatePdfPackage({}, "minimal", { enforcePageLimits: true });
    if (resumePages > 3 || coverPages > 1) {
      await assert.rejects(result, (error: unknown) => error instanceof DocumentPageLimitError);
    } else {
      const bytes = await result as { resume: Uint8Array; coverLetter: Uint8Array };
      assert.equal((await PDFDocument.load(bytes.resume)).getPageCount(), 3);
      assert.equal((await PDFDocument.load(bytes.coverLetter)).getPageCount(), 1);
    }
    // Both documents print concurrently; let the other page's finally finish too.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, 2);
  }
});

test("server fallback handles technical failures but never hides page-limit errors", async () => {
  for (const limitError of [false, true]) {
    let fallbackCalls = 0;
    const printing = loadModule("src/server/pdf/document-pdfs.ts", {
      "@/app/pdf/document-page-limit-error": { DocumentPageLimitError },
      "@/server/pdf/template-pdf": { renderTemplatePdfPackage: async () => {
        throw limitError ? new DocumentPageLimitError("Too many pages") : new Error("Browser failed");
      } },
      "@/app/pdf/pdf-renderer": { renderPdfPackage: async () => {
        fallbackCalls += 1;
        return { resume: await pdfBytes(1), coverLetter: await pdfBytes(1) };
      } },
    });
    const result = printing.renderDocumentPdfs({}, "minimal", { enforcePageLimits: true });
    if (limitError) {
      await assert.rejects(result, (error: unknown) => error instanceof DocumentPageLimitError);
      assert.equal(fallbackCalls, 0);
    } else {
      assert.equal((await result as { renderer: string }).renderer, "fallback");
      assert.equal(fallbackCalls, 1);
    }
  }
});
