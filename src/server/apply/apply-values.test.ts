import assert from "node:assert/strict";
import test from "node:test";
import {
  canTakeWork,
  compareExtensionVersions,
  defaultBrowserName,
  normalizeQuestionKey,
  parseApplyResultReport,
  parseBrowserHeaders,
} from "./apply-values";

test("extension versions compare numerically", () => {
  assert.equal(compareExtensionVersions("1.33.0", "1.33.0"), 0);
  assert.equal(compareExtensionVersions("1.9.0", "1.33.0"), -1);
  assert.equal(compareExtensionVersions("1.33.1", "1.33"), 1);
  assert.equal(compareExtensionVersions("1.x", "1.33.0"), null);
});

test("only current extensions take Generation or Apply work", () => {
  assert.equal(canTakeWork("1.33.0"), true);
  assert.equal(canTakeWork("2.0.0"), true);
  assert.equal(canTakeWork("1.32.0"), false);
  assert.equal(canTakeWork(null), false);
});

test("browser headers need a well-formed key", () => {
  const headers = new Headers({
    "x-qts-browser-key": "a1B2c3D4e5F6g7H8",
    "x-qts-extension-version": "1.33.0",
    "x-qts-browser-name": encodeURIComponent("  Office   PC "),
  });
  assert.deepEqual(parseBrowserHeaders(headers), {
    browserKey: "a1B2c3D4e5F6g7H8",
    extensionVersion: "1.33.0",
    browserName: "Office PC",
  });
  assert.equal(parseBrowserHeaders(new Headers({ "x-qts-browser-key": "short" })), null);
  assert.equal(parseBrowserHeaders(new Headers()), null);
  assert.equal(defaultBrowserName("a1b2c3d4e5f6g7h8"), "Chrome · A1B2");
});

test("the same question on different forms shares one key", () => {
  assert.equal(normalizeQuestionKey("Why Exadel? *"), normalizeQuestionKey("why exadel"));
  assert.equal(normalizeQuestionKey("Notice period (optional):"), "notice period");
});

test("result reports are checked", () => {
  assert.deepEqual(parseApplyResultReport({ result: "confirmed", confirmationSource: "page" }), {
    result: "confirmed",
    reason: null,
    confirmationSource: "page",
    screenshotBrowserName: null,
    evidence: null,
  });
  assert.equal(typeof parseApplyResultReport({ result: "confirmed" }), "string");
  assert.equal(typeof parseApplyResultReport({ result: "not_confirmed" }), "string");
  assert.equal(typeof parseApplyResultReport({ result: "maybe", reason: "x" }), "string");
  const notConfirmed = parseApplyResultReport({
    result: "not_confirmed",
    reason: " No confirmation on the page or by email within 2 minutes. ",
    screenshotBrowserName: "Laptop",
  });
  assert.equal(typeof notConfirmed, "object");
  assert.equal((notConfirmed as { reason: string }).reason, "No confirmation on the page or by email within 2 minutes.");
});
