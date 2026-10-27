// Rules for Apply's question memory (apply_question_memory): what a confirmed application teaches,
// how one question's row grows, and when a question is safe to become a reusable answer by
// itself. Pure, so the rules are testable without a database.

export type LearnedAnswer = {
  question: string;
  kind: "choice" | "text";
  answer: string;
  source: string;
  // The choices the form offered, for choice questions.
  options: string[];
  // The value Apply meant (a reusable answer or profile fact) when it did not fit as written.
  intended: string | null;
};
export type MemoryAnswer = { answer: string; count: number; candidates: string[] };
export type MemoryChoice = { optionsKey: string; intended: string; choice: string; uses: number };
export type MemoryRow = {
  kind: "choice" | "text";
  timesSeen: number;
  options: string[][];
  answers: MemoryAnswer[];
  choices: MemoryChoice[];
};

export const AUTO_ADD_MIN_TIMES = 5;
export const AUTO_ADD_MIN_CANDIDATES = 3;
export const SUGGEST_MIN_TIMES = 2;
const MAX_OPTION_LISTS = 5;
const MAX_ANSWERS = 5;
const MAX_CANDIDATES = 10;
const MAX_CHOICES = 10;
const MAX_STORED_ANSWER = 100;

// Facts that differ per person come from the profile and are never learned or shared.
const PERSONAL_QUESTION = /\b(?:name|e-?mail|phone|mobile|address|street|city|town|postcode|postal|zip|country|citizenship|linkedin|github|portfolio|website|gender|sex|race|veteran|birth|age)\b|\b(?:nationalit|ethnic|disabilit|orientation|pronoun)/i;
// Answers that depend on the candidate's own experience or wishes differ per candidate.
const EXPERIENCE_QUESTION = /\b(years?|experience|how (long|many|much)|describe|tell us|why|explain|example|salary|rate|compensation|pay|notice|start|availab|level|proficien)\b/i;
const NOT_LEARNED_SOURCES = new Set(["profile", "documents", "consent"]);

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const same = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** The same choice list in any order and case gives the same key (the extension computes it the same way). */
export function optionsKey(options: string[]): string {
  return options.map(same).filter(Boolean).sort().join("|").slice(0, 500);
}

/** What a confirmed application's Chrome sent to learn from, checked; personal facts and documents are left out. */
export function parseLearnedAnswers(value: unknown): LearnedAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const question = clean(item.question, 300);
    const answer = clean(item.answer, 2000);
    const source = clean(item.source, 20);
    if (!question || !answer || NOT_LEARNED_SOURCES.has(source) || PERSONAL_QUESTION.test(question)) return [];
    const options = Array.isArray(item.options)
      ? item.options.slice(0, 30).map((option) => clean(option, 200)).filter(Boolean)
      : [];
    return [{
      question,
      kind: item.kind === "choice" || options.length ? "choice" as const : "text" as const,
      answer,
      source,
      options,
      intended: clean(item.intended, 500) || null,
    }];
  });
}

/** One question's row after one more confirmed application. */
export function mergeLearned(row: MemoryRow | null, item: LearnedAnswer, candidateId: string): MemoryRow {
  const next: MemoryRow = row
    ? { ...row, options: [...row.options], answers: row.answers.map((entry) => ({ ...entry, candidates: [...entry.candidates] })), choices: [...row.choices] }
    : { kind: item.kind, timesSeen: 0, options: [], answers: [], choices: [] };
  next.timesSeen += 1;
  next.kind = item.kind;
  if (item.options.length && !next.options.some((list) => optionsKey(list) === optionsKey(item.options)) && next.options.length < MAX_OPTION_LISTS) {
    next.options.push(item.options);
  }
  // Only short answers to choice questions are kept; long free text is counted, never stored.
  if (item.kind === "choice" && item.answer.length <= MAX_STORED_ANSWER) {
    const existing = next.answers.find((entry) => same(entry.answer) === same(item.answer));
    if (existing) {
      existing.count += 1;
      if (!existing.candidates.includes(candidateId) && existing.candidates.length < MAX_CANDIDATES) existing.candidates.push(candidateId);
    } else {
      next.answers.push({ answer: item.answer, count: 1, candidates: [candidateId] });
    }
    next.answers.sort((a, b) => b.count - a.count);
    next.answers = next.answers.slice(0, MAX_ANSWERS);
  }
  // A value that did not fit and the option it became, for this choice list: next time, no AI.
  if (item.intended && item.options.length && item.options.includes(item.answer) && same(item.intended) !== same(item.answer)) {
    const key = optionsKey(item.options);
    const existing = next.choices.find((entry) => entry.optionsKey === key && same(entry.intended) === same(item.intended!));
    if (existing) {
      existing.choice = item.answer;
      existing.uses += 1;
    } else {
      next.choices.push({ optionsKey: key, intended: item.intended, choice: item.answer, uses: 1 });
    }
    next.choices.sort((a, b) => b.uses - a.uses);
    next.choices = next.choices.slice(0, MAX_CHOICES);
  }
  return next;
}

/**
 * The answer a question may become a reusable answer with by itself, or null: a choice question,
 * not personal or about experience, seen 5+ times, always answered the same, by 3+ candidates.
 */
export function safeAutoAnswer(row: MemoryRow, questionText: string): string | null {
  if (row.kind !== "choice" || row.timesSeen < AUTO_ADD_MIN_TIMES || row.answers.length !== 1) return null;
  if (PERSONAL_QUESTION.test(questionText) || EXPERIENCE_QUESTION.test(questionText)) return null;
  const [only] = row.answers;
  return only.candidates.length >= AUTO_ADD_MIN_CANDIDATES && only.answer.length <= MAX_STORED_ANSWER ? only.answer : null;
}
