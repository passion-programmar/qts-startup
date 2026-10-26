const assert = require('node:assert/strict');
const test = require('node:test');
const { buildImagePdf, buildTextPdf, jpegSize } = require('./apply-pdf.js');

// A minimal JPEG header: SOI, then a baseline start-of-frame for a 640 x 480 image.
const jpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  0xff, 0xd9,
]);

function text(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

test('the JPEG size is read from its frame header', () => {
  assert.deepEqual(jpegSize(jpeg), { width: 640, height: 480 });
});

test('a screenshot PDF holds the image, a caption, and a valid cross-reference table', () => {
  const pdf = text(buildImagePdf(jpeg, 'Exadel - Senior DevOps Engineer (not confirmed)'));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/Subtype \/Image \/Width 640 \/Height 480/);
  assert.match(pdf, /\(Exadel - Senior DevOps Engineer \\\(not confirmed\\\)\) Tj/);
  const xrefAt = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xrefAt, xrefAt + 4), 'xref');
  for (const [, offset] of pdf.matchAll(/(\d{10}) 00000 n/g)) {
    assert.match(pdf.slice(Number(offset)), /^\d+ 0 obj/);
  }
});

test('a text PDF spreads long page text over several pages', () => {
  const lines = Array.from({ length: 130 }, (_, index) => `Line ${index + 1}`).join('\n');
  const pdf = text(buildTextPdf('Page text after Submit', lines));
  assert.match(pdf, /\/Count 3 >>/);
  assert.match(pdf, /\(Line 130\) Tj/);
});
