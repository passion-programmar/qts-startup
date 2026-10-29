import "server-only";

import { and, count, desc, eq, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { reusableAnswerDrafts, reusableAnswers, reusableAnswerVersions, users } from "@/db/schema";
import { db } from "@/lib/db";
import type { ReusableAnswerInput } from "./apply-values";
import {
  type AnswerRow,
  type AnswerWarning,
  answerWarnings,
  MAX_DRAFTS_PER_MANAGER,
  MAX_VERSIONS_PER_QUESTION,
  type ReusableAnswerSource,
  sourceOf,
  type VersionReason,
} from "./reusable-answer-values";

// The one reusable-answer library every candidate shares. reusable_answers holds only approved
// answers, so Apply (and any older release) reads it whole and never meets an unreviewed one.
// Drafts (learned, or proposed by Managers) wait in reusable_answer_drafts for Super Admin; every
// approved version that is edited, replaced, restored over, or deleted is kept in
// reusable_answer_versions and can be restored.

/** The answers Apply uses: every approved answer, the same fields as before review existed. */
export async function loadApprovedReusableAnswers() {
  return db
    .select({
      questionKey: reusableAnswers.questionKey,
      questionText: reusableAnswers.questionText,
      answer: reusableAnswers.answer,
      note: reusableAnswers.note,
    })
    .from(reusableAnswers);
}

export type LibraryAnswer = {
  id: string;
  questionKey: string;
  questionText: string;
  answer: string;
  note: string | null;
  autoAdded: boolean;
  status: "approved" | "draft" | "rejected";
  source: ReusableAnswerSource;
  createdById: string;
  createdBy: string;
  reviewedBy: string | null;
  createdAt: string;
};

export type AnswerVersion = {
  id: string;
  questionKey: string;
  questionText: string;
  answer: string;
  note: string | null;
  source: ReusableAnswerSource;
  reason: VersionReason;
  replacedBy: string | null;
  replacedAt: string;
};

const author = alias(users, "author");
const reviewer = alias(users, "reviewer");

/** Every approved answer and every draft or rejected one, with who wrote and reviewed it. */
export async function listLibrary(): Promise<LibraryAnswer[]> {
  const [approved, drafts] = await db.batch([
    db.select({
      id: reusableAnswers.id,
      questionKey: reusableAnswers.questionKey,
      questionText: reusableAnswers.questionText,
      answer: reusableAnswers.answer,
      note: reusableAnswers.note,
      autoAdded: reusableAnswers.autoAdded,
      source: reusableAnswers.source,
      createdById: reusableAnswers.createdByUserId,
      createdBy: author.displayName,
      reviewedBy: reviewer.displayName,
      createdAt: reusableAnswers.createdAt,
    })
      .from(reusableAnswers)
      .innerJoin(author, eq(author.id, reusableAnswers.createdByUserId))
      .leftJoin(reviewer, eq(reviewer.id, reusableAnswers.reviewedByUserId)),
    db.select({
      id: reusableAnswerDrafts.id,
      questionKey: reusableAnswerDrafts.questionKey,
      questionText: reusableAnswerDrafts.questionText,
      answer: reusableAnswerDrafts.answer,
      note: reusableAnswerDrafts.note,
      status: reusableAnswerDrafts.status,
      source: reusableAnswerDrafts.source,
      createdById: reusableAnswerDrafts.createdByUserId,
      createdBy: author.displayName,
      reviewedBy: reviewer.displayName,
      createdAt: reusableAnswerDrafts.createdAt,
    })
      .from(reusableAnswerDrafts)
      .innerJoin(author, eq(author.id, reusableAnswerDrafts.createdByUserId))
      .leftJoin(reviewer, eq(reviewer.id, reusableAnswerDrafts.reviewedByUserId)),
  ]);
  return [
    ...approved.map((row) => ({ ...row, status: "approved" as const })),
    ...drafts.map((row) => ({ ...row, autoAdded: false, status: row.status === "rejected" ? "rejected" as const : "draft" as const })),
  ]
    .map((row) => ({ ...row, createdBy: row.createdBy ?? "", source: sourceOf(row.source), createdAt: row.createdAt.toISOString() }))
    .sort((a, b) => a.questionText.localeCompare(b.questionText));
}

const replacer = alias(users, "replacer");

/** Earlier approved versions, newest first, for Settings (at most 20 per question are kept). */
export async function listVersions(): Promise<AnswerVersion[]> {
  const rows = await db
    .select({
      id: reusableAnswerVersions.id,
      questionKey: reusableAnswerVersions.questionKey,
      questionText: reusableAnswerVersions.questionText,
      answer: reusableAnswerVersions.answer,
      note: reusableAnswerVersions.note,
      source: reusableAnswerVersions.source,
      reason: reusableAnswerVersions.reason,
      replacedBy: replacer.displayName,
      replacedAt: reusableAnswerVersions.replacedAt,
    })
    .from(reusableAnswerVersions)
    .leftJoin(replacer, eq(replacer.id, reusableAnswerVersions.replacedByUserId))
    .orderBy(desc(reusableAnswerVersions.replacedAt));
  return rows.map((row) => ({ ...row, source: sourceOf(row.source), reason: row.reason as VersionReason, replacedAt: row.replacedAt.toISOString() }));
}

// ---- History: the approved row as it is now, kept before it changes ----

/** Saves the approved answer as it is now into its history, in the same batch as the change. */
function keepVersion(answerId: string, reason: VersionReason, actorId: string) {
  // Every column of reusable_answer_versions, in its order (Drizzle's insert-from-select needs that).
  return db.insert(reusableAnswerVersions).select(
    db.select({
      id: sql<string>`gen_random_uuid()`.as("id"),
      answerId: reusableAnswers.id,
      questionKey: reusableAnswers.questionKey,
      questionText: reusableAnswers.questionText,
      answer: reusableAnswers.answer,
      note: reusableAnswers.note,
      autoAdded: reusableAnswers.autoAdded,
      source: reusableAnswers.source,
      createdByUserId: reusableAnswers.createdByUserId,
      reviewedByUserId: reusableAnswers.reviewedByUserId,
      reviewedAt: reusableAnswers.reviewedAt,
      answerCreatedAt: reusableAnswers.createdAt,
      answerUpdatedAt: reusableAnswers.updatedAt,
      reason: sql<string>`${reason}::text`.as("reason"),
      replacedByUserId: sql<string>`${actorId}::uuid`.as("replaced_by_user_id"),
      replacedAt: sql<Date>`now()`.as("replaced_at"),
    }).from(reusableAnswers).where(eq(reusableAnswers.id, answerId)),
  );
}

/** Keeps the 20 newest versions of one question. */
function trimVersions(questionKey: string) {
  return db.delete(reusableAnswerVersions).where(and(
    eq(reusableAnswerVersions.questionKey, questionKey),
    notInArray(
      reusableAnswerVersions.id,
      db.select({ id: reusableAnswerVersions.id }).from(reusableAnswerVersions)
        .where(eq(reusableAnswerVersions.questionKey, questionKey))
        .orderBy(desc(reusableAnswerVersions.replacedAt))
        .limit(MAX_VERSIONS_PER_QUESTION),
    ),
  ));
}

type Outcome = { ok: true; warnings: AnswerWarning[] } | { ok: false; error: string };

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && ((error as { code?: string }).code === "23505"
    || (error as { cause?: { code?: string } }).cause?.code === "23505");

// The approved answers and waiting drafts a new answer is compared with.
async function comparableRows(): Promise<AnswerRow[]> {
  const [approved, drafts] = await db.batch([
    db.select({ id: reusableAnswers.id, questionKey: reusableAnswers.questionKey, questionText: reusableAnswers.questionText, answer: reusableAnswers.answer })
      .from(reusableAnswers),
    db.select({ id: reusableAnswerDrafts.id, questionKey: reusableAnswerDrafts.questionKey, questionText: reusableAnswerDrafts.questionText, answer: reusableAnswerDrafts.answer })
      .from(reusableAnswerDrafts).where(eq(reusableAnswerDrafts.status, "draft")),
  ]);
  return [...approved.map((row) => ({ ...row, status: "approved" })), ...drafts.map((row) => ({ ...row, status: "draft" }))];
}

// ---- Super Admin's own answers ----

/**
 * Super Admin adds an approved answer, or edits one (the version before the edit is kept). One
 * approved answer per question.
 */
export async function saveApprovedReusableAnswer(actorId: string, answerId: string | null, input: ReusableAnswerInput): Promise<Outcome> {
  const [clash] = await db.select({ id: reusableAnswers.id }).from(reusableAnswers)
    .where(eq(reusableAnswers.questionKey, input.questionKey)).limit(1);
  if (clash && clash.id !== answerId) return { ok: false, error: "That question already has a reusable answer; edit it instead." };
  // A Super Admin's save makes an automatically added answer their own.
  const values = { ...input, autoAdded: false, updatedAt: new Date() };
  try {
    if (!answerId) {
      await db.insert(reusableAnswers).values({ ...values, createdByUserId: actorId });
      return { ok: true, warnings: [] };
    }
    const [current] = await db.select().from(reusableAnswers).where(eq(reusableAnswers.id, answerId)).limit(1);
    if (!current) return { ok: false, error: "That answer was deleted. Refresh the page." };
    const unchanged = current.questionText === input.questionText && current.answer === input.answer && current.note === input.note;
    const update = db.update(reusableAnswers).set(values).where(eq(reusableAnswers.id, answerId));
    if (unchanged) await update;
    else await db.batch([keepVersion(answerId, "edited", actorId), update, trimVersions(input.questionKey), trimVersions(current.questionKey)]);
    return { ok: true, warnings: [] };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "That question already has a reusable answer; edit it instead." };
    throw error;
  }
}

