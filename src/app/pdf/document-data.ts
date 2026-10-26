import {
  orderResumeSections,
  requiredResumeSectionIds,
  resumeSectionId,
} from "@/app/pdf/resume-sections";
import type { PdfTemplate } from "@/server/pdf/pdf-templates";

export type DocumentSkill = {
  name: string;
  detail?: string;
};

export type DocumentBullet = string | DocumentSkill;

export type DocumentLink = {
  label?: string;
  url: string;
};

export type DocumentCandidate = {
  fullName: string;
  email: string;
  phone?: string;
  linkedinUrl?: string;
  location?: string;
  headline?: string;
  links?: DocumentLink[];
};

export type ResumeDocument = {
  candidate: DocumentCandidate;
  targetRole: string;
  targetCompany?: string;
  targetJobsite?: string;
  summary?: string;
  sections: {
    id?: string;
    title: string;
    type?: "standard" | "skills";
    items: {
      // Role, degree, project or certification name.
      heading?: string;
      // 1-3 key skills; the templates that show them put them next to the heading.
      focus?: string[];
      // Company, school or issuer.
      subheading?: string;
      location?: string;
      workMode?: WorkMode;
      // Printed as "Apr 2025 – Present", built from startDate/endDate when the JSON has them.
      dateRange?: string;
      description?: string;
      link?: string;
      bullets?: DocumentBullet[];
    }[];
  }[];
};

export type WorkMode = "Remote" | "Hybrid" | "Onsite";

export type CoverLetterRecipient = {
  name?: string;
  title?: string;
  company?: string;
  address?: string[];
};

export type CoverLetterDocument = {
  candidate: DocumentCandidate;
  targetRole: string;
  targetCompany: string;
  date?: string;
  salutation?: string;
  recipient?: CoverLetterRecipient;
  subject?: string;
  bodyParagraphs: string[];
  closing?: string;
  signatureName?: string;
};

export type DocumentTheme = {
  sectionOrder?: string[];
  hiddenSections?: string[];
  density?: "auto" | "normal" | "compact";
  paper?: "A4" | "letter";
  language?: string;
  direction?: "ltr" | "rtl" | "auto";
  showPageNumbers?: boolean;
  accentColor?: string;
  keywordColor?: string;
};

export type PdfPackage = {
  resume: ResumeDocument;
  coverLetter: CoverLetterDocument;
  theme?: DocumentTheme;
};

/**
 * Reads the one resume and cover-letter JSON format every template prints from. Sections get
 * their fixed id (see resume-sections.ts); Languages, Volunteering, unrecognised and empty
 * sections are dropped. requireCoreSections, for newly generated JSON, also demands the summary
 * and the Skills, Experience and Education sections; stored packages print without it.
 */
