import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLY_DOCUMENT_STATUSES,
  comparableJobUrl,
  canTakeWork,
  compareExtensionVersions,
  coverLetterText,
  defaultBrowserName,
  normalizeQuestionKey,
  parseAppliedAnswers,
  parseReusableAnswer,
  parseBrowserHeaders,
  resumeFolderOf,
  resumeText,
  workTypeOf,
} from "./apply-values";

test("extension versions compare numerically", () => {
  assert.equal(compareExtensionVersions("1.33.0", "1.33.0"), 0);
  assert.equal(compareExtensionVersions("1.9.0", "1.33.0"), -1);
  assert.equal(compareExtensionVersions("1.33.1", "1.33"), 1);
  assert.equal(compareExtensionVersions("1.x", "1.33.0"), null);
});

test("only current extensions take Generation or Apply work", () => {
  assert.equal(canTakeWork("1.36.0"), true);
  assert.equal(canTakeWork("1.35.6"), false);
  assert.equal(canTakeWork("2.0.0"), true);
  assert.equal(canTakeWork("1.33.2"), false);
  assert.equal(canTakeWork(null), false);
});

test("browser headers need a well-formed key", () => {
  const headers = new Headers({
    "x-qts-browser-key": "a1B2c3D4e5F6g7H8",
    "x-qts-extension-version": "1.33.0",
    "x-qts-browser-name": encodeURIComponent("  Office   PC "),
  });
  assert.deepEqual(parseBrowserHeaders(headers), {
    browserKey: "a1B2c3D4e5F6g7H8",
    extensionVersion: "1.33.0",
    browserName: "Office PC",
  });
  assert.equal(parseBrowserHeaders(new Headers({ "x-qts-browser-key": "short" })), null);
  assert.equal(parseBrowserHeaders(new Headers()), null);
  assert.equal(defaultBrowserName("a1b2c3d4e5f6g7h8"), "Chrome · A1B2");
});

test("the same question on different forms shares one key", () => {
  assert.equal(normalizeQuestionKey("Why Exadel? *"), normalizeQuestionKey("why exadel"));
  assert.equal(normalizeQuestionKey("Notice period (optional):"), "notice period");
});

test("a bid keeps the résumé's folder and one cleaned-up work type", () => {
  assert.equal(
    resumeFolderOf("QTS_Resume/MSK/Andrei Sava/2026-10-27_10-14-22_Senior DevOps_Sedona Digital/Andrei Sava.pdf"),
    "QTS_Resume/MSK/Andrei Sava/2026-10-27_10-14-22_Senior DevOps_Sedona Digital/",
  );
  assert.equal(resumeFolderOf("C:\\Downloads\\QTS_Resume\\a.pdf"), "C:/Downloads/QTS_Resume/");
  assert.equal(workTypeOf("FULL_TIME", "TELECOMMUTE"), "Full-time · Remote");
  assert.equal(workTypeOf("full-time", "Flexible working format - remote, office-based or flexible"), "Full-time · Hybrid");
  assert.equal(workTypeOf("", "Fully Remote"), "Remote");
  assert.equal(workTypeOf("B2B contract", "On-site"), "Contract · On-site");
  assert.equal(workTypeOf(null, ""), null);
});

test("the delivered résumé becomes plain text in the PDF's order", () => {
  const text = resumeText({
    candidate: { fullName: "Radu Star", headline: "Senior **LLM** Engineer" },
    summary: "Builds RAG systems.",
    sections: [
      { id: "experience", title: "Professional Experience", items: [
        { heading: "Senior LLM Engineer", subheading: "N-iX", location: "Iași, Romania", startDate: "2025-04", endDate: "present", focus: ["RAG"], bullets: ["Shipped **agents**."] },
      ] },
      { id: "skills", title: "Skills", items: [{ heading: "Languages", bullets: ["Python", "Go"] }] },
      { id: "empty", title: "Nothing", items: [] },
    ],
  });
  assert.equal(text, [
    "Radu Star",
    "Senior LLM Engineer",
    "",
    "Summary",
    "Builds RAG systems.",
    "",
    "Professional Experience",
    "Senior LLM Engineer · N-iX · Iași, Romania · 2025-04 – present",
    "Focus: RAG",
    "- Shipped agents.",
    "",
    "Skills",
    "Languages",
    "- Python",
    "- Go",
  ].join("\n"));
  assert.equal(resumeText(null), null);
});

test("the cover letter becomes plain text for text boxes", () => {
  assert.equal(
    coverLetterText({
      greeting: "Dear Hiring Manager,",
      paragraphs: ["I am applying for the **Cloud Platform Engineer** role.", "  I moved 40 services to Kubernetes. "],
      closing: "Kind regards,",
      signatureName: "Anna Kowalska",
    }),
    "Dear Hiring Manager,\n\nI am applying for the Cloud Platform Engineer role.\n\nI moved 40 services to Kubernetes.\n\nKind regards,\nAnna Kowalska",
  );
  assert.equal(coverLetterText({ paragraphs: [] }), null);
  assert.equal(coverLetterText(null), null);
});

test("reusable answers are trimmed, keyed by their question, and refused when empty or too long", () => {
  assert.deepEqual(parseReusableAnswer({ question: " How did you hear about us? ", answer: " LinkedIn job post ", note: "" }), {
    questionText: "How did you hear about us?",
    questionKey: "how did you hear about us",
    answer: "LinkedIn job post",
    note: null,
  });
  assert.equal(typeof parseReusableAnswer({ question: "", answer: "Yes", note: "" }), "string");
  assert.equal(typeof parseReusableAnswer({ question: "Why?", answer: "", note: "" }), "string");
  assert.equal(typeof parseReusableAnswer({ question: "Why?", answer: "x".repeat(4001), note: "" }), "string");
});

test("a run's answers are kept as question, answer, and source; malformed ones are left out", () => {
  assert.deepEqual(parseAppliedAnswers([
    { question: " Desired  Pay ", answer: "5000 EUR per month", source: "reusable" },
    { question: "Locations", answer: ["Leeds", "Remote"], source: "ai" },
    { question: "I agree to the privacy policy", answer: true, source: "consent" },
    { question: "Gender", answer: "Female", source: "made-up" },
    { question: "", answer: "x" },
    "not an answer",
  ]), [
    { question: "Desired Pay", answer: "5000 EUR per month", source: "reusable" },
    { question: "Locations", answer: "Leeds | Remote", source: "ai" },
    { question: "I agree to the privacy policy", answer: "Ticked", source: "consent" },
    { question: "Gender", answer: "Female", source: "ai" },
  ]);
  assert.deepEqual(parseAppliedAnswers(null), []);
});

test("the assistant's job pages (held for the Manager from the start) may fetch their résumé", () => {
  assert.ok(APPLY_DOCUMENT_STATUSES.includes("waiting_review"));
  assert.ok(APPLY_DOCUMENT_STATUSES.includes("claimed"));
});

test("a page address is compared without its #part and trailing slashes", () => {
  assert.equal(comparableJobUrl(" https://jobs.example.com/job/42/#apply "), "https://jobs.example.com/job/42");
  assert.equal(comparableJobUrl("https://jobs.elastic.co/form?gh_jid=8195964"), "https://jobs.elastic.co/form?gh_jid=8195964");
});
