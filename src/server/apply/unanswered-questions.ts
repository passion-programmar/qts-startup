import "server-only";

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { managerApplyAnswers, managerUnansweredQuestions } from "@/db/schema";
import { db } from "@/lib/db";
import meaning from "../../../extension/shared/answer-meaning.js";
import { correctionKey } from "./manager-answer-values";

// The Manager's "Needs answer" list (decision 2026-11-06/07): questions Normal Apply met that nothing
// answered, one row per question per Manager. It needs migration 0089; until that is applied it stays
// empty and quiet (nothing else depends on it).

const KEEP_DAYS = 90;
let tableReady: boolean | null = null;

// Only "the table exists" is remembered: until then it is looked for again, so the list appears as
// soon as the migration is applied, without a restart.
async function ready(): Promise<boolean> {
  if (tableReady) return true;
  try {
    const result = await db.execute(sql`select to_regclass('public.manager_unanswered_questions') is not null as ready`);
    tableReady = Boolean((result.rows[0] as { ready?: boolean } | undefined)?.ready);
  } catch {
    tableReady = false;
  }
  return tableReady === true;
}

export type UnansweredInput = { question: string; kind: string; options: string[] };

/** Valid questions from a request body (at most 30, each 1–300 characters, 50 options). */
export function parseUnanswered(input: unknown): UnansweredInput[] {
  if (!Array.isArray(input)) return [];
  const out: UnansweredInput[] = [];
  for (const entry of input.slice(0, 30)) {
    const raw = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const question = typeof raw.question === "string" ? raw.question.replace(/\s+/g, " ").trim() : "";
    if (!question || question.length > 300) continue;
    const kind = typeof raw.kind === "string" && /^[a-z-]{1,30}$/.test(raw.kind) ? raw.kind : "text";
    const options = Array.isArray(raw.options) ? raw.options.filter((option): option is string => typeof option === "string").map((option) => option.slice(0, 200)).slice(0, 50) : [];
    out.push({ question, kind, options });
  }
  return out;
}

/** Counts each question once more (one database trip), and removes rows unseen for 90 days. */
export async function recordUnanswered(managerId: string, questions: UnansweredInput[]): Promise<void> {
  if (!questions.length || !(await ready())) return;
  const rows = [...new Map(questions.map((entry) => [correctionKey(entry.question), entry])).entries()]
    .filter(([key]) => key)
    .map(([questionKey, entry]) => ({ managerId, questionKey, questionText: entry.question, kind: entry.kind, options: entry.options }));
  if (!rows.length) return;
  await db.insert(managerUnansweredQuestions).values(rows).onConflictDoUpdate({
    target: [managerUnansweredQuestions.managerId, managerUnansweredQuestions.questionKey],
    set: { timesSeen: sql`${managerUnansweredQuestions.timesSeen} + 1`, lastSeenAt: sql`now()`, questionText: sql`excluded.question_text`,
      kind: sql`excluded.kind`, options: sql`excluded.options` },
  });
  await db.delete(managerUnansweredQuestions).where(and(eq(managerUnansweredQuestions.managerId, managerId),
    lt(managerUnansweredQuestions.lastSeenAt, sql`now() - make_interval(days => ${KEEP_DAYS})`)));
}

export type UnansweredRow = { id: string; questionText: string; kind: string; options: string[]; timesSeen: number; lastSeenAt: Date };

/**
 * The questions still without an answer for all candidates, most often seen first. A question a saved
 * answer now covers (same meaning, or a linked wording) is left out.
 */
export async function listUnanswered(managerId: string): Promise<UnansweredRow[]> {
  if (!(await ready())) return [];
  // A convenience list: a database problem never breaks the Profile page.
  try {
    return await readUnanswered(managerId);
  } catch (error) {
    console.error("The Needs answer list could not be read.", (error as { code?: string }).code || (error as Error).name);
    return [];
  }
}

async function readUnanswered(managerId: string): Promise<UnansweredRow[]> {
  const [rows, saved] = await Promise.all([
    db.select({ id: managerUnansweredQuestions.id, questionText: managerUnansweredQuestions.questionText, kind: managerUnansweredQuestions.kind,
      options: managerUnansweredQuestions.options, timesSeen: managerUnansweredQuestions.timesSeen, lastSeenAt: managerUnansweredQuestions.lastSeenAt })
      .from(managerUnansweredQuestions).where(eq(managerUnansweredQuestions.managerId, managerId))
      .orderBy(desc(managerUnansweredQuestions.timesSeen), desc(managerUnansweredQuestions.lastSeenAt)).limit(200),
    db.select({ questionText: managerApplyAnswers.questionText, answer: managerApplyAnswers.answer, scope: managerApplyAnswers.scope, variants: managerApplyAnswers.variants })
      .from(managerApplyAnswers).where(and(eq(managerApplyAnswers.managerId, managerId), eq(managerApplyAnswers.scope, "manager"))),
  ]);
  return rows.filter((row) => meaning.matchSaved(row.questionText, saved, { kind: row.kind, options: Array.isArray(row.options) ? row.options : [] })?.confidence !== "high").slice(0, 50)
    .map((row) => ({ ...row, options: Array.isArray(row.options) ? row.options : [] }));
}

/** The Manager dismisses a question from the list (it comes back if Apply meets it again). */
export async function dismissUnanswered(managerId: string, id: string): Promise<boolean> {
  if (!(await ready())) return false;
  const removed = await db.delete(managerUnansweredQuestions)
    .where(and(eq(managerUnansweredQuestions.id, id), eq(managerUnansweredQuestions.managerId, managerId))).returning({ id: managerUnansweredQuestions.id });
  return removed.length > 0;
}
