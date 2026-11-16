import assert from "node:assert/strict";
import test from "node:test";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import type { DocumentTheme, PdfPackage } from "@/app/pdf/document-data";
import { renderPdfPackage } from "@/app/pdf/pdf-renderer";
import { resumePdfLayouts } from "@/app/pdf/resume-pdf-layout";
import { pdfTemplateValues, type PdfTemplate } from "@/server/pdf/pdf-templates";

function fixture(count = 2, theme?: DocumentTheme): PdfPackage {
  return {
    theme,
    resume: {
      candidate: { fullName: "Jordan Taylor", email: "jordan@example.com", headline: "Software Engineer" },
      targetRole: "Software Engineer", targetCompany: "Example",
      summary: "Summary text for the fitting check.",
      sections: [{ id: "experience", title: "Experience", items: Array.from({ length: count }, (_, i) => ({
        heading: `Engineer ${i + 1}`, subheading: "Example Company", dateRange: "2020 - 2025",
        bullets: Array.from({ length: 4 }, (_, j) => `Evidence ${i + 1}.${j + 1}: Built reliable systems and improved delivery quality for customers across multiple teams.`),
      })) }],
    },
    coverLetter: {
      candidate: { fullName: "Jordan Taylor", email: "jordan@example.com" }, targetRole: "Software Engineer", targetCompany: "Example",
      date: "November 16, 2026", bodyParagraphs: ["I would welcome the opportunity to join your team."],
    },
  };
}

// Inspect real PDF text operators without depending on a browser or rasterization.
// These fixtures use the built-in WinAnsi fonts; their ASCII text decodes directly.
async function inspect(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const rules: { page: number; x: number; y: number; endX: number }[] = [];
  const pages = doc.getPages().map((page, pageIndex) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    return streams.flatMap((ref) => {
      const stream = doc.context.lookup(ref) as PDFRawStream;
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString();
      for (const [, x, y, endX, endY] of operators.matchAll(/([\d.-]+) ([\d.-]+) m\s+([\d.-]+) ([\d.-]+) l/g)) {
        if (y === endY) rules.push({ page: pageIndex, x: Number(x), y: Number(y), endX: Number(endX) });
      }
      return [...operators.matchAll(/BT\s([\s\S]*?)ET/g)].map(([, block]) => {
        const size = Number(/([\d.]+) Tf/.exec(block)?.[1]);
        const matrix = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(block);
        const text = [...block.matchAll(/<([\dA-Fa-f]+)> Tj/g)].map(([, hex]) => Buffer.from(hex, "hex").toString("latin1")).join("");
        return { text, size, x: Number(matrix?.[1]), y: Number(matrix?.[2]) };
      });
    });
  });
  return { pages, rows: pages.flat(), rules, width: doc.getPage(0).getWidth(), height: doc.getPage(0).getHeight() };
}

async function render(count: number, theme?: DocumentTheme, template: PdfTemplate = "qts-standard") {
  return inspect((await renderPdfPackage(fixture(count, theme), template)).resume);
}

test("every fallback template uses the new normal sizes and keeps all overflow text at the last fitting stage", async () => {
  for (const template of pdfTemplateValues) {
    const short = await render(1, undefined, template);
    assert.equal(short.pages.length, 1, template);
    assert.equal(short.rows.find((row) => row.text.startsWith("Summary text"))?.size, 11, template);
    assert.equal(short.rows.find((row) => row.text.startsWith("Evidence 1.1"))?.size, 11, template);
    const long = await render(18, undefined, template);
    assert.ok(long.pages.length > 2, template);
    const expected = await render(18, {
      density: "normal", bodySize: 10.5, bulletSize: 10.5, sectionGap: 6,
      bulletGap: 1, lineHeight: 1.25, marginSide: 14,
    }, template);
    assert.deepEqual(long.pages, expected.pages, template);
    const text = long.rows.map((row) => row.text).join(" ");
    for (let i = 1; i <= 18; i += 1) {
      for (let j = 1; j <= 4; j += 1) assert.ok(text.includes(`Evidence ${i}.${j}:`), `${template}: ${i}.${j}`);
    }
    assert.ok(long.rows.every((row) => row.y >= 10 * 72 / 25.4), template);
    assert.ok(long.rows.every((row) => row.y + row.size <= long.height - 15 * 72 / 25.4 + 0.01), template);
  }
});

