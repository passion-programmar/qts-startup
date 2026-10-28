import assert from "node:assert/strict";
import test from "node:test";
import { isPerCandidateQuestion, isPersonalQuestion, mergeLearned, optionsKey, parseLearnedAnswers, safeAutoAnswer, type LearnedAnswer, type MemoryRow } from "./question-memory-values";

const item = (overrides: Partial<LearnedAnswer> = {}): LearnedAnswer => ({
  question: "Do you consent to a background check?",
  kind: "choice",
  answer: "Yes",
  source: "ai",
  options: ["Yes", "No"],
  intended: null,
  ...overrides,
});

test("only what can be shared is learned: no personal facts, documents, or profile answers", () => {
  const learned = parseLearnedAnswers([
    { question: "Do you consent to a background check?", answer: "Yes", source: "ai", options: ["Yes", "No"] },
    { question: "Email", answer: "a@b.com", source: "profile" },
    { question: "Nationality", answer: "Romanian", source: "ai" },
    { question: "Resume", answer: "cv.pdf", source: "documents" },
    { question: "Why do you want to join us?", answer: "Because…", source: "manager" },
  ]);
  assert.deepEqual(learned.map((entry) => [entry.question, entry.kind]), [
    ["Do you consent to a background check?", "choice"],
    ["Why do you want to join us?", "text"],
  ]);
});

test("a question's row counts answers per candidate and keeps free text out", () => {
  let row: MemoryRow | null = null;
  row = mergeLearned(row, item(), "c1");
  row = mergeLearned(row, item({ answer: "yes" }), "c2");
  row = mergeLearned(row, item({ answer: "No", options: ["No", "Yes"] }), "c1");
  assert.equal(row.timesSeen, 3);
  assert.equal(row.options.length, 1);
  assert.deepEqual(row.answers.map((entry) => [entry.answer, entry.count, entry.candidates]), [["Yes", 2, ["c1", "c2"]], ["No", 1, ["c1"]]]);
  const text = mergeLearned(null, item({ kind: "text", answer: "A long answer", options: [] }), "c1");
  assert.equal(text.timesSeen, 1);
  assert.deepEqual(text.answers, []);
});

test("a value that did not fit is remembered as the option it became, for that choice list", () => {
  const options = ["Yes, I am a British citizen", "Yes, I have ILR", "No"];
  let row = mergeLearned(null, item({ question: "Right to work?", answer: "Yes, I have ILR", options, intended: "Yes" }), "c1");
  row = mergeLearned(row, item({ question: "Right to work?", answer: "Yes, I have ILR", options: [...options].reverse(), intended: "yes" }), "c2");
  assert.deepEqual(row.choices, [{ optionsKey: optionsKey(options), intended: "Yes", choice: "Yes, I have ILR", uses: 2 }]);
});

test("a question becomes reusable by itself only when it is safe", () => {
  let row: MemoryRow | null = null;
  for (const candidate of ["c1", "c2", "c3", "c1", "c2"]) row = mergeLearned(row, item(), candidate);
  assert.equal(safeAutoAnswer(row!, "Do you consent to a background check?"), "Yes");
  // Four times only, or two candidates only: not yet.
  let few: MemoryRow | null = null;
  for (const candidate of ["c1", "c2", "c3", "c1"]) few = mergeLearned(few, item(), candidate);
  assert.equal(safeAutoAnswer(few!, "Do you consent to a background check?"), null);
  let twoPeople: MemoryRow | null = null;
  for (const candidate of ["c1", "c2", "c1", "c2", "c1"]) twoPeople = mergeLearned(twoPeople, item(), candidate);
  assert.equal(safeAutoAnswer(twoPeople!, "Do you consent to a background check?"), null);
  // Answered differently once, or about experience: never.
  const mixed = mergeLearned(row, item({ answer: "No" }), "c3");
  assert.equal(safeAutoAnswer(mixed, "Do you consent to a background check?"), null);
  assert.equal(safeAutoAnswer(row!, "Do you have experience with Kubernetes?"), null);
});

test("personal facts are never learned or suggested: location, where one lives, birthday", () => {
  for (const question of ["Location* (required)", "Where do you live now?", "Where are you based?", "Birthday*", "Date of birth", "Complete Address*", "First", "Last", "Place of residence"]) {
    assert.equal(isPersonalQuestion(question), true, question);
  }
  for (const question of ["What best describes your experience?", "Do you require visa sponsorship?", "How did you hear about us?"]) {
    assert.equal(isPersonalQuestion(question), false, question);
  }
});

test("questions each candidate answers differently are never suggested as one reusable answer", () => {
  for (const question of ["What compensation are you targeting?", "What best describes your experience?", "Can you briefly describe one experiment you ran to improve an ML or LLM-powered system?", "What are your salary expectations?", "Location* (required)"]) {
    assert.equal(isPerCandidateQuestion(question), true, question);
  }
  for (const question of ["Do you consent to a background check?", "How did you hear about us?", "Do you agree to our privacy policy?", "Do you require visa sponsorship?"]) {
    assert.equal(isPerCandidateQuestion(question), false, question);
  }
});
