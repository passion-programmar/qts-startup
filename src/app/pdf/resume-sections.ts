import type { PdfTemplate } from "@/server/pdf/pdf-templates";

// One resume JSON serves every template. Its sections carry these fixed ids; each template
// decides the order of the ones it shows. The summary is not a section: it is resume.summary
// and always comes first. Career Highlights and Certifications are still recognised in older
// JSON, so "Key Achievements" is not read as Experience, but no template prints them.

export const resumeSectionIds = [
  "skills",
  "experience",
  "education",
  "projects",
  "career_highlights",
  "certifications",
] as const;
export type ResumeSectionId = (typeof resumeSectionIds)[number];

/** Generated JSON must fill these; the others may be empty. */
export const requiredResumeSectionIds: readonly ResumeSectionId[] = ["skills", "experience", "education", "projects"];

// Checked in this order, so "Project Experience" is a project and "Key Achievements" a highlight.
const sectionPatterns: [RegExp, ResumeSectionId | null][] = [
  [/\blanguages?\b|\bvolunteer/i, null],
  [/highlight|achievement|accomplishment/i, "career_highlights"],
  [/project/i, "projects"],
  [/education|academic|qualification|degree/i, "education"],
  [/certif|licen[cs]e/i, "certifications"],
  [/experience|employment|work history|career history/i, "experience"],
  [/skill|competenc|technolog|tool|expertise/i, "skills"],
];

/**
 * The fixed id of a section, read from its id or, failing that, its title. Null for sections
 * no template shows (Languages, Volunteering, anything unrecognised), which are dropped.
 */
export function resumeSectionId(id: string | undefined, title: string): ResumeSectionId | null {
  const exact = id?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (exact && (resumeSectionIds as readonly string[]).includes(exact)) return exact as ResumeSectionId;
  for (const value of [id, title]) {
    if (!value) continue;
    for (const [pattern, sectionId] of sectionPatterns) {
      if (pattern.test(value)) return sectionId;
    }
  }
  return null;
}

// The four orders of the printed sections after the summary. Education is always first or last,
// and Selected Projects always follow Experience.
const orderA = ["experience", "projects", "skills", "education"] as const;
const orderB = ["skills", "experience", "projects", "education"] as const;
const orderC = ["education", "experience", "projects", "skills"] as const;
const orderD = ["education", "skills", "experience", "projects"] as const;
export const sectionOrders = [orderA, orderB, orderC, orderD] as const;

// Section order stays attached to each design ID so saved documents render as before. Generation
// rotates only the active template IDs; its selection order is defined in pdf-templates.ts.
export const templateSectionOrders: Record<PdfTemplate, readonly ResumeSectionId[]> = {
  startup: orderA, // QTS Template 1
  centered: orderB, // QTS Template 4
  corporate: orderC, // QTS Template 5
  ledger: orderD, // QTS Template 8
  executive: orderD, // QTS Template 10
  graphite: orderB, // QTS Template 12
  minimal: orderA, // QTS Template 2
  nordic: orderC, // QTS Template 7
  academic: orderD, // QTS Template 11
  classic: orderD, // QTS Template 3
  "qts-standard": orderA, // QTS Template 13
  creative: orderC, // QTS Template 6
  banded: orderD, // QTS Template 9
};

type PrintableItem = {
  focus?: string[];
  subheading?: string;
  location?: string;
  workMode?: string;
  dateRange?: string;
  bullets?: (string | { name: string; detail?: string })[];
};

// Every template prints these titles, whatever the JSON calls a section: ATS parsers find sections
// by short, standard headings ("Core Technical Skills" is missed by some).
export const resumeSectionTitles: Record<ResumeSectionId, string> = {
  skills: "Skills",
  experience: "Professional Experience",
  education: "Education",
  projects: "Selected Projects",
  career_highlights: "Career Highlights",
  certifications: "Certifications",
};

/**
 * The sections a template shows, in its order and with their standard titles, as every template
 * prints them. Sections it does not list are left out. Content rules shared by all templates:
 * - Projects show only their name, a "Technologies:" line (the entry's focus) and bullets.
 * - Education entries have no bullets.
 * - Skills are names only, without years or levels.
 * - Jobs print no focus skills (an ATS reads that line as the company); the data keeps up to 3.
 */
export function orderResumeSections<T extends { id?: string; title?: string; items: PrintableItem[] }>(
  sections: readonly T[],
  template: PdfTemplate,
): T[] {
  const order = templateSectionOrders[template] ?? templateSectionOrders["qts-standard"];
  return order.flatMap((sectionId) => sections
    .filter((section) => section.id === sectionId)
    .map((section) => ({
      ...section,
      title: resumeSectionTitles[sectionId],
      items: section.items.map((item) => printableItem(sectionId, item)),
    })));
}

/**
 * Whether an entry prints anything once the rules above apply, as render.js decides it: an
 * education entry made only of bullets, or a skills group without a skill, prints nothing.
 */
export function printsInSection(
  sectionId: ResumeSectionId,
  item: PrintableItem & { heading?: string; description?: string; link?: string },
): boolean {
  const printed = printableItem(sectionId, item);
  const bullets = (printed.bullets ?? []).some((bullet) => (typeof bullet === "string" ? bullet : bullet.name).trim());
  if (sectionId === "skills") return bullets;
  return Boolean(
    printed.heading?.trim()
    || printed.subheading?.trim()
    || printed.dateRange?.trim()
    || printed.description?.trim()
    || (sectionId !== "projects" && printed.link?.trim())
    || bullets,
  );
}

function printableItem<I extends PrintableItem>(sectionId: ResumeSectionId, item: I): I {
  switch (sectionId) {
    case "projects":
      return { ...item, subheading: undefined, location: undefined, workMode: undefined, dateRange: undefined };
    case "education":
      return { ...item, bullets: [], focus: undefined };
    case "skills":
      return { ...item, bullets: item.bullets?.map((bullet) => (typeof bullet === "string" ? bullet : bullet.name)) };
    default:
      return { ...item, focus: item.focus?.slice(0, 3) };
  }
}
