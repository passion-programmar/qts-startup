import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as documentData from "@/app/pdf/document-data";
import { parsePdfPackage } from "@/app/pdf/document-data";
import * as artifacts from "@/server/generation/generation-artifacts";
import * as pdfTemplates from "@/server/pdf/pdf-templates";
import * as templateStyles from "@/server/pdf/template-style-values";
import { readTemplateStyles, templateStylesKey, withTemplateStyle } from "@/server/pdf/template-style-values";
import sample from "@/app/pdf/default-resume.json";

test("saved styles keep only current templates and valid settings", () => {
  const styles = readTemplateStyles({
    classic: { nameSize: 20, lineHeight: 1.2, titleStyle: "band", accentColor: "#AA0000", showPageNumbers: true },
    nordic: { nameSize: 999, titleStyle: "fancy", bodySize: 10 },
    harvard: { nameSize: 20 },
    minimal: {},
  });
  assert.deepEqual(styles, {
    classic: { nameSize: 20, lineHeight: 1.2, titleStyle: "band", accentColor: "#AA0000", showPageNumbers: true },
    nordic: { bodySize: 10 },
  });
  assert.deepEqual(readTemplateStyles(null), {});
  assert.deepEqual(readTemplateStyles([1, 2]), {});
  assert.equal(templateStylesKey("m1"), "pdf-template-styles:m1");
});

test("a style applies only to its own template", () => {
  const data = parsePdfPackage(JSON.stringify(sample));
  const styles = readTemplateStyles({ classic: { nameSize: 20 } });
  assert.equal(withTemplateStyle(data, styles, "classic").theme?.nameSize, 20);
  assert.equal(withTemplateStyle(data, styles, "nordic"), data);
});

// generation-documents.ts with a stand-in database that returns one completed run.
function loadGenerationDocuments(row: Record<string, unknown> | null) {
  const query = { from: () => query, innerJoin: () => query, leftJoin: () => query, where: () => query, limit: async () => (row ? [row] : []) };
  const testModule = { exports: {} as Record<string, (...args: unknown[]) => Promise<unknown>> };
  const code = transformSync(readFileSync("src/server/generation/generation-documents.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
  const imports: Record<string, unknown> = {
    "server-only": {},
    "drizzle-orm": { and: () => ({}), eq: () => ({}) },
    "@/db/schema": { generationRuns: {}, jobs: {}, profiles: {}, settings: {} },
    "@/lib/db": { db: { select: () => query } },
    "@/app/pdf/document-data": documentData,
    "@/server/generation/generation-artifacts": artifacts,
    "@/server/pdf/pdf-templates": pdfTemplates,
    "@/server/pdf/template-style-values": templateStyles,
  };
  vm.runInNewContext(code, {
    module: testModule, exports: testModule.exports, Buffer,
    require: (id: string) => {
      if (id in imports) return imports[id];
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return testModule.exports.loadGenerationDocuments as (managerId: string, managerName: string, id: string) => Promise<{ data: { theme?: Record<string, unknown> }; template: string } | null>;
}

const run = {
  responseJson: sample, jobDescription: "JD", jobTitle: "Engineer", company: "ACME", firstName: "Sample", lastName: "Candidate",
  runTemplate: "classic", profileTemplate: "qts-standard", createdAt: new Date("2026-11-07T00:00:00Z"),
};

test("Generation prints with the Manager's saved style for the run's template", async () => {
  const load = loadGenerationDocuments({ ...run, styles: { classic: { nameSize: 20, marginSide: 12 }, nordic: { nameSize: 30 } } });
  const documents = await load("m1", "Manager", "00000000-0000-4000-8000-000000000000");
  assert.equal(documents?.template, "classic");
  assert.equal(documents?.data.theme?.nameSize, 20);
  assert.equal(documents?.data.theme?.marginSide, 12);
});

test("Generation without a saved style for the template prints exactly as before", async () => {
  for (const styles of [null, { nordic: { nameSize: 30 } }]) {
    const load = loadGenerationDocuments({ ...run, styles });
    const documents = await load("m1", "Manager", "00000000-0000-4000-8000-000000000000");
    assert.equal(documents?.data.theme?.nameSize, undefined);
  }
});
