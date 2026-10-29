import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import test from "node:test";
import { asc, eq, inArray, like } from "drizzle-orm";
import { applyQuestionMemory, reusableAnswerDrafts, reusableAnswers, reusableAnswerVersions, users } from "@/db/schema";
import { normalizeQuestionKey, parseReusableAnswer, type ReusableAnswerInput } from "./apply-values";
import type { LearnedAnswer } from "./question-memory-values";
import { MAX_VERSIONS_PER_QUESTION } from "./reusable-answer-values";

// The shared answer library against a real Postgres: Apply reads reusable_answers whole and finds
// only approved answers; drafts wait in their own table; every approved version that changes is kept
// and can be restored. Runs only with QTS_TEST_DATABASE_URL, an isolated test database (never
// production); every row it adds carries a marker and is deleted again.
const testDatabaseUrl = process.env.QTS_TEST_DATABASE_URL;
const skip = !testDatabaseUrl && "QTS_TEST_DATABASE_URL is not set";

async function loadLibrary() {
  process.env.DATABASE_URL = testDatabaseUrl;
  // Next resolves "server-only" to an empty module for server code; do the same here.
  const require = Module.createRequire(__filename);
  const serverOnly = require.resolve("server-only");
  require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  const [{ db }, library, memory] = await Promise.all([import("@/lib/db"), import("./reusable-answers"), import("./question-memory")]);
  const [[superAdmin], [manager]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(eq(users.role, "super_admin")).limit(1),
    db.select({ id: users.id }).from(users).where(eq(users.role, "manager")).limit(1),
  ]);
  assert.ok(superAdmin && manager, "the test database needs a Super Admin and a Manager");
  const marker = `qts-test-${randomUUID().slice(0, 8)}`;
  const input = (question: string, answer: string, note = ""): ReusableAnswerInput => {
    const parsed = parseReusableAnswer({ question: `${question} ${marker}`, answer, note });
    assert.ok(typeof parsed !== "string");
    return parsed;
  };
  const keyOf = (question: string) => normalizeQuestionKey(`${question} ${marker}`);
  const approvedForApply = async () => new Map((await library.loadApprovedReusableAnswers())
    .filter((row) => row.questionText.includes(marker)).map((row) => [row.questionText.replace(` ${marker}`, ""), row.answer]));
  const cleanUp = async () => {
    await db.delete(reusableAnswers).where(like(reusableAnswers.questionText, `%${marker}%`));
    await db.delete(reusableAnswerDrafts).where(like(reusableAnswerDrafts.questionText, `%${marker}%`));
    await db.delete(reusableAnswerVersions).where(like(reusableAnswerVersions.questionText, `%${marker}%`));
    await db.delete(applyQuestionMemory).where(like(applyQuestionMemory.questionText, `%${marker}%`));
  };
  return { db, ...library, ...memory, superAdmin, manager, marker, input, keyOf, approvedForApply, cleanUp };
}