export function parsePdfPackage(
  source: string,
  { requireCoreSections = false }: { requireCoreSections?: boolean } = {},
): PdfPackage {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Enter valid JSON.");
  }
  if (!record(value) || !record(value.resume) || !record(value.coverLetter)) {
    throw new Error("JSON must contain resume and coverLetter objects.");
  }

  const resume = value.resume;
  const coverLetter = value.coverLetter;
  const rootCandidate = record(value.candidate)
    ? candidate(value.candidate, "candidate")
    : null;
  const resumeCandidate = rootCandidate ?? candidate(resume.candidate, "resume");
  const coverCandidate = rootCandidate ?? candidate(coverLetter.candidate, "coverLetter");
  const targetRole = required(resume.targetRole, "resume.targetRole", 300);
  const sectionsRaw = resume.sections;
  if (!Array.isArray(sectionsRaw) || sectionsRaw.length > 20) {
    throw new Error("resume.sections must be a list of no more than 20 sections.");
  }

  const sections = sectionsRaw.flatMap((section, sectionIndex) => {
    if (!record(section)) throw new Error(`resume.sections[${sectionIndex}] must be an object.`);
    const title = required(section.title, `resume.sections[${sectionIndex}].title`, 300);
    const itemsRaw = section.items ?? [];
    if (!Array.isArray(itemsRaw) || itemsRaw.length > 50) {
      throw new Error(`resume.sections[${sectionIndex}].items must contain no more than 50 items.`);
    }
    const id = resumeSectionId(optional(section.id, 120), title);
    if (!id || itemsRaw.length === 0) return [];

    return [{
      id,
      title,
      type: id === "skills" ? "skills" as const : "standard" as const,
      items: itemsRaw.map((item, itemIndex) => {
        if (!record(item)) throw new Error(`Resume item ${itemIndex + 1} is invalid.`);
        return {
          heading: optional(item.heading, 500),
          focus: parseFocus(item.focus),
          subheading: optional(item.subheading, 500),
          location: optional(item.location, 200),
          workMode: parseWorkMode(item.workMode),
          dateRange: formatDateRange(item.startDate, item.endDate) ?? optional(item.dateRange, 200),
          description: optional(item.description, 5000),
          link: optional(item.link, 2048),
          bullets: parseBullets(item.bullets),
        };
      }),
    }];
  });
  if (sections.length === 0) {
    throw new Error("resume.sections must contain at least one section with items.");
  }
  if (requireCoreSections) {
    if (typeof resume.summary !== "string" || !resume.summary.trim()) {
      throw new Error("resume.summary is required.");
    }
    const missing = requiredResumeSectionIds.filter(
      (sectionId) => !sections.some((section) => section.id === sectionId),
    );
    if (missing.length > 0) {
      throw new Error(`resume.sections must include ${missing.join(", ")}, each with at least one item.`);
    }
  }

  const paragraphs = coverLetter.bodyParagraphs ?? coverLetter.paragraphs;
  if (
    !Array.isArray(paragraphs)
    || paragraphs.length < 1
    || paragraphs.length > 6
    || !paragraphs.every((paragraph) => typeof paragraph === "string" && paragraph.trim() && paragraph.length <= 900)
  ) {
    throw new Error("coverLetter.bodyParagraphs must contain 1 to 6 text paragraphs of 900 characters or fewer.");
  }

  if (
    normalize(resumeCandidate.fullName) !== normalize(coverCandidate.fullName)
    || normalize(resumeCandidate.email) !== normalize(coverCandidate.email)
  ) {
    throw new Error("Resume and cover-letter candidate names and email addresses must match.");
  }

  const coverRole = optional(coverLetter.targetRole, 300) ?? targetRole;
  if (normalize(targetRole) !== normalize(coverRole)) {
    throw new Error("Resume and cover-letter target roles must match.");
  }
  const recipient = parseRecipient(coverLetter.recipient);
  const resumeCompany = optional(resume.targetCompany, 500);
  const coverCompany =
    optional(coverLetter.targetCompany, 500)
    ?? recipient?.company
    ?? resumeCompany;
  if (!coverCompany) {
    throw new Error("coverLetter.targetCompany or coverLetter.recipient.company is required.");
  }
  if (resumeCompany && normalize(resumeCompany) !== normalize(coverCompany)) {
    throw new Error("Resume and cover-letter target companies must match.");
  }

  return {
    resume: {
      candidate: resumeCandidate,
      targetRole,
      targetCompany: resumeCompany,
      targetJobsite: optional(resume.targetJobsite, 2048),
      summary: optional(resume.summary, 5000),
      sections,
    },
    coverLetter: {
      candidate: coverCandidate,
      targetRole: coverRole,
      targetCompany: coverCompany,
      date: optional(coverLetter.date, 100),
      salutation: optional(coverLetter.salutation ?? coverLetter.greeting, 300),
      recipient,
      subject: optional(coverLetter.subject, 500),
      bodyParagraphs: paragraphs.map((paragraph) => paragraph.trim()),
      closing: optional(coverLetter.closing, 300),
      signatureName: optional(coverLetter.signatureName ?? coverLetter.signature, 300),
    },
    theme: parseTheme(value.theme),
  };
}

