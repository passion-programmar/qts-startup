export const pdfTemplateValues = [
  "heritage", "laurel", "vellum", "pewter", "regent", "orchid", "onyx",
  "palette", "ivory", "azure", "pillar", "barrister", "indigo",
  "amber-crest", "garnet", "reef", "verdant", "parchment", "vanguard",
  "axis", "admiral", "seafoam", "ember", "terminal", "aurelia",
  "portrait", "basalt", "ripple", "meridian", "sentinel",
] as const;
export type PdfTemplate = (typeof pdfTemplateValues)[number];

export function isPdfTemplate(value: string): value is PdfTemplate {
  return pdfTemplateValues.includes(value as PdfTemplate);
}

export const pdfTemplateLabels: Record<PdfTemplate, string> = {
  heritage: "Heritage",
  laurel: "Laurel",
  vellum: "Vellum",
  pewter: "Pewter",
  regent: "Regent",
  orchid: "Orchid",
  onyx: "Onyx",
  palette: "Palette",
  ivory: "Ivory",
  azure: "Azure",
  pillar: "Pillar",
  barrister: "Barrister",
  indigo: "Indigo",
  "amber-crest": "Amber Crest",
  garnet: "Garnet",
  reef: "Reef",
  verdant: "Verdant",
  parchment: "Parchment",
  vanguard: "Vanguard",
  axis: "Axis",
  admiral: "Admiral",
  seafoam: "Seafoam",
  ember: "Ember",
  terminal: "Terminal",
  aurelia: "Aurelia",
  portrait: "Portrait",
  basalt: "Basalt",
  ripple: "Ripple",
  meridian: "Meridian",
  sentinel: "Sentinel",
};

export type PdfTemplateDesign = {
  accent: readonly [number, number, number];
  ink: readonly [number, number, number];
  muted: readonly [number, number, number];
  font: "sans" | "serif" | "mono";
  align: "left" | "center";
  header: "plain" | "rule" | "double-rule" | "band" | "card" | "soft";
  section: "plain" | "rule" | "double-rule" | "band" | "pill" | "marker" | "card";
  margin: number;
  compact: boolean;
};

const ink = [0.08, 0.1, 0.14] as const;
const muted = [0.34, 0.38, 0.43] as const;

export const pdfTemplateDesigns: Record<PdfTemplate, PdfTemplateDesign> = {
  heritage: design([0.15, 0.17, 0.2], "serif", "center", "double-rule", "double-rule", 52),
  laurel: design([0.25, 0.31, 0.27], "serif", "center", "rule", "rule", 54),
  vellum: design([0.24, 0.26, 0.29], "sans", "center", "plain", "rule", 58),
  pewter: design([0.32, 0.38, 0.44], "sans", "left", "soft", "pill", 50),
  regent: design([0.12, 0.18, 0.28], "serif", "center", "rule", "rule", 52),
  orchid: design([0.38, 0.08, 0.28], "sans", "center", "band", "rule", 48),
  onyx: design([0.72, 0.52, 0.17], "sans", "left", "card", "marker", 46),
  palette: design([0.02, 0.47, 0.48], "sans", "left", "plain", "marker", 48),
  ivory: design([0.32, 0.31, 0.28], "sans", "center", "plain", "rule", 60),
  azure: design([0.18, 0.45, 0.72], "sans", "left", "soft", "pill", 48),
  pillar: design([0.18, 0.2, 0.22], "sans", "left", "plain", "marker", 52),
  barrister: design([0.16, 0.2, 0.28], "serif", "center", "rule", "double-rule", 54),
  indigo: design([0.23, 0.19, 0.59], "sans", "left", "rule", "rule", 48),
  "amber-crest": design([0.83, 0.55, 0.12], "serif", "left", "band", "rule", 48),
  garnet: design([0.48, 0.08, 0.14], "serif", "center", "plain", "rule", 54),
  reef: design([0.02, 0.49, 0.48], "sans", "left", "rule", "rule", 48),
  verdant: design([0.04, 0.35, 0.28], "sans", "center", "plain", "band", 50),
  parchment: design([0.22, 0.2, 0.17], "serif", "center", "double-rule", "rule", 58),
  vanguard: design([0.04, 0.2, 0.38], "sans", "left", "rule", "band", 48),
  axis: design([0.04, 0.46, 0.48], "sans", "left", "plain", "marker", 46),
  admiral: design([0.03, 0.16, 0.34], "serif", "center", "plain", "band", 48),
  seafoam: design([0.05, 0.38, 0.34], "sans", "left", "rule", "rule", 50),
  ember: design([0.87, 0.32, 0.08], "sans", "left", "plain", "marker", 48),
  terminal: design([0.18, 0.72, 0.47], "mono", "left", "card", "marker", 44),
  aurelia: design([0.55, 0.39, 0.15], "serif", "center", "plain", "marker", 56),
  portrait: design([0.12, 0.13, 0.15], "sans", "left", "plain", "rule", 52),
  basalt: design([0.15, 0.18, 0.23], "serif", "left", "band", "rule", 46),
  ripple: design([0.2, 0.48, 0.72], "sans", "left", "soft", "marker", 48),
  meridian: design([0.3, 0.3, 0.32], "serif", "center", "plain", "plain", 62),
  sentinel: design([0.03, 0.13, 0.28], "sans", "left", "band", "card", 44),
};

function design(
  accent: readonly [number, number, number],
  font: PdfTemplateDesign["font"],
  align: PdfTemplateDesign["align"],
  header: PdfTemplateDesign["header"],
  section: PdfTemplateDesign["section"],
  margin: number,
): PdfTemplateDesign {
  return { accent, ink, muted, font, align, header, section, margin, compact: margin <= 46 };
}