test("only approved answers reach Apply; learning and Managers add drafts; review decides", { skip }, async () => {
  const lib = await loadLibrary();
  const { db, superAdmin, manager, input, keyOf, approvedForApply } = lib;
  const drafts = (question: string) => db.select().from(reusableAnswerDrafts).where(eq(reusableAnswerDrafts.questionKey, keyOf(question)));
  try {
    // An approved answer as Super Admin saves it today, plus a waiting draft and a rejected one.
    assert.ok((await lib.saveApprovedReusableAnswer(superAdmin.id, null, input("Hear about us", "LinkedIn"))).ok);
    await db.insert(reusableAnswerDrafts).values([
      { ...input("Hear about us", "Indeed"), status: "draft", source: "manager", createdByUserId: manager.id },
      { ...input("Background check", "Yes"), status: "rejected", source: "learned", createdByUserId: superAdmin.id },
    ]);
    assert.deepEqual([...await approvedForApply()], [["Hear about us", "LinkedIn"]], "Apply sees the approved answer only");

    // A second draft for the same question is refused (one waits at a time).
    assert.equal((await lib.proposeReusableAnswer(manager.id, input("Hear about us", "Glassdoor"))).ok, false);

    // Approving the draft for an approved question: the approved row takes its text, the replaced
    // version is kept with its question, answer and metadata, and the draft leaves.
    const [approvedBefore] = await db.select().from(reusableAnswers).where(eq(reusableAnswers.questionKey, keyOf("Hear about us")));
    const [draft] = await drafts("Hear about us");
    assert.ok((await lib.approveReusableAnswer(superAdmin.id, draft.id, input("Hear about us", "Indeed job board"))).ok);
    const [approvedAfter] = await db.select().from(reusableAnswers).where(eq(reusableAnswers.questionKey, keyOf("Hear about us")));
    assert.deepEqual([approvedAfter.id, approvedAfter.answer, approvedAfter.source, approvedAfter.reviewedByUserId], [approvedBefore.id, "Indeed job board", "manager", superAdmin.id]);
    assert.equal((await drafts("Hear about us")).length, 0);
    const [kept] = await db.select().from(reusableAnswerVersions).where(eq(reusableAnswerVersions.questionKey, keyOf("Hear about us")));
    assert.deepEqual(
      [kept.answerId, kept.questionText, kept.answer, kept.source, kept.createdByUserId, kept.answerCreatedAt.getTime(), kept.reason, kept.replacedByUserId],
      [approvedBefore.id, approvedBefore.questionText, "LinkedIn", "manual", superAdmin.id, approvedBefore.createdAt.getTime(), "replaced", superAdmin.id],
    );
    assert.equal((await approvedForApply()).get("Hear about us"), "Indeed job board");

    // A Manager's proposal for a new question: a draft with a warning for the similar approved one,
    // invisible to Apply until approved; approving it makes a new approved answer.
    const proposal = await lib.proposeReusableAnswer(manager.id, input("How did you hear about this role", "LinkedIn"));
    assert.ok(proposal.ok);
    assert.deepEqual(proposal.warnings.map((w) => [w.match, w.status, w.conflict]), [["similar", "approved", true]]);
    assert.equal((await approvedForApply()).has("How did you hear about this role"), false);
    const [proposed] = await drafts("How did you hear about this role");
    assert.ok((await lib.approveReusableAnswer(superAdmin.id, proposed.id, input("How did you hear about this role", "LinkedIn"))).ok);
    assert.equal((await approvedForApply()).get("How did you hear about this role"), "LinkedIn");
    // Reviewed already: approving or rejecting it again does nothing.
    assert.equal((await lib.approveReusableAnswer(superAdmin.id, proposed.id, input("How did you hear about this role", "X"))).ok, false);
    assert.equal(await lib.rejectReusableAnswer(superAdmin.id, proposed.id), false);

    // Rejecting and withdrawing: only drafts, and a Manager withdraws only their own.
    assert.ok((await lib.proposeReusableAnswer(manager.id, input("Relocate", "Yes"))).ok);
    const [relocate] = await drafts("Relocate");
    assert.equal(await lib.withdrawReusableAnswerProposal(randomUUID(), relocate.id), false);
    assert.equal(await lib.rejectReusableAnswer(superAdmin.id, relocate.id), true);
    assert.equal(await lib.withdrawReusableAnswerProposal(manager.id, relocate.id), false);
    assert.equal((await approvedForApply()).has("Relocate"), false);
    assert.ok((await lib.proposeReusableAnswer(manager.id, input("Sponsorship", "No"))).ok);
    const [sponsorship] = await drafts("Sponsorship");
    assert.equal(await lib.withdrawReusableAnswerProposal(manager.id, sponsorship.id), true);

    // Learning: five answers from people (three candidates) make a draft, never an approved answer;
    // AI answers make none; a rejected question is not proposed again.
    const learned = (question: string, source: string): LearnedAnswer => ({
      question: `${question} ${lib.marker}`, kind: "choice", answer: "Yes", source, options: ["Yes", "No"], intended: null,
    });
    for (const candidate of ["c1", "c2", "c3", "c1", "c2"]) {
      await lib.recordLearnedAnswers(candidate, [learned("Consent to terms", "manager"), learned("Agree to policy", "ai"), learned("Background check", "manager")]);
    }
    const [consent] = await drafts("Consent to terms");
    assert.deepEqual([consent?.status, consent?.source], ["draft", "learned"]);
    assert.equal((await approvedForApply()).has("Consent to terms"), false, "a learned draft never reaches Apply");
    assert.equal((await drafts("Agree to policy")).length, 0, "AI answers never make a draft");
    assert.deepEqual((await drafts("Background check")).map((row) => row.status), ["rejected"], "a rejected answer is not proposed again");
  } finally {
    await lib.cleanUp();
  }
});

