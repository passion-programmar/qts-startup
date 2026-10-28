import assert from "node:assert/strict";
import test from "node:test";
import { decryptSiteAccountPassword, encryptSiteAccountPassword } from "./site-account-password";

const SECRET = "a-test-secret-that-is-at-least-32-bytes-long";

test("the saved password reads back, and is never stored as written", () => {
  const stored = encryptSiteAccountPassword("Sunny:Day 2026!", SECRET);
  assert.ok(!stored.includes("Sunny"));
  assert.notEqual(stored, encryptSiteAccountPassword("Sunny:Day 2026!", SECRET));
  assert.equal(decryptSiteAccountPassword(stored, SECRET), "Sunny:Day 2026!");
});

test("another secret, a changed value, or nothing saved reads as no password", () => {
  const stored = encryptSiteAccountPassword("Sunny:Day 2026!", SECRET);
  assert.equal(decryptSiteAccountPassword(stored, `${SECRET}-other`), null);
  assert.equal(decryptSiteAccountPassword(`${stored.slice(0, -2)}AA`, SECRET), null);
  assert.equal(decryptSiteAccountPassword(null, SECRET), null);
  assert.equal(decryptSiteAccountPassword("plain text", SECRET), null);
});
