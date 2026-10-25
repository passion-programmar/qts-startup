import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveTemplateRenderAsset, templateRenderOrigin } from "./template-pdf-assets";

const templateRoot = path.join(process.cwd(), "public", "resume-templates");

test("serves template pages, styles, scripts, and fonts from public/resume-templates", () => {
  for (const file of [
    "resume.html",
    "cover-letter.html",
    "css/base.css",
    "css/fonts.css",
    "js/render.js",
    "templates/harvard.css",
    "fonts/arimo/arimo-latin-400-normal.woff2",
  ]) {
    const asset = resolveTemplateRenderAsset(`${templateRenderOrigin}/resume-templates/${file}?template=harvard`);
    assert.equal(asset?.filePath, path.join(templateRoot, file), file);
    assert.ok(asset && existsSync(asset.filePath), file);
  }
});

test("blocks other hosts, path traversal, and unexpected file types", () => {
  for (const url of [
    "https://example.com/resume-templates/resume.html",
    "https://fonts.googleapis.com/css2?family=Arimo",
    `${templateRenderOrigin}/resume-templates/../../.env.local`,
    `${templateRenderOrigin}/resume-templates/%2e%2e/%2e%2e/package.json`,
    `${templateRenderOrigin}/resume-templates/..%5c..%5cpackage.json`,
    `${templateRenderOrigin}/resume-templates/data/sample-full.json`,
    `${templateRenderOrigin}/resume-templates/fonts/arimo/LICENSE`,
    `${templateRenderOrigin}/resume-templates/templates/evil.woff2`,
    `${templateRenderOrigin}/package.json`,
    "data:text/html,<p>hi</p>",
  ]) {
    assert.equal(resolveTemplateRenderAsset(url), null, url);
  }
});

test("every font in css/fonts.css is a bundled file the render page may load", () => {
  const css = readFileSync(path.join(templateRoot, "css", "fonts.css"), "utf8");
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    const asset = resolveTemplateRenderAsset(`${templateRenderOrigin}${url}`);
    assert.ok(asset && existsSync(asset.filePath), url);
  }
});

test("every template font stack starts with a bundled font", () => {
  const css = readFileSync(path.join(templateRoot, "css", "fonts.css"), "utf8");
  const bundled = new Set([...css.matchAll(/font-family: "([^"]+)";/g)].map(([, name]) => name));
  const base = readFileSync(path.join(templateRoot, "css", "base.css"), "utf8");
  const stacks = [...base.matchAll(/--font-(?!scale)[a-z-]+: ("[^"]+"|[^,;]+)[,;]/g)]
    .map(([, first]) => first)
    .filter((first) => !first.startsWith("var("));
  assert.ok(stacks.length >= 10);
  for (const first of stacks) assert.ok(bundled.has(first.replaceAll('"', "")), first);
});
