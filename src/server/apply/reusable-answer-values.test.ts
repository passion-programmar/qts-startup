import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuestionKey } from "./apply-values";
import { answerWarnings, describeWarning, similarQuestions, sourceOf, type AnswerRow } from "./reusable-answer-values";

const row = (id: string, questionText: string, answer: string, status = "approved"): AnswerRow => ({
  id, questionText, answer, status, questionKey: normalizeQuestionKey(questionText),
});

test("similar questions follow Apply's own matching: most of the shorter question's words", () => {
  assert.equal(similarQuestions("How did you hear about this job?", "How did you hear about us?"), true);
  assert.equal(similarQuestions("Are you willing to relocate?", "Willing to relocate for this role?"), true);
  assert.equal(similarQuestions("Do you require visa sponsorship?", "How did you hear about us?"), false);
  assert.equal(similarQuestions("", "Anything?"), false);
});

test("an answer is warned about the same question and similar ones, and whether they disagree", () => {
  const library = [
    row("a1", "How did you hear about us?", "LinkedIn"),
    row("a2", "Do you require visa sponsorship?", "No"),
    row("d1", "How did you hear about this job?", "Referral", "draft"),
    row("r1", "How did you hear about us?", "Indeed", "rejected"),
  ];
  const draft = { id: "new", questionText: "How did you hear about us?", questionKey: normalizeQuestionKey("How did you hear about us?"), answer: "linkedin " };
  const warnings = answerWarnings(draft, library);
  // The same approved question first (same answer, so no conflict), then the similar draft (a conflict);
  // the rejected answer and the unrelated one are left out.
  assert.deepEqual(warnings.map((w) => [w.match, w.status, w.conflict]), [["same", "approved", false], ["similar", "draft", true]]);
  assert.match(describeWarning(warnings[0]), /An approved answer for the same question says the same/);
  assert.match(describeWarning(warnings[1]), /A draft for a similar question .* says “Referral”/);
  // An answer is never warned about itself.
  assert.deepEqual(answerWarnings({ ...library[0] }, library).map((w) => w.status), ["draft"]);
});

test("unknown sources read as Super Admin's own", () => {
  assert.equal(sourceOf("learned"), "learned");
  assert.equal(sourceOf("something else"), "manual");
});
