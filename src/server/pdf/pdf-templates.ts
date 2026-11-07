// The 13 designs in use. A saved document whose template was removed (11 archived designs, 2026-11-06)
// prints with qts-standard (generation-documents.ts).
export const pdfTemplateSupportedValues = [
  "startup", "centered", "corporate", "ledger", "executive", "graphite",
  "minimal", "nordic", "academic", "classic", "qts-standard", "creative", "banded",
] as const;
export type PdfTemplate = (typeof pdfTemplateSupportedValues)[number];

// Active templates, in the order used for new selections and Generation rotation.
export const pdfTemplateValues = [
  "startup", "minimal", "classic", "centered", "corporate", "creative",
  "nordic", "ledger", "banded", "executive", "academic", "graphite", "qts-standard",
] as const satisfies readonly PdfTemplate[];

export type LegacyPdfTemplate =
  | "heritage" | "laurel" | "vellum" | "pewter" | "regent" | "onyx"
  | "palette" | "indigo" | "amber-crest" | "garnet" | "reef" | "verdant"
  | "ember" | "terminal" | "meridian" | "flowcv";

export function isPdfTemplate(value: string): value is PdfTemplate {
  return (pdfTemplateSupportedValues as readonly string[]).includes(value);
}

export const pdfTemplateLabels: Record<PdfTemplate, string> = {
  startup: "QTS Template 1",
  centered: "QTS Template 4",
  corporate: "QTS Template 5",
  ledger: "QTS Template 8",
  executive: "QTS Template 10",
  graphite: "QTS Template 12",
  minimal: "QTS Template 2",
  nordic: "QTS Template 7",
  academic: "QTS Template 11",
  classic: "QTS Template 3",
  "qts-standard": "QTS Template 13",
  creative: "QTS Template 6",
  banded: "QTS Template 9",
};

export type PdfTemplateDesign = {
  accent: readonly [number, number, number];
  ink: readonly [number, number, number];
  muted: readonly [number, number, number];
  font: "sans" | "serif" | "mono";
  align: "left" | "center";
  header: "plain" | "rule" | "double-rule" | "band" | "card" | "soft";
  sectionHeadingLayout: "plain" | "rule" | "double-rule" | "band" | "pill" | "marker" | "card" | "left-full-rule" | "compact-underline" | "centered-rules";
  skillsLayout: "grouped-inline" | "grouped-columns" | "grouped-stacked" | "flat-inline";
  margin: number;
  compact: boolean;
};

const ink = [0.08, 0.1, 0.14] as const;
const muted = [0.34, 0.38, 0.43] as const;

export const pdfTemplateDesigns: Record<PdfTemplate | LegacyPdfTemplate, PdfTemplateDesign> = {
  "qts-standard": design([0.12, 0.23, 0.37], "sans", "left", "rule", "rule", "grouped-inline", 48),
  classic: design([0.12, 0.13, 0.15], "serif", "left", "double-rule", "double-rule", "grouped-stacked", 54),
  executive: design([0.48, 0.08, 0.14], "serif", "left", "band", "left-full-rule", "grouped-inline", 48),
  minimal: design([0.35, 0.38, 0.42], "sans", "left", "plain", "plain", "flat-inline", 62),
  corporate: design([0.12, 0.25, 0.42], "sans", "left", "soft", "pill", "grouped-inline", 50),
  banded: design([0.16, 0.3, 0.46], "sans", "left", "band", "band", "grouped-inline", 48),
  creative: design([0.48, 0.2, 0.55], "sans", "left", "soft", "pill", "grouped-inline", 48),
  academic: design([0.15, 0.17, 0.2], "serif", "left", "rule", "left-full-rule", "grouped-stacked", 52),
  nordic: design([0.2, 0.4, 0.38], "sans", "left", "soft", "plain", "grouped-inline", 54),
  ledger: design([0.25, 0.32, 0.38], "mono", "left", "plain", "compact-underline", "grouped-inline", 48),
  startup: design([0.08, 0.48, 0.48], "sans", "left", "card", "marker", "grouped-inline", 48),
  centered: design([0.22, 0.24, 0.27], "serif", "center", "double-rule", "centered-rules", "grouped-stacked", 54),
  graphite: design([0.2, 0.22, 0.25], "sans", "left", "soft", "pill", "grouped-inline", 50),
  heritage: design([0.15, 0.17, 0.2], "serif", "center", "double-rule", "double-rule", "grouped-stacked", 52),
  laurel: design([0.25, 0.31, 0.27], "serif", "center", "rule", "left-full-rule", "grouped-inline", 54),
  vellum: design([0.12, 0.13, 0.15], "sans", "center", "double-rule", "centered-rules", "grouped-stacked", 54),
  pewter: design([0.32, 0.38, 0.44], "sans", "left", "soft", "pill", "grouped-inline", 50),
  regent: design([0.12, 0.18, 0.28], "serif", "center", "rule", "centered-rules", "grouped-inline", 52),
  onyx: design([0.72, 0.52, 0.17], "sans", "left", "card", "marker", "grouped-inline", 46),
  palette: design([0.02, 0.47, 0.48], "sans", "left", "plain", "marker", "grouped-inline", 48),
  indigo: design([0.23, 0.19, 0.59], "sans", "left", "rule", "left-full-rule", "grouped-inline", 48),
  "amber-crest": design([0.83, 0.55, 0.12], "serif", "left", "band", "left-full-rule", "grouped-inline", 48),
  garnet: design([0.48, 0.08, 0.14], "serif", "center", "plain", "compact-underline", "grouped-stacked", 54),
  reef: design([0.02, 0.49, 0.48], "sans", "left", "rule", "rule", "grouped-inline", 48),
  verdant: design([0.04, 0.35, 0.28], "sans", "center", "plain", "band", "grouped-inline", 50),
  ember: design([0.87, 0.32, 0.08], "sans", "left", "plain", "marker", "grouped-stacked", 48),
  terminal: design([0.18, 0.72, 0.47], "mono", "left", "card", "compact-underline", "grouped-inline", 44),
  meridian: design([0.3, 0.3, 0.32], "serif", "center", "plain", "plain", "flat-inline", 62),
  flowcv: design([0, 0, 0], "serif", "center", "plain", "rule", "grouped-inline", 51),
};

function design(
  accent: readonly [number, number, number],
  font: PdfTemplateDesign["font"],
  align: PdfTemplateDesign["align"],
  header: PdfTemplateDesign["header"],
  sectionHeadingLayout: PdfTemplateDesign["sectionHeadingLayout"],
  skillsLayout: PdfTemplateDesign["skillsLayout"],
  margin: number,
): PdfTemplateDesign {
  return { accent, ink, muted, font, align, header, sectionHeadingLayout, skillsLayout, margin, compact: margin <= 46 };
}