test("fallback respects saved sizes, scaling, paper, and separate margins", async () => {
  const theme: DocumentTheme = {
    density: "normal", paper: "letter", nameSize: 20, headlineSize: 13, contactSize: 9,
    sectionSize: 14, itemSize: 12, metaSize: 10, bodySize: 12, bulletSize: 13,
    fontScale: 1.1, marginTop: 22, marginBottom: 24, marginSide: 20,
    lineHeight: 1.4, bulletGap: 3,
  };
  const result = await render(1, theme);
  assert.equal(result.width, 612);
  assert.equal(result.height, 792);
  const expected = new Map([
    ["Jordan Taylor", 22], ["Software Engineer", 14.3], ["jordan@example.com", 9.9],
    ["PROFESSIONAL EXPERIENCE", 15.4], ["Engineer 1", 13.2], ["Example Company", 11],
  ]);
  for (const [text, size] of expected) {
    assert.ok(Math.abs((result.rows.find((row) => row.text === text)?.size ?? 0) - size) < 0.001, text);
  }
  const summary = result.rows.find((row) => row.text.startsWith("Summary text"))!;
  assert.ok(Math.abs(summary.x - 20 * 72 / 25.4) < 0.001);
  assert.ok(Math.abs(summary.size - 13.2) < 0.001);
  assert.ok(result.rows.every((row) => row.y >= 24 * 72 / 25.4));
  assert.ok(result.rows.every((row) => row.y + row.size <= result.height - 22 * 72 / 25.4 + 0.01));
  const long = await render(18, { bodySize: 13, bulletSize: 12, fontScale: 1.1, minTextSize: 11.5, marginSide: 12, marginTop: 22, marginBottom: 24 });
  assert.equal(long.rows.find((row) => row.text.startsWith("Evidence 1.1"))?.size, 11.5);
  assert.ok(Math.abs(long.rows.find((row) => row.text.startsWith("Summary text"))!.x - 12 * 72 / 25.4) < 0.001);
  assert.ok(long.rows.every((row) => row.y >= 24 * 72 / 25.4));
});

test("fallback stops reducing once the selected page target fits", async () => {
  // Find a real three-page fixture whose text reduction alone reaches two pages.
  let checked = false;
  for (let count = 4; count <= 12; count += 1) {
    const normal = await render(count, { density: "normal" });
    const fontOnly = await render(count, { density: "normal", bodySize: 10.5, bulletSize: 10.5 });
    if (normal.pages.length !== 3 || fontOnly.pages.length !== 2) continue;
    assert.deepEqual((await render(count)).pages, fontOnly.pages);
    assert.deepEqual((await render(count, { fitPages: "3" })).pages, normal.pages);
    checked = true;
    break;
  }
  assert.ok(checked, "fixture exercises the first-stage early stop");
});

test("fitting stages preserve smaller saved values and never shrink below the approved font floor", () => {
  const { layouts } = resumePdfLayouts({ bodySize: 10, bulletSize: 12, minTextSize: 4, sectionGap: 3, lineHeight: 1.1, marginSide: 10, bulletGap: 0.5 });
  assert.equal(layouts[1].bodySize, 10);
  assert.equal(layouts[1].bulletSize, 10.5);
  assert.equal(layouts[1].bulletGap, 0.5);
  assert.equal(layouts[2].bulletGap, 1);
  assert.equal(layouts[4].sectionGap, 3);
  assert.equal(layouts[4].lineHeight, 1.1);
  assert.equal(layouts[4].marginSide, 10);
  assert.equal(resumePdfLayouts({ density: "compact" }).layouts.length, 1);
  assert.equal(resumePdfLayouts({ fitPages: "1" }).target, 1);
});

test("section rules do not cross text after reducing title and section spacing", async () => {
  for (const template of ["qts-standard", "classic", "ledger"] as const) {
    const result = await render(18, undefined, template);
    assert.ok(result.rules.length > 0);
    for (const rule of result.rules) {
      for (const row of result.pages[rule.page]) {
        if (row.x < rule.x || row.x > rule.endX) continue;
        assert.ok(rule.y <= row.y - 1 || rule.y >= row.y + row.size, `${template}: rule crosses ${row.text}`);
      }
    }
  }
});

test("resume fitting and saved resume styles do not alter the cover letter", async () => {
  const normal = await renderPdfPackage(fixture(1), "classic");
  const fitted = await renderPdfPackage(fixture(18, { bodySize: 15, bulletSize: 14, marginTop: 30, marginBottom: 30, paper: "letter" }), "classic");
  assert.deepEqual(await inspect(fitted.coverLetter), await inspect(normal.coverLetter));
  const overlong = fixture(1);
  overlong.coverLetter.bodyParagraphs = ["Long cover letter paragraph. ".repeat(500)];
  await assert.rejects(renderPdfPackage(overlong, "classic"), /cover letter exceeds one A4 page/);
});
