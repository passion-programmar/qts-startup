// Values and rules shared by the Apply and Chrome-registry routes. Pure, so they are testable
// without a database.

/** Job pages open at once per Chrome (any number of Chromes may work at the same time). */
export const APPLY_PARALLEL_LIMIT = 2;
/** A claim being filled lives this long without a heartbeat; Chromes renew it every 30 seconds. */
export const APPLY_LEASE_SECONDS = 120;
/** An application waiting for the Manager (review, or Yes/No in an open tab) is held this long without a heartbeat. */
export const APPLY_REVIEW_LEASE_SECONDS = 600;
/** Generation and Apply work goes only to this extension version or newer (Apply with Manager review). */
export const MIN_WORK_EXTENSION_VERSION = "1.36.0";

/** -1, 0, or 1 for dotted numeric versions; null when either is not one. */
export function compareExtensionVersions(left: string, right: string): number | null {
  const parse = (value: string) => (/^\d+(\.\d+){0,3}$/.test(value) ? value.split(".").map(Number) : null);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether a Chrome may take Generation or Apply work. */
export function canTakeWork(extensionVersion: string | null): boolean {
  if (!extensionVersion) return false;
  const comparison = compareExtensionVersions(extensionVersion, MIN_WORK_EXTENSION_VERSION);
  return comparison !== null && comparison >= 0;
}

export type BrowserHeaders = { browserKey: string; extensionVersion: string | null; browserName: string | null };

/** The Chrome identity the extension sends with each request, or null when it sends none. */
export function parseBrowserHeaders(headers: Headers): BrowserHeaders | null {
  const browserKey = headers.get("x-qts-browser-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(browserKey)) return null;
  const version = headers.get("x-qts-extension-version")?.trim() ?? "";
  // The extension sends the name URI-encoded, since header values cannot carry every character.
  let name = headers.get("x-qts-browser-name") ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    name = "";
  }
  name = name.replace(/\s+/g, " ").trim();
  return {
    browserKey,
    extensionVersion: /^\d+(\.\d+){0,3}$/.test(version) ? version : null,
    browserName: name ? name.slice(0, 60) : null,
  };
}

/** The automatic name of a Chrome: a short, readable form of its key. */
export function defaultBrowserName(browserKey: string): string {
  return `Chrome · ${browserKey.slice(0, 4).toUpperCase()}`;
}

/** The same question on different forms ("Why Exadel? *", "why exadel") shares one saved answer. */
export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\(\s*(optional|required)\s*\)/g, " ")
    .replace(/[*:?!.,;"'()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** The folder a delivered résumé was saved in ("QTS_Resume/MSK/Anna/2026-10-27_..._Acme/"). */
export function resumeFolderOf(resumePath: string): string {
  const path = resumePath.replace(/\\/g, "/").trim();
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash + 1) : path;
}

const EMPLOYMENT_TYPES: [RegExp, string][] = [
  [/intern/i, "Internship"],
  [/part[\s_-]?time/i, "Part-time"],
  [/temp|seasonal/i, "Temporary"],
  [/contract|freelanc|b2b|contractor|self[\s_-]?employ/i, "Contract"],
  [/full[\s_-]?time|permanent|employee/i, "Full-time"],
];
const WORKPLACE_TYPES: [RegExp, string][] = [
  [/hybrid|flexib|partly remote|remote.{0,20}office|office.{0,20}remote/i, "Hybrid"],
  [/remote|telecommut|work from home|wfh|home[\s-]?based|anywhere/i, "Remote"],
  [/on[\s_-]?site|in[\s_-]?office|office[\s_-]?based|in[\s_-]?person/i, "On-site"],
];

/** Gemini's employment type in one fixed word: Full-time, Part-time, Contract, Internship, Temporary. */
export function normalizeEmploymentType(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return EMPLOYMENT_TYPES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Gemini's work arrangement in one fixed word: Remote, Hybrid, On-site. */
export function normalizeWorkplaceType(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return WORKPLACE_TYPES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** A bid's work type: "Full-time · Remote", either part alone, or null. */
export function workTypeOf(employmentType: string | null | undefined, workplaceType: string | null | undefined): string | null {
  const parts = [normalizeEmploymentType(employmentType), normalizeWorkplaceType(workplaceType)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The delivered résumé as plain text, in the PDF's order: name and headline, summary, then each
 * section with its items (heading, company, place, dates) and bullets, without bold marks.
 */
export function resumeText(resume: unknown): string | null {
  if (!resume || typeof resume !== "object") return null;
  const value = resume as Record<string, unknown>;
  const clean = (text: unknown) =>
    typeof text === "string" ? text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+/g, " ").trim() : "";
  const lines: string[] = [];
  const candidate = (value.candidate && typeof value.candidate === "object" ? value.candidate : {}) as Record<string, unknown>;
  for (const line of [clean(candidate.fullName), clean(candidate.headline)]) if (line) lines.push(line);
  const summary = clean(value.summary);
  if (summary) lines.push("", "Summary", summary);
  for (const section of Array.isArray(value.sections) ? value.sections : []) {
    if (!section || typeof section !== "object") continue;
    const { title, items } = section as Record<string, unknown>;
    const entries = Array.isArray(items) ? items : [];
    if (!entries.length) continue;
    lines.push("", clean(title) || "Section");
    for (const item of entries) {
      if (typeof item === "string") {
        if (clean(item)) lines.push(`- ${clean(item)}`);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const dates = [clean(entry.startDate), clean(entry.endDate)].filter(Boolean).join(" – ");
      const head = [clean(entry.heading), clean(entry.subheading), clean(entry.location), clean(entry.workMode), dates]
        .filter(Boolean)
        .join(" · ");
      if (head) lines.push(head);
      const focus = Array.isArray(entry.focus) ? entry.focus.map(clean).filter(Boolean) : [];
      if (focus.length) lines.push(`Focus: ${focus.join(", ")}`);
      for (const bullet of Array.isArray(entry.bullets) ? entry.bullets : []) {
        if (clean(bullet)) lines.push(`- ${clean(bullet)}`);
      }
    }
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text.slice(0, 30000) : null;
}

/**
 * The delivered cover letter as plain text, for forms that ask for it in a text box: greeting,
 * paragraphs without the PDF's bold marks, closing, and name. Null without paragraphs.
 */
export function coverLetterText(coverLetter: unknown): string | null {
  if (!coverLetter || typeof coverLetter !== "object") return null;
  const letter = coverLetter as Record<string, unknown>;
  const clean = (value: unknown) =>
    typeof value === "string" ? value.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+/g, " ").trim() : "";
  const body = Array.isArray(letter.bodyParagraphs) ? letter.bodyParagraphs : letter.paragraphs;
  const paragraphs = (Array.isArray(body) ? body : []).map(clean).filter(Boolean);
  if (!paragraphs.length) return null;
  const signOff = [clean(letter.closing), clean(letter.signatureName ?? letter.signature)].filter(Boolean).join("\n");
  return [clean(letter.salutation ?? letter.greeting), ...paragraphs, signOff].filter(Boolean).join("\n\n").slice(0, 8000);
}

export type ReusableAnswerInput = { questionText: string; questionKey: string; answer: string; note: string | null };

/** A reusable answer from Super Admin's form, or a string naming what is wrong. */
export function parseReusableAnswer(values: { question: unknown; answer: unknown; note: unknown }): ReusableAnswerInput | string {
  const text = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
  const questionText = text(values.question).replace(/\s+/g, " ");
  const answer = text(values.answer);
  const note = text(values.note);
  if (!questionText) return "Enter the question.";
  if (questionText.length > 300) return "The question is too long (300 characters at most).";
  if (!answer) return "Enter the answer.";
  if (answer.length > 4000) return "The answer is too long (4000 characters at most).";
  if (note.length > 500) return "The note is too long (500 characters at most).";
  const questionKey = normalizeQuestionKey(questionText);
  if (!questionKey) return "Enter a question with words in it.";
  return { questionText, questionKey, answer, note: note || null };
}

export type AppliedAnswer = { question: string; answer: string; source: string };
// One Apply run as the job row keeps it: when, how it ended, and every answer with its source.
export type ApplyRun = { at: string; outcome: string; reason: string | null; answers: AppliedAnswer[] };

// "site": what the site filled itself from the uploaded résumé.
const ANSWER_SOURCES = new Set(["profile", "reusable", "ai", "documents", "consent", "rule", "saved", "manager", "site"]);

/**
 * The answers a run used, as the extension reports them: question, answer (lists joined, tick boxes
 * as ticked or not), and where it came from. Anything malformed is left out.
 */
export function parseAppliedAnswers(value: unknown): AppliedAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { question, answer, source } = entry as Record<string, unknown>;
    if (typeof question !== "string" || !question.trim()) return [];
    const text = Array.isArray(answer)
      ? answer.map(String).join(" | ")
      : typeof answer === "boolean"
        ? (answer ? "Ticked" : "Not ticked")
        : String(answer ?? "");
    return [{
      question: question.replace(/\s+/g, " ").trim().slice(0, 300),
      answer: text.trim().slice(0, 2000),
      source: typeof source === "string" && ANSWER_SOURCES.has(source) ? source : "ai",
    }];
  });
}