/** Super Admin deletes an approved answer (kept in its history) or a rejected draft. */
export async function deleteReusableAnswer(actorId: string, answerId: string): Promise<boolean> {
  const [current] = await db.select({ questionKey: reusableAnswers.questionKey }).from(reusableAnswers).where(eq(reusableAnswers.id, answerId)).limit(1);
  if (current) {
    await db.batch([keepVersion(answerId, "deleted", actorId), db.delete(reusableAnswers).where(eq(reusableAnswers.id, answerId)), trimVersions(current.questionKey)]);
    return true;
  }
  const deleted = await db.delete(reusableAnswerDrafts)
    .where(and(eq(reusableAnswerDrafts.id, answerId), eq(reusableAnswerDrafts.status, "rejected")))
    .returning({ id: reusableAnswerDrafts.id });
  return deleted.length > 0;
}

/**
 * Super Admin restores an earlier version: it becomes the approved answer for its question again
 * (the current one, if any, is kept in the history first). The restored version stays in the history.
 */
export async function restoreReusableAnswerVersion(actorId: string, versionId: string): Promise<Outcome> {
  const [version] = await db.select().from(reusableAnswerVersions).where(eq(reusableAnswerVersions.id, versionId)).limit(1);
  if (!version) return { ok: false, error: "That version is no longer kept. Refresh the page." };
  const [current] = await db.select({ id: reusableAnswers.id }).from(reusableAnswers).where(eq(reusableAnswers.questionKey, version.questionKey)).limit(1);
  const now = new Date();
  const restored = {
    questionKey: version.questionKey,
    questionText: version.questionText,
    answer: version.answer,
    note: version.note,
    autoAdded: version.autoAdded,
    source: version.source,
    reviewedByUserId: actorId,
    reviewedAt: now,
    updatedAt: now,
  };
  try {
    if (current) {
      await db.batch([
        keepVersion(current.id, "restored", actorId),
        db.update(reusableAnswers).set(restored).where(eq(reusableAnswers.id, current.id)),
        trimVersions(version.questionKey),
      ]);
    } else {
      await db.insert(reusableAnswers).values({ ...restored, createdByUserId: version.createdByUserId ?? actorId });
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "That question was just given an answer. Refresh the page and try again." };
    throw error;
  }
  return { ok: true, warnings: [] };
}

