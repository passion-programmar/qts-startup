import assert from "node:assert/strict";
import test from "node:test";
import { canShareQuestion, correctionKey, correctionScope, mergeVariants, parseCorrection, profileField } from "./manager-answer-values";

test("Manager Check scopes personal facts and contextual questions without universal guessing", () => {
  assert.equal(correctionScope("Location (City)*"), "candidate");
  assert.equal(profileField("Location (City)*"), "city");
  assert.equal(correctionScope("How did you hear about us?"), "manager");
  assert.equal(correctionScope("When can you start?"), "candidate");
  for (const q of ["Are you eligible to work here?", "Expected annual salary EUR", "Can you work onsite?", "Have you used our product?", "Additional details"]) assert.equal(correctionScope(q), "application", q);
  assert.equal(canShareQuestion("LinkedIn profile link"), false);
  assert.equal(canShareQuestion("Do you need sponsorship?"), false);
  assert.equal(canShareQuestion("How did you hear about us?"), true);
  assert.notEqual(correctionKey("LinkedIn profile link"), correctionKey("How did you hear about us?"));
});

test("Check validates actual choices, preserves false and excludes credentials", () => {
  assert.equal(typeof parseCorrection({ question: "Password", answer: "secret" }), "string");
  assert.equal(typeof parseCorrection({ question: "Email", answer: "invalid" }), "string");
  assert.equal(typeof parseCorrection({ question: "Source", answer: "Other", kind: "select", options: ["LinkedIn"] }), "string");
  const unchecked = parseCorrection({ question: "Privacy policy", answer: false, kind: "checkbox" });
  assert.notEqual(typeof unchecked, "string");
  if (typeof unchecked !== "string") assert.equal(unchecked.answer, "false");
  const link = parseCorrection({ question: "LinkedIn profile link", answer: "linkedin.com/in/test" });
  if (typeof link === "string") assert.fail(link);
  assert.equal(link.answer, "https://www.linkedin.com/in/test");
  assert.equal(typeof parseCorrection({ question: "Select tools", kind: "checkbox-group", answer: "A | B", options: ["A", "B"] }), "object");
});

test("equivalent LinkedIn variants survive; different answers replace only their meaning group", () => {
  const text = { kind: "text", options: [], answer: "LinkedIn" };
  const select = { kind: "select", options: ["LinkedIn Job Post", "Indeed"], answer: "LinkedIn Job Post" };
  const variants = mergeVariants([text], select);
  assert.deepEqual(variants, [text, select]);
  assert.deepEqual(mergeVariants(variants, { ...select, answer: "Indeed" }), [{ ...select, answer: "Indeed" }]);
  assert.deepEqual(mergeVariants(variants, { ...select, answer: "LinkedIn Recruiter" }), [{ ...select, answer: "LinkedIn Recruiter" }]);
  assert.deepEqual(mergeVariants(variants, select), variants, "retry is idempotent");
});
