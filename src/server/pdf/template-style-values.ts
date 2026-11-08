import type { PdfPackage } from "@/app/pdf/document-data";
import { cleanLayoutTheme, type LayoutTheme } from "@/app/pdf/layout-settings";
import { isPdfTemplate, type PdfTemplate } from "@/server/pdf/pdf-templates";

// Each Manager's saved layout style per template (Resume page "Save as my style"), stored in the
// settings table under templateStylesKey: { "<template>": { nameSize: 20, ... } }. Generation prints
// that Manager's résumés with the style of the template it uses; the page rule still runs on top.
// Pure values here; reading and saving are in template-styles.ts.

export type TemplateStyles = Partial<Record<PdfTemplate, LayoutTheme>>;

export const templateStylesKey = (managerId: string) => `pdf-template-styles:${managerId}`;

/** The stored value, cleaned: only current templates and valid settings. */
export function readTemplateStyles(value: unknown): TemplateStyles {
  const styles: TemplateStyles = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return styles;
  for (const [template, style] of Object.entries(value)) {
    if (!isPdfTemplate(template)) continue;
    const clean = cleanLayoutTheme(style);
    if (Object.keys(clean).length) styles[template] = clean;
  }
  return styles;
}

/** The document with the Manager's style for this template in its theme (unchanged without one). */
export function withTemplateStyle(data: PdfPackage, styles: TemplateStyles, template: PdfTemplate): PdfPackage {
  const style = styles[template];
  return style && Object.keys(style).length ? { ...data, theme: { ...data.theme, ...style } } : data;
}
