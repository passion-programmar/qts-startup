import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  resolveTemplateRenderAsset,
  rewriteFontFaces,
  templateFontStylesheet,
  templateRenderOrigin,
} from "./template-pdf-assets";

test("serves template pages, styles, and scripts from public/resume-templates", () => {
  for (const file of ["resume.html", "cover-letter.html", "css/base.css", "js/render.js", "templates/harvard.css"]) {
    const asset = resolveTemplateRenderAsset(`${templateRenderOrigin}/resume-templates/${file}?template=harvard`);
    assert.equal(asset?.kind, "file");
    if (asset?.kind !== "file") continue;
    assert.equal(asset.filePath, path.join(process.cwd(), "public", "resume-templates", file));
    assert.ok(existsSync(asset.filePath), file);
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
    `${templateRenderOrigin}/fonts/arimo/../../../.env.local`,
    `${templateRenderOrigin}/fonts/roboto/roboto-latin-400-normal.woff2`,
    `${templateRenderOrigin}/fonts/arimo/tinos-latin-400-normal.woff2`,
    "data:text/html,<p>hi</p>",
  ]) {
    assert.equal(resolveTemplateRenderAsset(url), null, url);
  }
});

test("serves bundled font files for the allowed families only", () => {
  const asset = resolveTemplateRenderAsset(`${templateRenderOrigin}/fonts/gelasio/gelasio-latin-700-italic.woff2`);
  assert.deepEqual(asset, {
    kind: "file",
    filePath: path.join(process.cwd(), "node_modules", "@fontsource", "gelasio", "files", "gelasio-latin-700-italic.woff2"),
    contentType: "font/woff2",
  });
  assert.ok(existsSync(asset.filePath));
});

test("points font faces at the render origin and drops the woff fallback", () => {
  const rewritten = rewriteFontFaces(
    "src: url(./files/arimo-latin-400-normal.woff2) format('woff2'), url(./files/arimo-latin-400-normal.woff) format('woff');",
    "arimo",
  );
  assert.equal(rewritten, "src: url(/fonts/arimo/arimo-latin-400-normal.woff2) format('woff2');");
});

test("registers the open fonts under the Windows names the templates use", async () => {
  const css = await templateFontStylesheet();
  for (const family of ["Arial", "Times New Roman", "Calibri", "Cambria", "Georgia", "Consolas", "Arimo", "Gelasio"]) {
    assert.ok(css.includes(`font-family: ${JSON.stringify(family)};`), family);
  }
  for (const [, url] of css.matchAll(/url\(([^)]+)\)/g)) {
    const asset = resolveTemplateRenderAsset(`${templateRenderOrigin}${url}`);
    assert.equal(asset?.kind, "file", url);
    if (asset?.kind === "file") assert.ok(existsSync(asset.filePath), url);
  }
});
