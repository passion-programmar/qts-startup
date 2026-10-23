import assert from "node:assert/strict";
import test from "node:test";
import { normalizeJobDetectionUrlRule } from "@/server/job-detection-url-rule-values";

test("blocked URL rules normalize literal fragments", () => {
  assert.equal(normalizeJobDetectionUrlRule(" WWW.Example.com/openings?remote=true "), "www.example.com/openings?remote=true");
  assert.equal(normalizeJobDetectionUrlRule("/private/path"), "/private/path");
  assert.equal(normalizeJobDetectionUrlRule(""), null);
});

test("blocked URL rules reject control characters", () => {
  assert.equal(normalizeJobDetectionUrlRule("bad\nfragment"), null);
});