/**
 * The template's view of the package: only the sections that template shows, in its order.
 * Layout (bullets, dates, skills format and the rest) is left to the template's own design.
 */
export function toResumeTemplateData(data: PdfPackage, template: PdfTemplate) {
  const candidate = data.resume.candidate;
  const sections = orderResumeSections(data.resume.sections, template);
  return {
    candidate: candidateForTemplate(candidate),
    resume: {
      targetRole: data.resume.targetRole,
      targetCompany: data.resume.targetCompany ?? data.coverLetter.targetCompany,
      targetJobsite: data.resume.targetJobsite,
      summary: data.resume.summary,
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        type: section.type,
        items: section.items.map((item) => ({
          heading: item.heading,
          focus: item.focus ?? [],
          subheading: item.subheading,
          location: item.location,
          workMode: item.workMode,
          dateRange: item.dateRange,
          description: item.description,
          link: section.id === "projects" ? undefined : item.link,
          bullets: item.bullets ?? [],
        })),
      })),
    },
    coverLetter: {
      candidate: candidateForTemplate(data.coverLetter.candidate),
      targetRole: data.coverLetter.targetRole,
      targetCompany: data.coverLetter.targetCompany,
      date: data.coverLetter.date,
      greeting: data.coverLetter.salutation,
      recipient: data.coverLetter.recipient,
      subject: data.coverLetter.subject,
      paragraphs: data.coverLetter.bodyParagraphs,
      closing: data.coverLetter.closing,
      signature: data.coverLetter.signatureName,
    },
    theme: {
      ...data.theme,
      template,
      // The summary leads; the sections are already in the template's order.
      sectionOrder: ["summary", ...sections.map((section) => section.id ?? "")],
      hiddenSections: [],
    },
  };
}

