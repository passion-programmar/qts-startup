import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPackage } from "@/app/pdf/document-data";

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

test("PDF document data rejects missing document sections", () => {
  assert.throws(
    () => parsePdfPackage(JSON.stringify({ resume: validPackage.resume })),
    /resume and coverLetter/,
  );
});
