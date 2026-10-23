import assert from "node:assert/strict";
import test from "node:test";
import { normalizePageDetectionKeyword } from "@/server/page-exclusion-values";

test("job-page detection keywords normalize case and whitespace", () => {
  assert.equal(normalizePageDetectionKeyword("  Job   Description "), "job description");
  assert.equal(normalizePageDetectionKeyword("Responsibilities"), "responsibilities");
  assert.equal(normalizePageDetectionKeyword(""), null);
});

test("job-page detection keywords reject short and control-character values", () => {
  assert.equal(normalizePageDetectionKeyword("a"), null);
  assert.equal(normalizePageDetectionKeyword("bad\nkeyword"), null);
});
