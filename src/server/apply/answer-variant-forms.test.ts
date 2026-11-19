import assert from "node:assert/strict";
import test from "node:test";
import { addAlternative, alternativesOf, deleteSiteForm, editSiteForm, MAX_ALTERNATIVES, removeAlternative, siteFormsOf, unwrapVariant } from "./answer-variant-forms";
import type { AnswerVariant } from "./manager-answer-values";

const text: AnswerVariant = { kind: "text", options: [], answer: "1 month", questionText: "Notice period" };
const alt: AnswerVariant = { kind: "alternative", options: [], answer: "30 days" };
const wrappedAlt: AnswerVariant = { kind: "normal-variation", options: [], answer: "1 month", normalVariation: { kind: "alternative", options: [], answer: "4 weeks" } };
const site: AnswerVariant = { kind: "select", options: ["2 weeks", "4 weeks"], answer: "4 weeks", site: "job-boards.greenhouse.io/akamai" };
const wrappedSite: AnswerVariant = { kind: "normal-variation", options: [], answer: "1 month", identity: { key: "notice" } as AnswerVariant["identity"],
  normalVariation: { kind: "text", options: [], answer: "One month", site: "jobs.lever.co/acme" } };
const all = [text, alt, wrappedAlt, site, wrappedSite];

test("unwrap reads the real entry of a wrapped variant", () => {
  assert.equal(unwrapVariant(wrappedAlt).answer, "4 weeks");
  assert.equal(unwrapVariant(text), text);
});

test("lists other forms and per-site forms, wrapped or not", () => {
  assert.deepEqual(alternativesOf(all), ["30 days", "4 weeks"]);
  assert.deepEqual(siteFormsOf(all), [
    { site: "job-boards.greenhouse.io/akamai", kind: "select", answer: "4 weeks" },
    { site: "jobs.lever.co/acme", kind: "text", answer: "One month" },
  ]);
});

test("adds an alternative: trimmed, 1-500 chars, no case-insensitive duplicates, max 20", () => {
  const added = addAlternative(all, "  30   ", "1 month");
  assert.ok(added.ok);
  assert.deepEqual(added.variants.slice(0, all.length), all);
  assert.deepEqual(added.variants.at(-1), { kind: "alternative", options: [], answer: "30" });
  assert.equal(addAlternative(all, "30 DAYS").ok, false);
  assert.equal(addAlternative(all, "4 Weeks").ok, false);
  assert.equal(addAlternative(all, "1 MONTH", "1 month").ok, false);
  assert.equal(addAlternative(all, "   ").ok, false);
  assert.equal(addAlternative(all, "x".repeat(501)).ok, false);
  assert.equal(addAlternative(all, "x".repeat(500)).ok, true);
  const full = Array.from({ length: MAX_ALTERNATIVES }, (_, i) => ({ kind: "alternative", options: [], answer: `form ${i}` }));
  assert.equal(addAlternative(full, "one more").ok, false);
});

test("removes an alternative (also wrapped) and keeps the rest", () => {
  const removed = removeAlternative(all, "30 days");
  assert.ok(removed.ok);
  assert.deepEqual(removed.variants, [text, wrappedAlt, site, wrappedSite]);
  const wrapped = removeAlternative(all, "4 WEEKS");
  assert.ok(wrapped.ok);
  assert.deepEqual(wrapped.variants, [text, alt, site, wrappedSite]);
  assert.equal(removeAlternative(all, "missing").ok, false);
});

test("edits a site form by site + kind, keeping wrapping and other variants", () => {
  const plain = editSiteForm(all, "job-boards.greenhouse.io/akamai", "select", " 2 weeks ");
  assert.ok(plain.ok);
  assert.deepEqual(plain.variants[3], { ...site, answer: "2 weeks" });
  assert.deepEqual(plain.variants.filter((_, i) => i !== 3), all.filter((_, i) => i !== 3));
  const wrapped = editSiteForm(all, "jobs.lever.co/acme", "text", "30 days");
  assert.ok(wrapped.ok);
  assert.deepEqual(wrapped.variants[4], { ...wrappedSite, normalVariation: { ...wrappedSite.normalVariation, answer: "30 days" } });
  assert.equal(wrapped.variants[4].answer, "1 month");
  assert.equal(editSiteForm(all, "jobs.lever.co/acme", "select", "x").ok, false);
  assert.equal(editSiteForm(all, "jobs.lever.co/acme", "text", "").ok, false);
});

test("deletes a site form by site + kind only", () => {
  const removed = deleteSiteForm(all, "jobs.lever.co/acme", "text");
  assert.ok(removed.ok);
  assert.deepEqual(removed.variants, [text, alt, wrappedAlt, site]);
  assert.equal(deleteSiteForm(all, "jobs.lever.co/acme", "select").ok, false);
  assert.equal(deleteSiteForm(all, "", "text").ok, false);
});
