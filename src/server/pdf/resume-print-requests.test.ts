import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import sample from "@/app/pdf/sample-full.json";
import { pdfTemplateValues } from "./pdf-templates";

// The extension's check of the Resume page's print requests (extension/shared/resume-print-requests.js).
const prints = createRequire(import.meta.url)(
  path.join(process.cwd(), "extension", "shared", "resume-print-requests.js"),
) as {
  TEMPLATES: readonly string[];
  checkPrintJob: (job: unknown) => { key?: string; error?: string };
};

test("the extension accepts exactly the 24 templates QTS has", () => {
  assert.deepEqual([...prints.TEMPLATES], [...pdfTemplateValues]);
});

test("the extension accepts what the Resume page sends for every template", () => {
  const data = parsePdfPackage(JSON.stringify(sample));
  for (const template of pdfTemplateValues) {
    const result = prints.checkPrintJob({ template, data: toResumeTemplateData(data, template) });
    assert.equal(result.error, undefined, template);
    assert.ok(result.key?.startsWith(`${template}\n`), template);
  }
});

test("data prepared for one template is refused for another", () => {
  const data = toResumeTemplateData(parsePdfPackage(JSON.stringify(sample)), "classic");
  assert.match(prints.checkPrintJob({ template: "harvard", data }).error ?? "", /another template/);
});
