import assert from "node:assert/strict";
import test from "node:test";
import { paginatePdfCanvas } from "../../app/pdf/pdf-pagination";

test("moves a page break before an element that would be cut in half", () => {
  const pages = paginatePdfCanvas(365, 297, 15, 17, [
    { startMm: 276, endMm: 283 },
  ]);

  assert.deepEqual(pages, [
    { sourceStartMm: 0, sourceEndMm: 276 },
    { sourceStartMm: 276, sourceEndMm: 365 },
  ]);
});

test("keeps the normal page boundary when an element does not cross it", () => {
  const pages = paginatePdfCanvas(365, 297, 15, 17, [
    { startMm: 270, endMm: 277 },
    { startMm: 284, endMm: 291 },
  ]);

  assert.deepEqual(pages, [
    { sourceStartMm: 0, sourceEndMm: 280 },
    { sourceStartMm: 280, sourceEndMm: 365 },
  ]);
});

test("uses the available content height after moving an earlier page break", () => {
  const pages = paginatePdfCanvas(610, 297, 15, 17, [
    { startMm: 276, endMm: 283 },
    { startMm: 538, endMm: 545 },
  ]);

  assert.deepEqual(pages, [
    { sourceStartMm: 0, sourceEndMm: 276 },
    { sourceStartMm: 276, sourceEndMm: 538 },
    { sourceStartMm: 538, sourceEndMm: 610 },
  ]);
});

test("rejects invalid paper dimensions and margins", () => {
  assert.throws(
    () => paginatePdfCanvas(365, 297, 150, 170, []),
    /invalid page dimensions or margins/i,
  );
});