// ---- Drafts: Managers' proposals and learned answers, reviewed by Super Admin ----

/**
 * A Manager's proposal: a draft for Super Admin, never live. It may propose a new answer to an
 * approved question; one draft per question waits at a time.
 */
export async function proposeReusableAnswer(managerId: string, input: ReusableAnswerInput): Promise<Outcome> {
  const [[waiting], [mine]] = await db.batch([
    db.select({ id: reusableAnswerDrafts.id }).from(reusableAnswerDrafts)
      .where(and(eq(reusableAnswerDrafts.questionKey, input.questionKey), eq(reusableAnswerDrafts.status, "draft"))).limit(1),
    db.select({ n: count() }).from(reusableAnswerDrafts)
      .where(and(eq(reusableAnswerDrafts.createdByUserId, managerId), eq(reusableAnswerDrafts.status, "draft"))),
  ]);
  if (waiting) return { ok: false, error: "A proposal for this question is already waiting for Super Admin's review." };
  if (mine.n >= MAX_DRAFTS_PER_MANAGER) {
    return { ok: false, error: `You have ${MAX_DRAFTS_PER_MANAGER} proposals waiting for review. Wait for Super Admin to review them first.` };
  }
  const others = await comparableRows();
  try {
    const [row] = await db.insert(reusableAnswerDrafts)
      .values({ ...input, status: "draft", source: "manager", createdByUserId: managerId })
      .returning({ id: reusableAnswerDrafts.id });
    return { ok: true, warnings: answerWarnings({ id: row.id, ...input }, others) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "A proposal for this question is already waiting for Super Admin's review." };
    throw error;
  }
}

