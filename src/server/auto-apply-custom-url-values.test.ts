import assert from "node:assert/strict";
import test from "node:test";
import { matchesAutoApplyCustomUrl, normalizeAutoApplyCustomUrl } from "./auto-apply-custom-url-values";

test("Custom URL prefixes normalize to a domain", () => {
  assert.equal(normalizeAutoApplyCustomUrl("djni.co"), "djni.co");
  assert.equal(normalizeAutoApplyCustomUrl("https://www.DJNI.co/"), "djni.co");
});

test("Custom URL prefixes reject paths, credentials, ports, invalid hosts, and control characters", () => {
  for (const value of [
    "https://djni.co/jobs",
    "https://user@djni.co",
    "https://djni.co:8443",
    "https://djni.co:443",
    "javascript://djni.co",
    "djni",
    "127.0.0.1",
    "bad\nhost.co",
  ]) assert.equal(normalizeAutoApplyCustomUrl(value), null, value);
});

test("Custom URL prefixes match the domain and its subdomains only", () => {
  const prefixes = ["djni.co"];
  assert.equal(matchesAutoApplyCustomUrl("https://djni.co/jobs/123", prefixes), true);
  assert.equal(matchesAutoApplyCustomUrl("https://careers.djni.co/jobs/123", prefixes), true);
  assert.equal(matchesAutoApplyCustomUrl("https://notdjni.co/jobs/123", prefixes), false);
  assert.equal(matchesAutoApplyCustomUrl("not a url", prefixes), false);
});
