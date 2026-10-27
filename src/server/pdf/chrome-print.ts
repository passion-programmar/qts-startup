import "server-only";

import { type PdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";

// What a Chrome needs to print the résumé and cover letter itself, the way template-pdf.ts does:
// the template and the data its page reads (window.RESUME_DATA). Printing there spends no server
// time; the extension asks the server to print only when that fails.
export type ChromePrintJob = {
  template: PdfTemplate;
  data: ReturnType<typeof toResumeTemplateData>;
};

export function chromePrintJob(data: PdfPackage, template: PdfTemplate): ChromePrintJob {
  return { template, data: toResumeTemplateData(data, template) };
}

/** True when the extension asked to print in its own Chrome (?print=chrome). */
export function wantsChromePrint(request: Request): boolean {
  return new URL(request.url).searchParams.get("print") === "chrome";
}
