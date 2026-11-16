import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("public/resume-templates/js/render.js", "utf8");
const fit = source.slice(source.indexOf("  function fitToPages("), source.indexOf("  // Back to the template's normal sizes"));
const shrink = source.slice(source.indexOf("  function shrinkToFit("), source.indexOf("  /* ---------- Filling pages"));

type Snapshot = { body: number; bullet: number; compact: boolean; dense: boolean; sectionGap: number; bulletGap: number; lineHeight: number };
const normalSpacing = { sectionGap: 8, bulletGap: 1, lineHeight: 1.3 };

// Exercise the real fitting functions with controlled page measurements, so the
// test can tell which adjustment fitted the document without depending on Chrome.
function fixture(measure: (state: Snapshot) => number, options: { minimum?: number; scale?: number; compactScale?: number; savedBulletGap?: number; target?: string; document?: string } = {}) {
  const values = new Map<string, string>();
  const classes = new Set<string>();
  const snapshots: Snapshot[] = [];
  let dense = false;
  const defaults: Record<string, number> = {
    "--text-body": 11, "--text-bullet": 11, "--text-item": 12, "--font-scale": options.scale ?? 1,
    "--space-section": 8, "--space-bullet": options.savedBulletGap ?? 1, "--leading-body": 1.3,
  };
  const token = (_node: unknown, name: string) => {
    if (name === "--font-scale" && classes.has("doc--compact") && options.compactScale) return options.compactScale;
    if (values.has(name)) return parseFloat(values.get(name)!);
    // Simulate the most aggressive legacy compact design (Nordic).
    if (classes.has("doc--compact")) {
      const compact: Record<string, number> = { "--space-section": 6, "--space-bullet": 0, "--leading-body": 1.2 };
      if (name in compact) return compact[name];
    }
    return defaults[name] ?? 0;
  };
  const article = {
    textContent: "Candidate name. Experience: first role; second role. Skills. Education.",
    style: { setProperty: (key: string, value: string) => values.set(key, value) },
    classList: {
      add: (key: string) => classes.add(key),
      toggle: (key: string, on: boolean) => on ? classes.add(key) : classes.delete(key),
    },
  };
  const count = () => {
    const state = {
      body: token(null, "--text-body"), bullet: token(null, "--text-bullet"), compact: classes.has("doc--compact"), dense,
      sectionGap: token(null, "--space-section"), bulletGap: token(null, "--space-bullet"), lineHeight: token(null, "--leading-body"),
    };
    snapshots.push(state);
    return measure(state);
  };
  const context = vm.createContext({
    DOCUMENT: options.document ?? "resume", COVER_LETTER_PAGE_LIMIT: 1,
    MIN_TEXT_PT: 10.5, minTextPt: options.minimum ?? 10.5, fitTarget: options.target ?? "auto",
    directRenderMode: false, printedPages: count, estimatePages: count,
    tokenNumber: token, keepManagerValues: () => {
      if (options.savedBulletGap !== undefined && options.savedBulletGap < token(null, "--space-bullet")) {
        values.set("--space-bullet", `${options.savedBulletGap}pt`);
      }
    },
    setDenseMargins: (on: boolean) => { dense = on; },
    normalSize: () => { values.clear(); classes.clear(); dense = false; return count(); },
    lowerTo: (_node: unknown, tokens: Record<string, string>) => {
      for (const [key, value] of Object.entries(tokens)) if (token(null, key) > parseFloat(value)) values.set(key, value);
    },
  });
  vm.runInContext(fit + shrink, context);
  const warnings: string[] = [];
  return {
    snapshots, warnings, article,
    roleSize: () => token(null, "--text-item"),
    run: (density = "auto") => context.fitToPages(article, density, warnings) as number,
  };
}

test("two-page resumes keep normal text and spacing", () => {
  const check = fixture(() => 2);
  assert.equal(check.run(), 2);
  assert.deepEqual(check.snapshots, [{ body: 11, bullet: 11, compact: false, dense: false, ...normalSpacing }]);
});

test("body and bullets shrink before spacing, and fitting stops immediately at two pages", () => {
  const check = fixture(({ body, bullet }) => body <= 10.5 && bullet <= 10.5 ? 2 : 4);
  assert.equal(check.run(), 2);
  assert.deepEqual(check.snapshots.at(-1), { body: 10.5, bullet: 10.5, compact: false, dense: false, ...normalSpacing });
  assert.ok(check.snapshots.every((state) => !state.compact && !state.dense));
});

test("section gaps shrink after text, stopping before line height or margins change", () => {
  const check = fixture(({ sectionGap }) => sectionGap === 6 ? 2 : 3);
  assert.equal(check.run(), 2);
  assert.deepEqual(check.snapshots.at(-2), { body: 10.5, bullet: 10.5, compact: false, dense: false, ...normalSpacing });
  assert.deepEqual(check.snapshots.at(-1), { body: 10.5, bullet: 10.5, compact: false, dense: false, ...normalSpacing, sectionGap: 6 });
});

test("line height shrinks only after section gaps fail, keeping 1pt bullet gaps", () => {
  const check = fixture(({ lineHeight }) => lineHeight === 1.25 ? 2 : 3);
  assert.equal(check.run(), 2);
  assert.equal(check.snapshots.at(-2)?.sectionGap, 6);
  assert.equal(check.snapshots.at(-2)?.lineHeight, 1.3);
  assert.deepEqual(check.snapshots.at(-1), { body: 10.5, bullet: 10.5, compact: false, dense: false, sectionGap: 6, bulletGap: 1, lineHeight: 1.25 });
});