function candidate(value: unknown, path: string): DocumentCandidate {
  if (!record(value)) throw new Error(`${path}.candidate must be an object.`);
  const email = required(value.email, `${path}.candidate.email`, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${path}.candidate.email must be valid.`);
  }
  const linksRaw = value.links;
  if (
    linksRaw !== undefined
    && (!Array.isArray(linksRaw) || linksRaw.length > 20)
  ) {
    throw new Error(`${path}.candidate.links must contain at most 20 links.`);
  }
  const links = linksRaw?.map((link, index) => {
    if (!record(link)) throw new Error(`${path}.candidate.links[${index}] must be an object.`);
    return {
      label: optional(link.label, 120),
      url: required(link.url, `${path}.candidate.links[${index}].url`, 2048),
    };
  });
  return {
    fullName: required(value.fullName, `${path}.candidate.fullName`, 300),
    email,
    phone: optional(value.phone, 100),
    linkedinUrl: optional(value.linkedinUrl, 2048),
    location: optional(value.location, 500),
    headline: optional(value.headline, 500),
    links,
  };
}

function parseBullets(value: unknown): DocumentBullet[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("Resume bullets must contain no more than 50 entries.");
  }
  return value.map((bullet) => {
    if (typeof bullet === "string" && bullet.length <= 500) return bullet;
    if (record(bullet)) {
      return {
        name: required(bullet.name, "Resume skill name", 500),
        detail: optional(bullet.detail, 300),
      };
    }
    throw new Error("Resume bullets must be strings or skill objects with a name.");
  });
}

// Up to three short skills shown next to an entry's heading; anything else is ignored.
function parseFocus(value: unknown): string[] | undefined {
  const focus = (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,|]/) : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.length <= 60)
    .slice(0, 3);
  return focus.length ? focus : undefined;
}

function parseWorkMode(value: unknown): WorkMode | undefined {
  const mode = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]/g, "") : "";
  if (mode === "remote") return "Remote";
  if (mode === "hybrid") return "Hybrid";
  if (mode === "onsite") return "Onsite";
  return undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2025-04" -> "Apr 2025"; "2025" -> "2025"; "present" -> "Present".
function formatMonth(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (/^(present|current|now)$/i.test(raw)) return "Present";
  const month = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(raw);
  if (month) {
    const index = Number(month[2]) - 1;
    return index >= 0 && index < 12 ? `${MONTHS[index]} ${month[1]}` : undefined;
  }
  return /^\d{4}$/.test(raw) ? raw : undefined;
}

/** Every template prints dates the same way: "Apr 2025 – Present", or one date alone. */
export function formatDateRange(startDate: unknown, endDate: unknown): string | undefined {
  const start = formatMonth(startDate);
  const end = formatMonth(endDate);
  if (start && end && start !== end) return `${start} – ${end}`;
  return start ?? end;
}

function parseRecipient(value: unknown): CoverLetterRecipient | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) throw new Error("coverLetter.recipient must be an object.");
  const addressRaw = value.address;
  const address = Array.isArray(addressRaw)
    ? addressRaw.map((line) => required(line, "coverLetter.recipient.address", 300))
    : typeof addressRaw === "string"
      ? addressRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : undefined;
  if (address && address.length > 10) {
    throw new Error("coverLetter.recipient.address must contain no more than 10 lines.");
  }
  return {
    name: optional(value.name, 300),
    title: optional(value.title, 300),
    company: optional(value.company, 500),
    address,
  };
}

function parseTheme(value: unknown): DocumentTheme | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value)) throw new Error("theme must be an object.");
  const sectionOrder = stringList(value.sectionOrder, "theme.sectionOrder");
  const hiddenSections = stringList(value.hiddenSections, "theme.hiddenSections");
  const density = value.density;
  if (density !== undefined && !["auto", "normal", "compact"].includes(String(density))) {
    throw new Error("theme.density must be auto, normal, or compact.");
  }
  const paper = value.paper;
  const paperValue = paper === undefined ? undefined : String(paper).toLowerCase();
  if (paperValue !== undefined && !["a4", "letter"].includes(paperValue)) {
    throw new Error("theme.paper must be A4 or Letter.");
  }
  const direction = value.direction;
  if (direction !== undefined && !["ltr", "rtl", "auto"].includes(String(direction))) {
    throw new Error("theme.direction must be ltr, rtl, or auto.");
  }
  if (value.showPageNumbers !== undefined && typeof value.showPageNumbers !== "boolean") {
    throw new Error("theme.showPageNumbers must be a boolean.");
  }
  return {
    sectionOrder,
    hiddenSections,
    density: density as DocumentTheme["density"],
    paper: paperValue === undefined ? undefined : paperValue === "letter" ? "letter" : "A4",
    language: optional(value.language, 35),
    direction: direction as DocumentTheme["direction"],
    showPageNumbers: value.showPageNumbers as boolean | undefined,
    accentColor: optional(value.accentColor, 20),
    keywordColor: optional(value.keywordColor, 20),
  };
}

function stringList(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 40 || !value.every(
    (entry) => typeof entry === "string" && entry.length <= 120,
  )) {
    throw new Error(`${path} must contain no more than 40 short strings.`);
  }
  return value;
}

function candidateForTemplate(candidate: DocumentCandidate) {
  return {
    fullName: candidate.fullName,
    email: candidate.email,
    phone: candidate.phone,
    linkedinUrl: candidate.linkedinUrl,
    location: candidate.location,
    headline: candidate.headline,
    links: candidate.links?.filter((link) => link.label?.trim().toLowerCase() !== "portfolio"),
  };
}

function required(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${path} is required and must be ${max} characters or fewer.`);
  }
  return value.trim();
}

function optional(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`Optional text fields must be ${max} characters or fewer.`);
  }
  return value.trim() || undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
