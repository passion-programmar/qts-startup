export const pdfTemplateValues = ["professional", "modern", "compact"] as const;
export type PdfTemplate = (typeof pdfTemplateValues)[number];

export function isPdfTemplate(value: string): value is PdfTemplate {
  return pdfTemplateValues.includes(value as PdfTemplate);
}

export const pdfTemplateLabels: Record<PdfTemplate, string> = {
  professional: "Professional",
  modern: "Modern",
  compact: "Compact",
};