test("overflow keeps the approved reductions on every page without further shrinking or content changes", () => {
  for (const pages of [3, 4, 5, 8]) {
    const check = fixture(() => pages);
    const originalContent = check.article.textContent;
    assert.equal(check.run(), pages);
    assert.deepEqual(check.snapshots.at(-1), {
      body: 10.5, bullet: 10.5, sectionGap: 6, bulletGap: 1, lineHeight: 1.25, compact: false, dense: true,
    });
    assert.equal(check.snapshots.length, 6, "only baseline/reset and the four approved reductions are measured");
    assert.ok(check.snapshots.every(({ compact, body, bullet }) => !compact && body >= 10.5 && bullet >= 10.5));
    assert.equal(check.roleSize(), 12, "role headings are not shrunk as an extra step");
    assert.equal(check.article.textContent, originalContent);
    assert.equal(check.warnings.length, 1);
    assert.match(check.warnings[0], new RegExp(`All content is kept on ${pages} pages`));
  }
});

test("a smaller saved bullet gap cannot undo the 1pt gap during automatic spacing reduction", () => {
  const check = fixture(() => 3, { savedBulletGap: 0.5 });
  assert.equal(check.run(), 3);
  for (const state of check.snapshots.filter(({ sectionGap }) => sectionGap === 6)) {
    assert.equal(state.bulletGap, 1);
  }
});

test("side margins change only after font and spacing reductions, then fitting stops", () => {
  const check = fixture(({ dense }) => dense ? 2 : 4);
  assert.equal(check.run(), 2);
  assert.deepEqual(check.snapshots.at(-2), {
    body: 10.5, bullet: 10.5, sectionGap: 6, bulletGap: 1, lineHeight: 1.25, compact: false, dense: false,
  });
  assert.deepEqual(check.snapshots.at(-1), { ...check.snapshots.at(-2), dense: true });
  assert.ok(check.snapshots.every(({ compact }) => !compact));
});

test("side fitting synchronizes preview and print margins, preserves smaller saved margins, and resets", () => {
  const marginCode = source.slice(source.indexOf("  function setDenseMargins("), source.indexOf("  // The controlled shrink"));
  for (const side of [16, 12]) {
    const properties = new Map<string, string>();
    let sheet: { id: string; textContent: string } | null = null;
    const context = vm.createContext({
      marginsMm: { top: 18, inline: side, bottom: 13 }, FIT_SIDE_MARGIN_MM: 14,
      customMargins: true, directRenderMode: false,
      root: { style: {
        setProperty: (key: string, value: string) => properties.set(key, value),
        removeProperty: (key: string) => properties.delete(key),
      } },
      styleRoot: {
        querySelector: () => sheet ? { remove: () => { sheet = null; } } : null,
        append: (style: { id: string; textContent: string }) => { sheet = style; },
      },
      el: () => ({ id: "", textContent: "" }),
    });
    vm.runInContext(marginCode, context);
    context.setDenseMargins(true);
    assert.equal(properties.get("--page-margin-inline"), `${Math.min(side, 14)}mm`);
    assert.equal(properties.get("--page-margin-top"), "18mm");
    assert.equal(properties.get("--page-margin-bottom"), "13mm");
    assert.equal((sheet as { textContent: string } | null)?.textContent, `@page { margin: 18mm ${Math.min(side, 14)}mm 13mm; }`);
    context.setDenseMargins(false);
    assert.equal(properties.get("--page-margin-inline"), `${side}mm`);
    assert.equal(sheet, null);
  }
});

test("the first reduction respects a higher minimum and compensates for font scale", () => {
  for (const [minimum, scale] of [[10.75, 1], [10.5, 1.1]]) {
    const expected = minimum / scale;
    const check = fixture(({ body }) => body <= expected ? 2 : 3, { minimum, scale });
    assert.equal(check.run(), 2);
    assert.equal(check.snapshots.at(-1)?.body, expected);
    assert.equal(check.snapshots.at(-1)?.bullet, expected);
  }
});

test("explicit page targets and normal density remain respected", () => {
  const target = fixture(() => 3, { target: "3" });
  assert.equal(target.run(), 3);
  assert.equal(target.snapshots.length, 1);
  const normal = fixture(() => 3);
  assert.equal(normal.run("normal"), 3);
  assert.equal(normal.snapshots.length, 1);
});

test("overflow does not activate the old compact template font scaling", () => {
  const check = fixture(() => 3, { compactScale: 0.97 });
  assert.equal(check.run(), 3);
  assert.ok(check.snapshots.every(({ compact }) => !compact));
  assert.equal(check.snapshots.at(-1)!.body, 10.5);
  assert.equal(check.snapshots.at(-1)!.bullet, 10.5);
});

test("overflow honors a higher saved text minimum and reports the selected page target", () => {
  const check = fixture(() => 5, { minimum: 11, target: "4" });
  assert.equal(check.run(), 5);
  assert.equal(check.snapshots.at(-1)!.body, 11);
  assert.equal(check.snapshots.at(-1)!.bullet, 11);
  assert.match(check.warnings[0], /4-page target/);
});

test("a smaller saved fitting minimum does not trigger additional text reductions on overflow", () => {
  const check = fixture(() => 5, { minimum: 8 });
  assert.equal(check.run(), 5);
  assert.equal(check.snapshots.at(-1)!.body, 10.5);
  assert.equal(check.snapshots.at(-1)!.bullet, 10.5);
});

test("cover-letter fitting does not reduce its font sizes", () => {
  const check = fixture(({ compact }) => compact ? 1 : 2, { document: "cover-letter" });
  assert.equal(check.run(), 1);
  assert.ok(check.snapshots.every(({ body, bullet }) => body === 11 && bullet === 11));
});
