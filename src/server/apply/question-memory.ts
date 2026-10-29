import "server-only";

import { and, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { applyQuestionMemory, reusableAnswerDrafts, reusableAnswers, users } from "@/db/schema";
import { db } from "@/lib/db";
import { normalizeQuestionKey } from "./apply-values";
import {
  type LearnedAnswer,
  type MemoryAnswer,
  type MemoryChoice,
  type MemoryRow,
  mergeLearned,
  safeAutoAnswer,
  SUGGEST_MIN_TIMES,
  isPerCandidateQuestion,
} from "./question-memory-values";

// Apply's question memory: what confirmed applications teach. Each question has one small row;
// Super Admin sees the frequent ones without a reusable answer as suggestions, and a choice
// question every candidate answered the same way is proposed as a draft reusable answer, which
// Apply uses only after Super Admin approves it.

const MEMORY_DAYS = 90;

const toRow = (row: typeof applyQuestionMemory.$inferSelect): MemoryRow => ({
  kind: row.kind === "text" ? "text" : "choice",
  timesSeen: row.timesSeen,
  options: Array.isArray(row.options) ? row.options as string[][] : [],
  answers: Array.isArray(row.answers) ? row.answers as MemoryAnswer[] : [],
  choices: Array.isArray(row.choices) ? row.choices as MemoryChoice[] : [],
});

// The incoming row's value, for one statement that upserts many rows.
const excluded = (column: string) => sql.raw(`excluded."${column}"`);

/**
 * Learns from one application the Manager confirmed (Yes): each question's row grows, safe
 * questions become draft reusable answers, and rows unseen for 90 days are removed. Two database
 * trips however many questions the form had: one to read, one to write. A question that already
 * has an answer in any state (approved, waiting, or rejected) gets no new draft. Returns the
 * drafts added.
 */
export async function recordLearnedAnswers(candidateId: string, items: LearnedAnswer[]): Promise<string[]> {
  const byKey = new Map<string, LearnedAnswer>();
  for (const item of items) {
    const key = normalizeQuestionKey(item.question);
    if (key && !byKey.has(key)) byKey.set(key, item);
  }
  if (!byKey.size) return [];
  const keys = [...byKey.keys()];
  const [existing, reusable, drafts, [author]] = await db.batch([
    db.select().from(applyQuestionMemory).where(inArray(applyQuestionMemory.questionKey, keys)),
    db.select({ questionKey: reusableAnswers.questionKey }).from(reusableAnswers).where(inArray(reusableAnswers.questionKey, keys)),
    db.select({ questionKey: reusableAnswerDrafts.questionKey }).from(reusableAnswerDrafts).where(inArray(reusableAnswerDrafts.questionKey, keys)),
    db.select({ id: users.id }).from(users).where(eq(users.role, "super_admin")).limit(1),
  ]);
  const rows = new Map(existing.map((row) => [row.questionKey, row]));
  const covered = new Set([...reusable, ...drafts].map((row) => row.questionKey));
  const now = new Date();
  const memory: (typeof applyQuestionMemory.$inferInsert)[] = [];
  const autoAnswers: (typeof reusableAnswerDrafts.$inferInsert)[] = [];

  for (const [key, item] of byKey) {
    const before = rows.get(key);
    const next = mergeLearned(before ? toRow(before) : null, item, candidateId);
    memory.push({
      questionKey: key,
      questionText: item.question,
      kind: next.kind,
      timesSeen: next.timesSeen,
      options: next.options,
      answers: next.answers,
      choices: next.choices,
      lastSeenAt: now,
    });
    const answer = covered.has(key) || before?.dismissed ? null : safeAutoAnswer(next, item.question);
    if (answer && author) {
      autoAnswers.push({
        questionKey: key,
        questionText: item.question,
        answer,
        note: `Added automatically: answered "${answer}" every time (${next.timesSeen} applications, ${next.answers[0].candidates.length} candidates).`,
        status: "draft",
        source: "learned",
        createdByUserId: author.id,
      });
    }
  }

  const upsert = db
    .insert(applyQuestionMemory)
    .values(memory)
    .onConflictDoUpdate({
      target: applyQuestionMemory.questionKey,
      set: {
        questionText: excluded("question_text"),
        kind: excluded("kind"),
        timesSeen: excluded("times_seen"),
        options: excluded("options"),
        answers: excluded("answers"),
        choices: excluded("choices"),
        lastSeenAt: excluded("last_seen_at"),
      },
    });
  const forget = db
    .delete(applyQuestionMemory)
    .where(lt(applyQuestionMemory.lastSeenAt, sql`now() - make_interval(days => ${MEMORY_DAYS})`));
  if (!autoAnswers.length) {
    await db.batch([upsert, forget]);
    return [];
  }
  const [, , inserted] = await db.batch([
    upsert,
    forget,
    db.insert(reusableAnswerDrafts).values(autoAnswers).onConflictDoNothing().returning({ questionText: reusableAnswerDrafts.questionText }),
  ]);
  return inserted.map((row) => row.questionText);
}

export type QuestionSuggestion = {
  id: string;
  questionText: string;
  kind: "choice" | "text";
  timesSeen: number;
  options: string[][];
  answers: { answer: string; count: number; candidates: number }[];
  lastSeenAt: string;
};

/** Frequent questions without a reusable answer in any state, the most frequent first, for Settings. */
export async function listQuestionSuggestions(limit = 100): Promise<QuestionSuggestion[]> {
  const covered = db.select({ key: reusableAnswers.questionKey }).from(reusableAnswers);
  const drafted = db.select({ key: reusableAnswerDrafts.questionKey }).from(reusableAnswerDrafts);
  const rows = await db
    .select()
    .from(applyQuestionMemory)
    .where(and(
      eq(applyQuestionMemory.dismissed, false),
      gte(applyQuestionMemory.timesSeen, SUGGEST_MIN_TIMES),
      notInArray(applyQuestionMemory.questionKey, covered),
      notInArray(applyQuestionMemory.questionKey, drafted),
    ))
    .orderBy(desc(applyQuestionMemory.timesSeen), desc(applyQuestionMemory.lastSeenAt))
    .limit(limit);
  // Only questions every candidate can answer the same way: never personal facts ("Location"),
  // experience, or wishes ("What compensation are you targeting?").
  return rows.filter((row) => !isPerCandidateQuestion(row.questionText)).map((row) => {
    const memory = toRow(row);
    return {
      id: row.id,
      questionText: row.questionText,
      kind: memory.kind,
      timesSeen: memory.timesSeen,
      options: memory.options,
      answers: memory.answers.map((entry) => ({ answer: entry.answer, count: entry.count, candidates: entry.candidates.length })),
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  });
}

/** "Dismiss": a personal or one-off question is not suggested again. */
export async function dismissQuestionSuggestion(id: string): Promise<boolean> {
  const updated = await db
    .update(applyQuestionMemory)
    .set({ dismissed: true })
    .where(eq(applyQuestionMemory.id, id))
    .returning({ id: applyQuestionMemory.id });
  return updated.length > 0;
}

export type RememberedChoice = { questionKey: string; optionsKey: string; intended: string; choice: string };

/** Every remembered choice, for Apply to fill a value that did not fit without asking the AI. */
export async function rememberedChoices(): Promise<RememberedChoice[]> {
  const rows = await db
    .select({ questionKey: applyQuestionMemory.questionKey, choices: applyQuestionMemory.choices })
    .from(applyQuestionMemory)
    .where(sql`jsonb_array_length(${applyQuestionMemory.choices}) > 0`)
    .limit(2000);
  return rows.flatMap((row) => (Array.isArray(row.choices) ? row.choices as MemoryChoice[] : [])
    .map((choice) => ({ questionKey: row.questionKey, optionsKey: choice.optionsKey, intended: choice.intended, choice: choice.choice })));
}
