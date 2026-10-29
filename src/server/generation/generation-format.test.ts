import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPackage } from "@/app/pdf/document-data";
import { DOCUMENT_FORMAT_RULES, DOCUMENT_OUTPUT_SHAPE } from "@/server/generation/generation-format";

// The shape with every empty value filled in, the way ChatGPT should answer.
function filledShape(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DOCUMENT_OUTPUT_SHAPE), (key, value) => {
    if (value === "YYYY-MM") return key === "endDate" ? "present" : "2021-04";
    if (value !== "") return value;
    if (key === "email") return "ana@example.com";
    if (key === "fullName" || key === "signatureName") return "Ana Petrova";
    if (key === "targetRole") return "Backend Engineer";
    if (key === "targetCompany" || key === "company") return "Acme";
    return "Filled text for this field";
  });
}

test("the output shape, filled in, passes the strict check every Generation answer must pass", () => {
  const data = parsePdfPackage(JSON.stringify(filledShape()), { requireCoreSections: true });
  assert.deepEqual(data.resume.sections.map((section) => section.id), ["skills", "experience", "projects", "education"]);
  assert.equal(data.coverLetter.targetCompany, "Acme");
  assert.equal(data.resume.sections[1].items[0].dateRange, "Apr 2021 – Present");
});

test("the format rules end with the output shape and say they override the prompt on structure", () => {
  const rules = DOCUMENT_FORMAT_RULES.join("\n\n");
  assert.match(rules, /override the instructions above on structure/);
  const shape = DOCUMENT_FORMAT_RULES[DOCUMENT_FORMAT_RULES.length - 1];
  assert.deepEqual(JSON.parse(shape.replace(/^Output shape:\n/, "")), DOCUMENT_OUTPUT_SHAPE);
});
