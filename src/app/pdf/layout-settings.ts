// One-time layout settings for the Resume page (/pdf): the Manager edits them for the preview and
// the PDFs downloaded from that page. They are not saved anywhere and never reach Generation, which
// builds its own print job. They travel in the document's theme, which render.js
// (public/resume-templates/js/render.js) applies and parseTheme (document-data.ts) checks.
//
// Ranges only stop values that break printing; anything else is allowed.

export type LayoutNumberSetting = {
  key: string;
  group: "Text sizes" | "Spacing" | "Page margins" | "Page fitting";
  label: string;
  unit: "pt" | "mm" | "";
  min: number;
  max: number;
  step: number;
  // Shown when a value is in this range: allowed, but worth a second look.
  warnBelow?: number;
  warning?: string;
};

export const layoutNumberSettings: readonly LayoutNumberSetting[] = [
  { key: "nameSize", group: "Text sizes", label: "Name", unit: "pt", min: 4, max: 72, step: 0.5 },
  { key: "headlineSize", group: "Text sizes", label: "Headline", unit: "pt", min: 4, max: 40, step: 0.5 },
  { key: "contactSize", group: "Text sizes", label: "Contact line", unit: "pt", min: 4, max: 30, step: 0.25, warnBelow: 8, warning: "Under 8pt the contact line is hard to read." },
  { key: "sectionSize", group: "Text sizes", label: "Section titles", unit: "pt", min: 4, max: 40, step: 0.5 },
  { key: "itemSize", group: "Text sizes", label: "Role / company", unit: "pt", min: 4, max: 40, step: 0.5, warnBelow: 9, warning: "Under 9pt is hard for recruiters to read." },
  { key: "bodySize", group: "Text sizes", label: "Body text", unit: "pt", min: 4, max: 40, step: 0.5, warnBelow: 9, warning: "Under 9pt is hard for recruiters to read." },
  { key: "bulletSize", group: "Text sizes", label: "Bullets", unit: "pt", min: 4, max: 40, step: 0.5, warnBelow: 9, warning: "Under 9pt is hard for recruiters to read." },
  { key: "metaSize", group: "Text sizes", label: "Dates / location", unit: "pt", min: 4, max: 30, step: 0.5, warnBelow: 8, warning: "Under 8pt is hard to read." },
  { key: "fontScale", group: "Text sizes", label: "Scale all text", unit: "", min: 0.95, max: 1.15, step: 0.01 },
  { key: "sectionGap", group: "Spacing", label: "Between sections", unit: "pt", min: 0, max: 60, step: 0.5 },
  { key: "itemGap", group: "Spacing", label: "Between jobs", unit: "pt", min: 0, max: 60, step: 0.5 },
  { key: "titleGap", group: "Spacing", label: "Under section titles", unit: "pt", min: 0, max: 40, step: 0.5 },
  { key: "headerGap", group: "Spacing", label: "Under the header", unit: "pt", min: 0, max: 60, step: 0.5 },
  { key: "bulletGap", group: "Spacing", label: "Between bullets", unit: "pt", min: 0, max: 30, step: 0.5 },
  { key: "lineHeight", group: "Spacing", label: "Line height", unit: "", min: 0.8, max: 3, step: 0.01, warnBelow: 1.1, warning: "Under 1.1 lines start to touch." },
  { key: "marginTop", group: "Page margins", label: "Top", unit: "mm", min: 0, max: 60, step: 0.5 },
  { key: "marginSide", group: "Page margins", label: "Left and right", unit: "mm", min: 0, max: 60, step: 0.5, warnBelow: 8, warning: "Under 8mm some printers cut text at the edge." },
  { key: "marginBottom", group: "Page margins", label: "Bottom", unit: "mm", min: 0, max: 60, step: 0.5 },
  { key: "minTextSize", group: "Page fitting", label: "Smallest text when fitting", unit: "pt", min: 4, max: 20, step: 0.5, warnBelow: 9, warning: "Fitting may shrink text under 9pt." },
];

export type LayoutChoiceSetting = {
  key: string;
  group: "Page fitting" | "Look";
  label: string;
  values: readonly string[];
};

// Body and heading fonts, as public/resume-templates/js/templates.js lists them (a test keeps them equal).
const fonts = ["arial", "georgia", "times", "calibri", "cambria", "palatino", "verdana", "tahoma", "trebuchet", "mono"] as const;

