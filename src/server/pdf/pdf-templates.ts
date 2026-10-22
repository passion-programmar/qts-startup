export const pdfTemplateValues = [
  "heritage", "laurel", "vellum", "pewter", "regent", "onyx", "palette",
  "indigo", "amber-crest", "garnet", "reef", "verdant", "ember",
  "terminal", "meridian",
] as const;
export type PdfTemplate = (typeof pdfTemplateValues)[number];

export function isPdfTemplate(value: string): value is PdfTemplate {
  return pdfTemplateValues.includes(value as PdfTemplate);
}

export const pdfTemplateLabels: Record<PdfTemplate, string> = {
  heritage: "Template_1",
  laurel: "Template_2",
  vellum: "Template_3",
  pewter: "Template_4",
  regent: "Template_5",
  onyx: "Template_7",
  palette: "Template_8",
  indigo: "Template_13",
  "amber-crest": "Template_14",
  garnet: "Template_15",
  reef: "Template_16",
  verdant: "Template_17",
  ember: "Template_23",
  terminal: "Template_24",
  meridian: "Template_29",
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

export const pdfTemplateDesigns: Record<PdfTemplate, PdfTemplateDesign> = {
  heritage: design([0.15, 0.17, 0.2], "serif", "center", "double-rule", "double-rule", "grouped-stacked", 52),
  laurel: design([0.25, 0.31, 0.27], "serif", "center", "rule", "left-full-rule", "grouped-inline", 54),
  vellum: design([0.12, 0.13, 0.15], "sans", "center", "double-rule", "centered-rules", "grouped-stacked", 54),
  pewter: design([0.32, 0.38, 0.44], "sans", "left", "soft", "pill", "grouped-columns", 50),
  regent: design([0.12, 0.18, 0.28], "serif", "center", "rule", "centered-rules", "grouped-columns", 52),
  onyx: design([0.72, 0.52, 0.17], "sans", "left", "card", "marker", "grouped-columns", 46),
  palette: design([0.02, 0.47, 0.48], "sans", "left", "plain", "marker", "grouped-inline", 48),
  indigo: design([0.23, 0.19, 0.59], "sans", "left", "rule", "left-full-rule", "grouped-inline", 48),
  "amber-crest": design([0.83, 0.55, 0.12], "serif", "left", "band", "left-full-rule", "grouped-columns", 48),
  garnet: design([0.48, 0.08, 0.14], "serif", "center", "plain", "compact-underline", "grouped-stacked", 54),
  reef: design([0.02, 0.49, 0.48], "sans", "left", "rule", "rule", "grouped-inline", 48),
  verdant: design([0.04, 0.35, 0.28], "sans", "center", "plain", "band", "grouped-columns", 50),
  ember: design([0.87, 0.32, 0.08], "sans", "left", "plain", "marker", "grouped-stacked", 48),
  terminal: design([0.18, 0.72, 0.47], "mono", "left", "card", "compact-underline", "grouped-inline", 44),
  meridian: design([0.3, 0.3, 0.32], "serif", "center", "plain", "plain", "flat-inline", 62),
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
