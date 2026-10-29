// Rules for reviewing reusable answers: their states, sources and history, and the warnings Super
// Admin and Managers see when a question repeats or nearly repeats another answer. Pure, so testable
// without a database.

import { normalizeQuestionKey } from "./apply-values";

export const REUSABLE_ANSWER_STATUSES = ["draft", "approved", "rejected"] as const;
export type ReusableAnswerStatus = (typeof REUSABLE_ANSWER_STATUSES)[number];
export const REUSABLE_ANSWER_SOURCES = ["manual", "learned", "manager", "ai"] as const;
export type ReusableAnswerSource = (typeof REUSABLE_ANSWER_SOURCES)[number];

/** Drafts one Manager may have waiting at once, so proposals stay reviewable. */
export const MAX_DRAFTS_PER_MANAGER = 50;
/** Earlier approved versions kept per question. */
export const MAX_VERSIONS_PER_QUESTION = 20;

export type VersionReason = "edited" | "replaced" | "restored" | "deleted";
export const VERSION_REASON_LABELS: Record<VersionReason, string> = {
  edited: "Before an edit",
  replaced: "Replaced by an approved draft",
  restored: "Before an older version was restored",
  deleted: "Before it was deleted",
};

export const SOURCE_LABELS: Record<ReusableAnswerSource, string> = {
  manual: "Super Admin",
  learned: "Learned from applications",
  manager: "Manager's proposal",
  ai: "AI answer",
};

export function sourceOf(value: string): ReusableAnswerSource {
  return (REUSABLE_ANSWER_SOURCES as readonly string[]).includes(value) ? value as ReusableAnswerSource : "manual";
}

// The same words Apply's matching ignores (extension/shared/apply-answers.js), so a warning here
// means Apply could pick either answer for the same question.
const FILLER_WORDS = new Set(["the", "and", "you", "your", "are", "did", "does", "have", "has", "what", "which", "how", "this", "that", "our", "with", "for", "about", "any", "please", "required", "optional", "would", "could", "can", "will", "from", "into", "there", "were", "was", "been", "its", "them", "they"]);

function questionWords(text: string): Set<string> {
  return new Set(normalizeQuestionKey(text).split(" ").filter((word) => word.length > 2 && !FILLER_WORDS.has(word)));
}

/** Apply's own test for "the same question in other words": most of the shorter question's words. */
export function similarQuestions(a: string, b: string): boolean {
  const words = questionWords(a);
  const other = questionWords(b);
  if (!words.size || !other.size) return false;
  const shared = [...words].filter((word) => other.has(word)).length;
  const smaller = Math.min(words.size, other.size);
  return shared / smaller >= 0.75 && (shared >= 2 || smaller <= 2);
}

const sameAnswer = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export type AnswerRow = { id: string; questionKey: string; questionText: string; answer: string; status: string };
export type AnswerWarning = {
  // "same": the same question; "similar": Apply could match either question.
  match: "same" | "similar";
  // The two answers differ: one of them is wrong for the other's question.
  conflict: boolean;
  status: string;
  questionText: string;
  answer: string;
};

/**
 * What an answer repeats among the others: the same question (an approved one would be replaced on
 * approval) or a similar one, and whether the answers disagree. Same questions first.
 */
export function answerWarnings(target: Omit<AnswerRow, "status">, others: AnswerRow[]): AnswerWarning[] {
  const warnings: AnswerWarning[] = [];
  for (const row of others) {
    if (row.id === target.id || row.status === "rejected") continue;
    const match = row.questionKey === target.questionKey ? "same" : similarQuestions(target.questionText, row.questionText) ? "similar" : null;
    if (!match) continue;
    warnings.push({ match, conflict: !sameAnswer(row.answer, target.answer), status: row.status, questionText: row.questionText, answer: row.answer });
  }
  return warnings.sort((a, b) => (a.match === b.match ? 0 : a.match === "same" ? -1 : 1));
}

/** One line per warning, for an action's message. */
export function describeWarning(warning: AnswerWarning): string {
  const which = warning.status === "approved" ? "An approved answer" : "A draft";
  const question = warning.match === "same" ? "the same question" : `a similar question (“${warning.questionText}”)`;
  return `${which} for ${question} ${warning.conflict ? `says “${warning.answer.slice(0, 120)}”` : "says the same"}.`;
}
