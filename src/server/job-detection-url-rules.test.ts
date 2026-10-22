import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobDetectionUrlRule } from "@/server/job-detection-url-rule-values";

test("job-detection URL rules normalize domains and optional paths", () => {
  assert.equal(normalizeJobDetectionUrlRule("WWW.Example.com/openings/"), "example.com/openings");
  assert.equal(normalizeJobDetectionUrlRule("https://example.com"), "example.com");
  assert.equal(normalizeJobDetectionUrlRule(""), null);
});

test("job-detection URL rules reject unsafe schemes, credentials, queries, and fragments", () => {
  assert.equal(normalizeJobDetectionUrlRule("javascript:alert(1)"), null);
  assert.equal(normalizeJobDetectionUrlRule("https://user:pass@example.com"), null);
  assert.equal(normalizeJobDetectionUrlRule("example.com/jobs?query=1"), null);
  assert.equal(normalizeJobDetectionUrlRule("example.com/jobs#section"), null);
});
