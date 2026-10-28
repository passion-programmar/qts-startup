import type { PdfTemplate } from "@/server/pdf/pdf-templates";

// One resume JSON serves every template. Its sections carry these fixed ids; each template
// decides which of them it shows and in what order. The summary is not a section: it is
// resume.summary and always comes first.

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
export const requiredResumeSectionIds: readonly ResumeSectionId[] = ["skills", "experience", "education"];

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

// The order each template shows its sections in, after the summary, listed by template number.
// Each shows Projects or Career Highlights, never both: Career Highlights straight after the
// summary, Projects as the last section. Skills, Experience and Education follow the template's
// own order, then Certifications. A section missing from the JSON is simply left out.
export const templateSectionOrders: Record<PdfTemplate, readonly ResumeSectionId[]> = {
  startup: ["career_highlights", "skills", "experience", "education", "certifications"], // QTS Template 1
  centered: ["career_highlights", "education", "skills", "experience", "certifications"], // QTS Template 2
  corporate: ["career_highlights", "education", "experience", "skills", "certifications"], // QTS Template 3
  ledger: ["career_highlights", "experience", "education", "skills", "certifications"], // QTS Template 4
  bold: ["education", "experience", "skills", "certifications", "projects"], // QTS Template 5
  technical: ["skills", "experience", "education", "certifications", "projects"], // QTS Template 6
  professional: ["career_highlights", "education", "experience", "skills", "certifications"], // QTS Template 7
  executive: ["career_highlights", "experience", "skills", "education", "certifications"], // QTS Template 8
  timeline: ["career_highlights", "experience", "skills", "education", "certifications"], // QTS Template 9
  graphite: ["skills", "experience", "education", "certifications", "projects"], // QTS Template 10
  "modern-serif": ["experience", "education", "skills", "certifications", "projects"], // QTS Template 11
  compact: ["career_highlights", "experience", "skills", "education", "certifications"], // QTS Template 12
  minimal: ["skills", "experience", "education", "certifications", "projects"], // QTS Template 13
  harvard: ["education", "experience", "skills", "certifications", "projects"], // QTS Template 14
  nordic: ["career_highlights", "skills", "education", "experience", "certifications"], // QTS Template 15
  academic: ["education", "experience", "skills", "certifications", "projects"], // QTS Template 16
  swiss: ["experience", "skills", "education", "certifications", "projects"], // QTS Template 17
  slate: ["career_highlights", "skills", "experience", "education", "certifications"], // QTS Template 18
  "high-contrast": ["career_highlights", "experience", "skills", "education", "certifications"], // QTS Template 19
  classic: ["career_highlights", "experience", "education", "skills", "certifications"], // QTS Template 20
  "qts-standard": ["experience", "skills", "education", "certifications", "projects"], // QTS Template 21
  elegant: ["career_highlights", "education", "experience", "skills", "certifications"], // QTS Template 22
  creative: ["skills", "experience", "education", "certifications", "projects"], // QTS Template 23
  banded: ["experience", "education", "skills", "certifications", "projects"], // QTS Template 24
};

/**
 * The sections a template prints for a résumé that has these sections, in print order. When the
 * résumé lacks the template's own choice of Projects or Career Highlights but has the other, the
 * other prints in its place: Career Highlights after the summary, Projects last.
 */
export function shownSectionIds(template: PdfTemplate, has: readonly string[]): ResumeSectionId[] {
  const order = templateSectionOrders[template] ?? templateSectionOrders["qts-standard"];
  const own = order.includes("projects") ? "projects" : "career_highlights";
  const other = own === "projects" ? "career_highlights" : "projects";
  const shown = has.includes(own) ? own : has.includes(other) ? other : null;
  const core = order.filter((id) => id !== "projects" && id !== "career_highlights");
  if (shown === "career_highlights") return ["career_highlights", ...core];
  if (shown === "projects") return [...core, "projects"];
  return core;
}

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
  projects: "Projects",
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
  const order = shownSectionIds(template, sections.filter((section) => section.items.length).map((section) => section.id ?? ""));
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