test("every approved version that changes is kept and can be restored", { skip }, async () => {
  const lib = await loadLibrary();
  const { db, superAdmin, input, keyOf, approvedForApply } = lib;
  const versions = (question: string) => db.select().from(reusableAnswerVersions)
    .where(eq(reusableAnswerVersions.questionKey, keyOf(question))).orderBy(asc(reusableAnswerVersions.replacedAt));
  try {
    assert.ok((await lib.saveApprovedReusableAnswer(superAdmin.id, null, input("Notice period", "Immediately", "Pick the closest"))).ok);
    const [answer] = await db.select().from(reusableAnswers).where(eq(reusableAnswers.questionKey, keyOf("Notice period")));
    // An unchanged save keeps nothing; an edit keeps the version before it.
    assert.ok((await lib.saveApprovedReusableAnswer(superAdmin.id, answer.id, input("Notice period", "Immediately", "Pick the closest"))).ok);
    assert.equal((await versions("Notice period")).length, 0);
    assert.ok((await lib.saveApprovedReusableAnswer(superAdmin.id, answer.id, input("Notice period", "1 week"))).ok);
    assert.deepEqual((await versions("Notice period")).map((v) => [v.reason, v.answer, v.note]), [["edited", "Immediately", "Pick the closest"]]);

    // Restoring the old version over the current one keeps the current one first.
    const [edited] = await versions("Notice period");
    assert.ok((await lib.restoreReusableAnswerVersion(superAdmin.id, edited.id)).ok);
    assert.equal((await approvedForApply()).get("Notice period"), "Immediately");
    assert.deepEqual((await versions("Notice period")).map((v) => [v.reason, v.answer]), [["edited", "Immediately"], ["restored", "1 week"]]);

    // Deleting keeps the answer; restoring brings it back as an approved answer Apply uses.
    assert.equal(await lib.deleteReusableAnswer(superAdmin.id, answer.id), true);
    assert.equal((await approvedForApply()).has("Notice period"), false);
    const deleted = (await versions("Notice period")).at(-1)!;
    assert.deepEqual([deleted.reason, deleted.answer, deleted.answerId], ["deleted", "Immediately", answer.id]);
    assert.ok((await lib.restoreReusableAnswerVersion(superAdmin.id, deleted.id)).ok);
    assert.equal((await approvedForApply()).get("Notice period"), "Immediately");
    assert.equal((await versions("Notice period")).length, 3, "restoring keeps the restored version in the history");

    // At most 20 versions per question are kept, the newest.
    const [current] = await db.select().from(reusableAnswers).where(eq(reusableAnswers.questionKey, keyOf("Notice period")));
    for (let i = 0; i < MAX_VERSIONS_PER_QUESTION + 2; i += 1) {
      assert.ok((await lib.saveApprovedReusableAnswer(superAdmin.id, current.id, input("Notice period", `Edit ${i}`))).ok);
    }
    const all = await versions("Notice period");
    assert.equal(all.length, MAX_VERSIONS_PER_QUESTION);
    assert.equal(all.at(-1)!.answer, `Edit ${MAX_VERSIONS_PER_QUESTION}`);
  } finally {
    await lib.cleanUp();
    await db.delete(reusableAnswerVersions).where(inArray(reusableAnswerVersions.questionKey, [keyOf("Notice period")]));
  }
});
