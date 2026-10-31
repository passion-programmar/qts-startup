import "server-only";

import type { PdfPackage } from "@/app/pdf/document-data";
import { DocumentPageLimitError } from "@/app/pdf/document-page-limit-error";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";
import {
  renderTemplatePdfPackage,
  type TemplatePdfPackage,
} from "@/server/pdf/template-pdf";

export { DocumentPageLimitError };

export type DocumentPdfs = TemplatePdfPackage & {
  // "fallback" when Chromium could not print and the built-in renderer produced the files.
  renderer: "template" | "fallback";
};

/**
 * Prints the résumé and cover letter from the HTML templates for Generation downloads and the
 * Resume page's download button alike. If Chromium cannot print them, the built-in
 * renderer still produces both PDFs. Content over the page limits is not retried there, because
 * the built-in renderer refuses it too.
 */
export async function renderDocumentPdfs(
  data: PdfPackage,
  template: PdfTemplate,
  options: { enforcePageLimits: boolean },
): Promise<DocumentPdfs> {
  try {
    return { ...await renderTemplatePdfPackage(data, template, options), renderer: "template" };
  } catch (error) {
    if (error instanceof DocumentPageLimitError) throw error;
    console.error(
      "Template PDF printing failed; using the built-in PDF renderer.",
      error instanceof Error ? error.message : "Unknown error",
    );
    const pdfs = await renderPdfPackage(data, template);
    return { ...pdfs, renderer: "fallback", warnings: { resume: "", coverLetter: "" } };
  }
}
