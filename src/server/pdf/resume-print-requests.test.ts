import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import sample from "@/app/pdf/sample-full.json";
import { pdfTemplateSupportedValues, pdfTemplateValues } from "./pdf-templates";

// The extension's check of the Resume page's print requests (extension/shared/resume-print-requests.js).
const prints = createRequire(import.meta.url)(
  path.join(process.cwd(), "extension", "shared", "resume-print-requests.js"),
) as {
  TEMPLATES: readonly string[];
  checkPrintJob: (job: unknown) => { key?: string; error?: string };
};

test("the extension accepts all supported templates, including hidden saved templates", () => {
  assert.deepEqual([...prints.TEMPLATES], [...pdfTemplateSupportedValues]);
});

test("the browser's new-template selector matches the Generation rotation order", () => {
  const browserWindow: {
    RESUME_TEMPLATES?: Array<{ id: string; name: string }>;
    ACTIVE_RESUME_TEMPLATE_IDS?: string[];
  } = {};
  vm.runInNewContext(
    readFileSync("public/resume-templates/js/templates.js", "utf8"),
    { window: browserWindow },
  );
  assert.deepEqual(Array.from(browserWindow.ACTIVE_RESUME_TEMPLATE_IDS ?? []), [...pdfTemplateValues]);
  const activeTemplates = new Map(
    Array.from(browserWindow.RESUME_TEMPLATES ?? [], (template) => [template.id, template.name]),
  );
  assert.deepEqual(
    pdfTemplateValues.map((template) => activeTemplates.get(template)),
    Array.from({ length: 13 }, (_, index) => `QTS Template ${index + 1}`),
  );
});

test("the extension accepts what the Resume page sends for every supported template", () => {
  const data = parsePdfPackage(JSON.stringify(sample));
  for (const template of pdfTemplateSupportedValues) {
    const result = prints.checkPrintJob({ template, data: toResumeTemplateData(data, template) });
    assert.equal(result.error, undefined, template);
    assert.ok(result.key?.startsWith(`${template}\n`), template);
  }
});

test("data prepared for one template is refused for another", () => {
  const data = toResumeTemplateData(parsePdfPackage(JSON.stringify(sample)), "classic");
  assert.match(prints.checkPrintJob({ template: "nordic", data }).error ?? "", /another template/);
});
