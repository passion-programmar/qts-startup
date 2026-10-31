// Cleans ChatGPT's résumé and cover letter before they are saved, so every template, the backup
// renderer, and Apply read the same plain text. Nothing here fails a Generation: stray symbols are
// removed, placeholders are filled from the job and candidate or taken out, bold stays only in the
// summary and bullets. Content and emphasis follow the Manager prompt. Pure,
// so it is testable without a database.

import { resumeJsonVersion } from "@/app/pdf/document-data";

export type CleanContext = {
  company: string;
  jobTitle: string;
  candidateName: string;
};

const INVISIBLE = /[​-‍⁠﻿­]/g;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️⃣]/gu;
// Decorative signs (stars, ticks, arrows, boxes) that templates draw as odd symbols.
const DECORATIVE = /[←-⇿─-◿☀-➿⬀-⯿]/g;
const HTML_TAG = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi;
const LEADING_MARKER = /^\s*(?:[-*•●▪◦·–—]|\d{1,2}[.)]|#{1,6})\s+/;

type Placeholder = [RegExp, keyof Pick<CleanContext, "company" | "jobTitle" | "candidateName">];
const KNOWN_PLACEHOLDERS: Placeholder[] = [
  [/\[\s*(?:company|company name|employer|organi[sz]ation|hiring company)\s*\]|\{\{\s*(?:company|company_name|employer)\s*\}\}|<\s*(?:company|company name)\s*>/gi, "company"],
  [/\[\s*(?:job title|position|role|position title|role title)\s*\]|\{\{\s*(?:job_title|position|role)\s*\}\}|<\s*(?:job title|position)\s*>/gi, "jobTitle"],
  [/\[\s*(?:your name|candidate|candidate name|full name|name)\s*\]|\{\{\s*(?:candidate_name|name|full_name)\s*\}\}|<\s*(?:your name|name)\s*>/gi, "candidateName"],
];
// Placeholders nothing can fill: "[X%]", "[insert metric]", "{{anything}}", "<add number>".
const OTHER_PLACEHOLDERS = /\[\s*(?:x+%?|n|#|insert[^\]]*|add[^\]]*|your[^\]]*|number|metric|percentage|amount|tbd|todo|date|year|city|link|url)\s*\]|\{\{[^{}]*\}\}|<\s*(?:insert|add|your)[^<>]*>|\bX{1,3}%/gi;

/** One text field cleaned; bold kept as **pairs** only where allowed. */
export function cleanText(
  value: string,
  context: CleanContext,
  { bold = false, marker = false }: { bold?: boolean; marker?: boolean } = {},
): string {
  let text = String(value ?? "")
    .replace(INVISIBLE, "")
    .replace(/ /g, " ")
    .replace(HTML_TAG, " ")
    .replace(EMOJI, "")
    .replace(DECORATIVE, "");
  for (const [pattern, field] of KNOWN_PLACEHOLDERS) {
    const replacement = context[field].trim();
    text = text.replace(pattern, replacement || " ");
  }
  text = text.replace(OTHER_PLACEHOLDERS, " ");
  // Markdown that is not a bold pair: code marks, underscores used for emphasis, headings.
  text = text.replace(/`+/g, "").replace(/(^|\s)__(.+?)__(?=\s|$|[.,;:!?])/g, "$1$2");
  // "- • Led ..." can carry more than one bullet sign.
  if (marker) while (LEADING_MARKER.test(text)) text = text.replace(LEADING_MARKER, "");
  text = text.replace(/^\s*#{1,6}\s+/, "");
  // Bold: well-formed **pairs** stay where allowed; every other asterisk goes.
  text = text
    .split(/(\*\*[^*\n]+?\*\*)/g)
    .map((part) => {
      const pair = /^\*\*([^*\n]+?)\*\*$/.exec(part);
      if (pair && bold && pair[1].trim()) return `**${pair[1].trim()}**`;
      return (pair ? pair[1] : part).replace(/\*/g, "");
    })
    .join("");
  return tidy(text);
}

/** Spacing and punctuation left over after removals: "by  ." -> "by.", "( )" -> "". */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.;:!?%)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s*,\s*\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function cleanFields(value: Record<string, unknown>, fields: readonly string[], context: CleanContext) {
  const cleaned = { ...value };
  for (const field of fields) {
    if (typeof cleaned[field] === "string") cleaned[field] = cleanText(cleaned[field], context);
  }
  return cleaned;
}

/**
 * The whole document package, cleaned. One-line fields (names, titles, companies, dates) lose all
 * marks; bullets keep bold pairs and their original count; the cover letter stays plain.
 */
export function cleanGeneratedDocuments(value: Record<string, unknown>, context: CleanContext): Record<string, unknown> {
  const plain = (text: unknown) => (typeof text === "string" ? cleanText(text, context) : text);
  const plainObject = (object: unknown) => (record(object)
    ? Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, Array.isArray(entry) ? entry.map(plain) : plain(entry)]))
    : object);
  const resume = record(value.resume) ? value.resume : null;
  const coverLetter = record(value.coverLetter) ? value.coverLetter : null;
  const output: Record<string, unknown> = { ...value };

  if (resume) {
    if (resumeJsonVersion(resume) === 2) {
      const skills = Array.isArray(resume.skills) ? resume.skills.map((group) => {
        if (!record(group)) return group;
        const items = typeof group.items === "string"
          ? group.items.split(",").map((skill) => cleanText(skill, context)).filter(Boolean).join(", ")
          : group.items;
        return {
          ...group,
          ...(typeof group.category === "string" ? { category: cleanText(group.category, context) } : {}),
          items,
        };
      }) : resume.skills;
      const experience = Array.isArray(resume.experience) ? resume.experience.map((entry) => {
        if (!record(entry)) return entry;
        return {
          ...cleanFields(entry, ["company", "location", "role", "dates"], context),
          ...(Array.isArray(entry.bullets)
            ? {
              bullets: entry.bullets.map((bullet) => typeof bullet === "string"
                ? cleanText(bullet, context, { bold: true, marker: true })
                : bullet),
            }
            : {}),
        };
      }) : resume.experience;
      const education = Array.isArray(resume.education) ? resume.education.map((entry) => {
        if (!record(entry)) return entry;
        return cleanFields(entry, ["institution", "location", "degree", "field", "dates"], context);
      }) : resume.education;
      output.resume = {
        ...resume,
        targetCompany: typeof resume.targetCompany === "string" ? cleanText(resume.targetCompany, context) : resume.targetCompany,
        applyJobTitle: typeof resume.applyJobTitle === "string" ? cleanText(resume.applyJobTitle, context) : resume.applyJobTitle,
        name: typeof resume.name === "string" ? cleanText(resume.name, context) : resume.name,
        title: typeof resume.title === "string" ? cleanText(resume.title, context) : resume.title,
        ...(record(resume.contact) ? {
          contact: Object.fromEntries(Object.entries(resume.contact).map(([key, entry]) => [key, plain(entry)])),
        } : {}),
        summary: typeof resume.summary === "string"
          ? cleanText(resume.summary, context, { bold: true })
          : resume.summary,
        skills,
        experience,
        education,
      };
    } else {
      const sections = Array.isArray(resume.sections) ? resume.sections : [];
      const cleanedSections = sections.map((section) => {
        if (!record(section)) return section;
        const skills = section.id === "skills" || /skill/i.test(String(section.title ?? ""));
        const items = Array.isArray(section.items) ? section.items : [];
        return {
          ...section,
          ...(typeof section.title === "string" ? { title: cleanText(section.title, context) } : {}),
          items: items.map((item) => {
            if (typeof item === "string") return cleanText(item, context, { bold: !skills, marker: true });
            if (!record(item)) return item;
            const cleaned: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(item)) {
              if (key === "bullets" && Array.isArray(entry)) {
                cleaned.bullets = entry
                  .map((bullet) => (typeof bullet === "string"
                    ? cleanText(bullet, context, { bold: !skills, marker: true })
                    : record(bullet) ? plainObject(bullet) : bullet));
              } else if (Array.isArray(entry)) {
                cleaned[key] = entry.map(plain).filter((part) => part !== "");
              } else {
                cleaned[key] = plain(entry);
              }
            }
            return cleaned;
          }),
        };
      });
      const summary = typeof resume.summary === "string"
        ? cleanText(resume.summary, context, { bold: true })
        : resume.summary;
      output.resume = {
        ...resume,
        ...(record(resume.candidate) ? { candidate: plainObject(resume.candidate) } : {}),
        ...(typeof resume.targetRole === "string" ? { targetRole: plain(resume.targetRole) } : {}),
        ...(typeof resume.targetCompany === "string" ? { targetCompany: plain(resume.targetCompany) } : {}),
        summary,
        sections: cleanedSections,
      };
    }
  }

  if (coverLetter) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(coverLetter)) {
      if ((key === "bodyParagraphs" || key === "paragraphs") && Array.isArray(entry)) {
        cleaned[key] = entry.map(plain).filter((paragraph) => typeof paragraph !== "string" || paragraph.length > 0);
      } else if (record(entry)) {
        cleaned[key] = plainObject(entry);
      } else if (Array.isArray(entry)) {
        cleaned[key] = entry.map(plain);
      } else {
        cleaned[key] = plain(entry);
      }
    }
    output.coverLetter = cleaned;
  }
  return output;
}
