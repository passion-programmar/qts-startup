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
// Each shows Projects or Career Highlights, never both, and ends with Certifications; a section
// missing from the JSON is simply left out.
export const templateSectionOrders: Record<PdfTemplate, readonly ResumeSectionId[]> = {
  startup: ["skills", "career_highlights", "experience", "education", "certifications"], // QTS Template 1
  centered: ["education", "skills", "experience", "career_highlights", "certifications"], // QTS Template 2
  corporate: ["career_highlights", "education", "experience", "skills", "certifications"], // QTS Template 3
  ledger: ["experience", "career_highlights", "education", "skills", "certifications"], // QTS Template 4
  bold: ["projects", "education", "experience", "skills", "certifications"], // QTS Template 5
  technical: ["skills", "projects", "experience", "education", "certifications"], // QTS Template 6
  professional: ["education", "career_highlights", "experience", "skills", "certifications"], // QTS Template 7
  executive: ["career_highlights", "experience", "skills", "education", "certifications"], // QTS Template 8
  timeline: ["experience", "career_highlights", "skills", "education", "certifications"], // QTS Template 9
  graphite: ["skills", "experience", "projects", "education", "certifications"], // QTS Template 10
  "modern-serif": ["projects", "experience", "education", "skills", "certifications"], // QTS Template 11
  compact: ["experience", "skills", "education", "career_highlights", "certifications"], // QTS Template 12
  minimal: ["skills", "experience", "education", "projects", "certifications"], // QTS Template 13
  harvard: ["education", "experience", "projects", "skills", "certifications"], // QTS Template 14
  nordic: ["skills", "education", "experience", "career_highlights", "certifications"], // QTS Template 15
  academic: ["education", "projects", "experience", "skills", "certifications"], // QTS Template 16
  swiss: ["projects", "experience", "skills", "education", "certifications"], // QTS Template 17
  slate: ["career_highlights", "skills", "experience", "education", "certifications"], // QTS Template 18
  "high-contrast": ["experience", "skills", "career_highlights", "education", "certifications"], // QTS Template 19
  classic: ["career_highlights", "experience", "education", "skills", "certifications"], // QTS Template 20
  "qts-standard": ["experience", "skills", "projects", "education", "certifications"], // QTS Template 21
  elegant: ["education", "experience", "career_highlights", "skills", "certifications"], // QTS Template 22
  creative: ["projects", "skills", "experience", "education", "certifications"], // QTS Template 23
  banded: ["experience", "education", "skills", "projects", "certifications"], // QTS Template 24
};

/** The sections a template shows, in its order. Sections it does not list are left out. */
export function orderResumeSections<T extends { id?: string }>(
  sections: readonly T[],
  template: PdfTemplate,
): T[] {
  const order = templateSectionOrders[template] ?? templateSectionOrders["qts-standard"];
  return order.flatMap((sectionId) => sections.filter((section) => section.id === sectionId));
}