/** A Manager takes back their own draft; rejected ones stay. */
export async function withdrawReusableAnswerProposal(managerId: string, draftId: string): Promise<boolean> {
  const deleted = await db.delete(reusableAnswerDrafts)
    .where(and(eq(reusableAnswerDrafts.id, draftId), eq(reusableAnswerDrafts.createdByUserId, managerId), eq(reusableAnswerDrafts.status, "draft")))
    .returning({ id: reusableAnswerDrafts.id });
  return deleted.length > 0;
}

/**
 * Super Admin approves a draft, as edited in the form. When its question already has an approved
 * answer, that answer is kept in the history and takes the draft's text in its own row; otherwise
 * the draft becomes a new approved answer. Either way the draft leaves the drafts table.
 */
export async function approveReusableAnswer(reviewerId: string, draftId: string, input: ReusableAnswerInput): Promise<Outcome> {
  const [[draft], [approved]] = await db.batch([
    db.select({ source: reusableAnswerDrafts.source, createdByUserId: reusableAnswerDrafts.createdByUserId }).from(reusableAnswerDrafts)
      .where(and(eq(reusableAnswerDrafts.id, draftId), eq(reusableAnswerDrafts.status, "draft"))).limit(1),
    db.select({ id: reusableAnswers.id }).from(reusableAnswers).where(eq(reusableAnswers.questionKey, input.questionKey)).limit(1),
  ]);
  if (!draft) return { ok: false, error: "That draft was already reviewed or withdrawn. Refresh the page." };
  const others = (await comparableRows()).filter((row) => row.id !== approved?.id && row.id !== draftId);
  const now = new Date();
  const reviewed = { ...input, source: sourceOf(draft.source), autoAdded: false, reviewedByUserId: reviewerId, reviewedAt: now, updatedAt: now };
  const removeDraft = db.delete(reusableAnswerDrafts).where(and(eq(reusableAnswerDrafts.id, draftId), eq(reusableAnswerDrafts.status, "draft")));
  try {
    if (approved) {
      await db.batch([
        keepVersion(approved.id, "replaced", reviewerId),
        db.update(reusableAnswers).set(reviewed).where(eq(reusableAnswers.id, approved.id)),
        removeDraft,
        trimVersions(input.questionKey),
      ]);
    } else {
      await db.batch([db.insert(reusableAnswers).values({ ...reviewed, createdByUserId: draft.createdByUserId }), removeDraft]);
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "That question was just given an approved answer. Refresh the page and review again." };
    throw error;
  }
  return { ok: true, warnings: answerWarnings({ id: draftId, ...input }, others) };
}

/** Super Admin rejects a draft. It is kept, so Apply's learning does not propose it again. */
export async function rejectReusableAnswer(reviewerId: string, draftId: string): Promise<boolean> {
  const now = new Date();
  const updated = await db.update(reusableAnswerDrafts)
    .set({ status: "rejected", reviewedByUserId: reviewerId, reviewedAt: now, updatedAt: now })
    .where(and(eq(reusableAnswerDrafts.id, draftId), eq(reusableAnswerDrafts.status, "draft")))
    .returning({ id: reusableAnswerDrafts.id });
  return updated.length > 0;
}