export const layoutChoiceSettings: readonly LayoutChoiceSetting[] = [
  { key: "fitPages", group: "Page fitting", label: "Page target", values: ["auto", "1", "2", "3", "4", "5"] },
  { key: "density", group: "Page fitting", label: "Density", values: ["auto", "normal", "compact"] },
  // The options of window.RESUME_OPTIONS in templates.js (a test keeps them equal).
  { key: "headerStyle", group: "Look", label: "Header", values: ["plain-rule", "accent-top", "band", "side-bar", "centered-rules", "centered-plain"] },
  { key: "headerAlign", group: "Look", label: "Header alignment", values: ["start", "center"] },
  { key: "titleStyle", group: "Look", label: "Section titles", values: ["rule", "plain", "band", "bar", "pill", "flanked", "topline", "double", "overbar", "underbar", "marker", "underline"] },
  { key: "titleCase", group: "Look", label: "Title case", values: ["upper", "title", "lower"] },
  { key: "entryLayout", group: "Look", label: "Entry layout", values: ["A", "B", "C", "D", "E", "F", "G"] },
  { key: "datePosition", group: "Look", label: "Dates", values: ["inline", "below", "parentheses"] },
  { key: "bulletStyle", group: "Look", label: "Bullets", values: ["disc", "dash", "chevron"] },
  { key: "itemStyle", group: "Look", label: "Entries", values: ["plain", "divided", "timeline", "bordered"] },
  { key: "summaryStyle", group: "Look", label: "Summary", values: ["plain", "boxed", "quote"] },
  { key: "skillsLayout", group: "Look", label: "Skills layout", values: ["rows", "compact", "grid", "bubbles"] },
  { key: "skillDetail", group: "Look", label: "Skill details", values: ["colon", "dash", "bracket"] },
  { key: "letterLayout", group: "Look", label: "Letter layout", values: ["block", "modified"] },
  { key: "fontFamily", group: "Look", label: "Body font", values: fonts },
  { key: "headingFont", group: "Look", label: "Heading font", values: fonts },
  { key: "paper", group: "Look", label: "Paper", values: ["A4", "letter"] },
];

// Look options that make ATS parsing less reliable: shown as a warning, never blocked.
export const layoutChoiceWarnings: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  entryLayout: Object.fromEntries(["A", "B", "D", "E", "F", "G"].map((value) => [value,
    "Every template uses C: role and dates, then company and location, which ATS parsers read most reliably."])),
  skillsLayout: { grid: "A grid of skills can be read across columns by some ATS parsers." },
};

export const layoutColorSettings = [
  { key: "accentColor", label: "Accent colour" },
  { key: "keywordColor", label: "Bold keyword colour" },
] as const;

export type LayoutTheme = Partial<Record<string, string | number | boolean>>;

const numberSetting = new Map(layoutNumberSettings.map((setting) => [setting.key, setting]));
const choiceSetting = new Map(layoutChoiceSettings.map((setting) => [setting.key, setting]));

/** The layout settings in a theme, checked; throws a message naming the setting when one is invalid. */
export function parseLayoutTheme(value: Record<string, unknown>): LayoutTheme {
  const layout: LayoutTheme = {};
  for (const [key, setting] of numberSetting) {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const number = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(number) || number < setting.min || number > setting.max) {
      throw new Error(`theme.${key} must be a number from ${setting.min} to ${setting.max}${setting.unit ? ` ${setting.unit}` : ""}.`);
    }
    layout[key] = number;
  }
  for (const [key, setting] of choiceSetting) {
    const raw = value[key];
    if (raw === undefined || raw === null || raw === "") continue;
    // density and paper keep their older, more specific checks in parseTheme.
    if (key === "density" || key === "paper") continue;
    if (!setting.values.includes(String(raw))) {
      throw new Error(`theme.${key} must be one of: ${setting.values.join(", ")}.`);
    }
    layout[key] = String(raw);
  }
  return layout;
}

/** The theme the Resume page sends: only the settings the Manager changed. */
export function layoutThemeFromForm(form: Readonly<Record<string, string>>): LayoutTheme {
  const theme: LayoutTheme = {};
  for (const setting of layoutNumberSettings) {
    const value = form[setting.key]?.trim();
    if (value) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= setting.min && number <= setting.max) theme[setting.key] = number;
    }
  }
  for (const setting of layoutChoiceSettings) {
    const value = form[setting.key];
    if (value && setting.values.includes(value)) theme[setting.key] = value;
  }
  for (const setting of layoutColorSettings) {
    const value = form[setting.key];
    if (value && /^#[0-9a-f]{6}$/i.test(value)) theme[setting.key] = value;
  }
  if (form.showPageNumbers === "yes") theme.showPageNumbers = true;
  return theme;
}

/** A saved style as the Resume page's form values (the reverse of layoutThemeFromForm). */
export function layoutFormFromTheme(theme: Readonly<LayoutTheme> | undefined): Record<string, string> {
  const form: Record<string, string> = {};
  if (!theme) return form;
  for (const [key, value] of Object.entries(theme)) {
    if (key === "showPageNumbers") {
      if (value === true) form.showPageNumbers = "yes";
    } else if (typeof value === "number" || typeof value === "string") {
      form[key] = String(value);
    }
  }
  return form;
}

/** A saved style with only valid settings kept (anything unknown or out of range is dropped). */
export function cleanLayoutTheme(value: unknown): LayoutTheme {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return layoutThemeFromForm(layoutFormFromTheme(value as LayoutTheme));
}
