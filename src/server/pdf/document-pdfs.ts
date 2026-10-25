import "server-only";

import type { PdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";
import { DocumentPageLimitError, renderTemplatePdfPackage } from "@/server/pdf/template-pdf";

export { DocumentPageLimitError };

/**
 * Prints the résumé and cover letter from the HTML templates the Resume page previews, for
 * Generation downloads and the Resume page's download button alike. If Chromium cannot print them,
 * the built-in renderer still produces both PDFs. Content over the page limits is not retried
 * there, because the built-in renderer refuses it too.
 */
export async function renderDocumentPdfs(
  data: PdfPackage,
  template: PdfTemplate,
  options: { enforcePageLimits: boolean },
): Promise<{ resume: Uint8Array; coverLetter: Uint8Array }> {
  try {
    return await renderTemplatePdfPackage(data, template, options);
  } catch (error) {
    if (error instanceof DocumentPageLimitError) throw error;
    console.error(
      "Template PDF printing failed; using the built-in PDF renderer.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return renderPdfPackage(data, template);
  }
}
