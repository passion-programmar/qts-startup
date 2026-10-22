import assert from "node:assert/strict";
import test from "node:test";
import { normalizePageExclusionUrl } from "@/server/page-exclusion-values";

test("page exclusions normalize domains and optional URL paths", () => {
  assert.equal(normalizePageExclusionUrl("WWW.Example.com/Jobs/"), "example.com/Jobs");
  assert.equal(normalizePageExclusionUrl("https://example.com"), "example.com");
  assert.equal(normalizePageExclusionUrl(""), null);
});

test("page exclusions reject unsupported schemes, credentials, queries, and fragments", () => {
  assert.equal(normalizePageExclusionUrl("javascript:alert(1)"), null);
  assert.equal(normalizePageExclusionUrl("https://user:password@example.com"), null);
  assert.equal(normalizePageExclusionUrl("example.com/jobs?query=1"), null);
  assert.equal(normalizePageExclusionUrl("example.com/jobs#section"), null);
});
