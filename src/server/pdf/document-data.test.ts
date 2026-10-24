import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import sampleFull from "@/app/pdf/sample-full.json";

const validPackage = {
  resume: {
    candidate: { fullName: "Test Candidate", email: "test@example.com" },
    targetRole: "Engineer",
    sections: [{ title: "Experience", items: [{ heading: "Engineer", bullets: ["Built systems"] }] }],
  },
  coverLetter: {
    candidate: { fullName: "Test Candidate", email: "test@example.com" },
    targetRole: "Engineer",
    targetCompany: "Example",
    bodyParagraphs: ["I am applying for this role."],
  },
};

test("PDF document data accepts one resume and cover-letter JSON object", () => {
  const parsed = parsePdfPackage(JSON.stringify(validPackage));
  assert.equal(parsed.resume.targetRole, "Engineer");
  assert.equal(parsed.coverLetter.targetCompany, "Example");
});

test("validated QTS data adapts to the HTML template contract without losing document fields", () => {
  const adapted = toResumeTemplateData(
    parsePdfPackage(JSON.stringify(validPackage)),
    "qts-standard",
  );
  assert.equal(adapted.candidate.fullName, "Test Candidate");
  assert.equal(adapted.resume.sections[0].items[0].bullets[0], "Built systems");
  assert.equal(adapted.coverLetter.paragraphs[0], "I am applying for this role.");
  assert.equal(adapted.coverLetter.candidate.email, "test@example.com");
  assert.deepEqual(adapted.theme, {
    template: "qts-standard",
    contentConsistency: "uniform",
    contactStyle: "inline",
    bulletStyle: "disc",
    titleCase: "title",
    datePosition: "inline",
    skillsLayout: "rows",
    skillDetail: "bracket",
    dateSeparator: "–",
  });
});

test("the supplied full template sample parses and retains its content and theme", () => {
  const parsed = parsePdfPackage(JSON.stringify(sampleFull));
  assert.equal(parsed.resume.sections.length, 7);
  assert.deepEqual(parsed.resume.sections[3].items[0].bullets?.[0], {
    name: "Planning",
    detail: "Advanced",
  });
  assert.deepEqual(parsed.coverLetter.recipient?.address, ["[Street Address]", "City, Country"]);
  assert.equal(parsed.coverLetter.bodyParagraphs.length, 3);
  assert.deepEqual(parsed.theme?.sectionOrder?.slice(0, 3), [
    "summary",
    "experience",
    "skills",
  ]);

  const adapted = toResumeTemplateData(parsed, "classic");
  assert.equal(adapted.theme.template, "classic");
  assert.equal(adapted.candidate.links?.[0].label, "Portfolio");
  assert.equal(adapted.resume.sections[3].type, "skills");
  assert.deepEqual(adapted.resume.sections[3].items[0].bullets[0], {
    name: "Planning",
    detail: "Advanced",
  });
  assert.equal(adapted.coverLetter.recipient?.company, "Example Employer");
});

test("PDF document data rejects missing document sections", () => {
  assert.throws(
    () => parsePdfPackage(JSON.stringify({ resume: validPackage.resume })),
    /resume and coverLetter/,
  );
});
