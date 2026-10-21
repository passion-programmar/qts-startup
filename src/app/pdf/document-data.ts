export type DocumentCandidate = {
  fullName: string;
  email: string;
  phone?: string;
  linkedinUrl?: string;
  location?: string;
  headline?: string;
};
export type ResumeDocument = {
  candidate: DocumentCandidate;
  targetRole: string;
  targetCompany?: string;
  targetJobsite?: string;
  summary?: string;
  sections: { title: string; items: { heading?: string; subheading?: string; dateRange?: string; bullets?: string[] }[] }[];
};
export type CoverLetterDocument = {
  candidate: DocumentCandidate;
  targetRole: string;
  targetCompany: string;
  date?: string;
  salutation?: string;
  bodyParagraphs: string[];
  closing?: string;
  signatureName?: string;
};
export type PdfPackage = {
  resume: ResumeDocument;
  coverLetter: CoverLetterDocument;
};

export function parsePdfPackage(source: string): PdfPackage {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error("Enter valid JSON."); }
  if (!record(value) || !record(value.resume) || !record(value.coverLetter)) throw new Error("JSON must contain resume and coverLetter objects.");
  const resume = value.resume;
  const coverLetter = value.coverLetter;
  const resumeCandidate = candidate(resume.candidate, "resume");
  const coverCandidate = candidate(coverLetter.candidate, "coverLetter");
  const targetRole = required(resume.targetRole, "resume.targetRole", 300);
  const sectionsRaw = resume.sections;
  if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0 || sectionsRaw.length > 20) throw new Error("resume.sections must contain 1 to 20 sections.");
  const sections = sectionsRaw.map((section, sectionIndex) => {
    if (!record(section)) throw new Error(`resume.sections[${sectionIndex}] must be an object.`);
    const itemsRaw = section.items;
    if (!Array.isArray(itemsRaw) || itemsRaw.length === 0 || itemsRaw.length > 50) throw new Error(`resume.sections[${sectionIndex}].items must contain 1 to 50 items.`);
    return {
      title: required(section.title, `resume.sections[${sectionIndex}].title`, 300),
      items: itemsRaw.map((item, itemIndex) => {
        if (!record(item)) throw new Error(`Resume item ${itemIndex + 1} is invalid.`);
        const bullets = item.bullets;
        if (bullets !== undefined && (!Array.isArray(bullets) || bullets.length > 50 || !bullets.every((bullet) => typeof bullet === "string" && bullet.length <= 500))) throw new Error("Resume bullets must be strings of 500 characters or fewer.");
        return { heading: optional(item.heading, 500), subheading: optional(item.subheading, 500), dateRange: optional(item.dateRange, 200), bullets: bullets as string[] | undefined };
      }),
    };
  });
  const paragraphs = coverLetter.bodyParagraphs;
  if (!Array.isArray(paragraphs) || paragraphs.length < 1 || paragraphs.length > 6 || !paragraphs.every((paragraph) => typeof paragraph === "string" && paragraph.trim() && paragraph.length <= 900)) throw new Error("coverLetter.bodyParagraphs must contain 1 to 6 text paragraphs of 900 characters or fewer.");
  if (normalize(resumeCandidate.fullName) !== normalize(coverCandidate.fullName) || normalize(resumeCandidate.email) !== normalize(coverCandidate.email)) {
    throw new Error("Resume and cover-letter candidate names and email addresses must match.");
  }
  const coverRole = required(coverLetter.targetRole, "coverLetter.targetRole", 300);
  const coverCompany = required(coverLetter.targetCompany, "coverLetter.targetCompany", 500);
  if (normalize(targetRole) !== normalize(coverRole)) {
    throw new Error("Resume and cover-letter target roles must match.");
  }
  if (resume.targetCompany && normalize(String(resume.targetCompany)) !== normalize(coverCompany)) {
    throw new Error("Resume and cover-letter target companies must match.");
  }
  return {
    resume: { candidate: resumeCandidate, targetRole, targetCompany: optional(resume.targetCompany, 500), targetJobsite: optional(resume.targetJobsite, 2048), summary: optional(resume.summary, 5000), sections },
    coverLetter: { candidate: coverCandidate, targetRole: coverRole, targetCompany: coverCompany, date: optional(coverLetter.date, 100), salutation: optional(coverLetter.salutation, 300), bodyParagraphs: paragraphs.map((paragraph) => paragraph.trim()), closing: optional(coverLetter.closing, 300), signatureName: optional(coverLetter.signatureName, 300) },
  };
}
function candidate(value: unknown, path: string): DocumentCandidate { if (!record(value)) throw new Error(`${path}.candidate must be an object.`); const email = required(value.email, `${path}.candidate.email`, 320); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${path}.candidate.email must be valid.`); return { fullName: required(value.fullName, `${path}.candidate.fullName`, 300), email, phone: optional(value.phone, 100), linkedinUrl: optional(value.linkedinUrl, 2048), location: optional(value.location, 500), headline: optional(value.headline, 500) }; }
function required(value: unknown, path: string, max: number): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${path} is required and must be ${max} characters or fewer.`); return value.trim(); }
function optional(value: unknown, max: number): string | undefined { if (value === undefined || value === null || value === "") return undefined; if (typeof value !== "string" || value.length > max) throw new Error(`Optional text fields must be ${max} characters or fewer.`); return value.trim() || undefined; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function normalize(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en"); }
