import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { parsePdfPackage, toResumeTemplateData } from "@/app/pdf/document-data";
import {
  layoutChoiceSettings,
  layoutNumberSettings,
  layoutThemeFromForm,
  parseLayoutTheme,
} from "@/app/pdf/layout-settings";
import sample from "@/app/pdf/default-resume.json";

const templatesRoot = path.join(process.cwd(), "public", "resume-templates");

test("layout settings are checked: valid values pass, values that break printing are refused", () => {
  assert.deepEqual(parseLayoutTheme({ nameSize: 18, lineHeight: "1.2", titleStyle: "band", fitPages: "2" }),
    { nameSize: 18, lineHeight: 1.2, titleStyle: "band", fitPages: "2" });
  assert.deepEqual(parseLayoutTheme({}), {});
  assert.throws(() => parseLayoutTheme({ nameSize: 200 }), /nameSize must be a number from 4 to 72 pt/);
  assert.throws(() => parseLayoutTheme({ marginSide: -1 }), /marginSide/);
  assert.throws(() => parseLayoutTheme({ bodySize: "big" }), /bodySize/);
  assert.throws(() => parseLayoutTheme({ titleStyle: "fancy" }), /titleStyle must be one of/);
});

test("the Resume page form sends only the settings that were changed and valid", () => {
  assert.deepEqual(layoutThemeFromForm({}), {});
  assert.deepEqual(
    layoutThemeFromForm({ nameSize: "20", bodySize: "", sectionGap: "999", titleStyle: "pill", accentColor: "#AA0000", showPageNumbers: "yes" }),
    { nameSize: 20, titleStyle: "pill", accentColor: "#AA0000", showPageNumbers: true },
  );
});

test("the server keeps the settings in the document and hands them to the template page", () => {
  const layout = layoutThemeFromForm({ nameSize: "18", marginTop: "9", fitPages: "2", titleStyle: "band", minTextSize: "9" });
  const parsed = parsePdfPackage(JSON.stringify({ ...sample, theme: layout }));
  for (const [key, value] of Object.entries(layout)) assert.equal(parsed.theme?.[key], value, key);
  const printed = toResumeTemplateData(parsed, "classic");
  assert.equal((printed.theme as Record<string, unknown>).nameSize, 18);
  assert.equal(printed.theme.template, "classic");
  // Without settings nothing is added: Generation's print jobs are unchanged.
  const plain = toResumeTemplateData(parsePdfPackage(JSON.stringify(sample)), "classic");
  for (const setting of [...layoutNumberSettings, ...layoutChoiceSettings]) {
    if (setting.key !== "density" && setting.key !== "paper") assert.equal((plain.theme as Record<string, unknown>)[setting.key], undefined, setting.key);
  }
});

test("the setting choices are exactly the template page's options and fonts", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(path.join(templatesRoot, "js", "templates.js"), "utf8"), context);
  const options = (context.window as { RESUME_OPTIONS: Record<string, { values: string[] }> }).RESUME_OPTIONS;
  for (const setting of layoutChoiceSettings) {
    if (setting.key === "fitPages" || setting.key === "paper") continue;
    assert.deepEqual([...setting.values], [...(options[setting.key]?.values ?? [])], setting.key);
  }
});

test("the template page applies every number setting with the same limits", () => {
  const render = readFileSync(path.join(templatesRoot, "js", "render.js"), "utf8");
  for (const setting of layoutNumberSettings) {
    if (["fontScale", "minTextSize", "marginTop", "marginSide", "marginBottom"].includes(setting.key)) continue;
    const match = new RegExp(`${setting.key}: \\["[^"]+", "(pt|)", ([\\d.]+), ([\\d.]+)\\]`).exec(render);
    assert.ok(match, `render.js applies ${setting.key}`);
    assert.deepEqual([match[1], Number(match[2]), Number(match[3])], [setting.unit, setting.min, setting.max], setting.key);
  }
  assert.match(render, /layoutNumber\(theme, key, 0, 60\)/, "page margins 0–60 mm");
  assert.match(render, /layoutNumber\(theme, "minTextSize", 4, 20\)/, "smallest text 4–20 pt");
});
