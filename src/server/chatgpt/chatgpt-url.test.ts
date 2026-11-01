import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CHATGPT_URL, normalizeChatGptUrl } from "./chatgpt-url";

test("Manager ChatGPT URLs accept HTTPS ChatGPT project links", () => {
  assert.equal(
    normalizeChatGptUrl("https://chatgpt.com/g/g-p-example/project"),
    "https://chatgpt.com/g/g-p-example/project",
  );
  assert.equal(normalizeChatGptUrl("https://chat.openai.com/c/abc"), "https://chat.openai.com/c/abc");
});

test("Manager ChatGPT URLs reject unrelated, insecure, credentialed, and oversized URLs", () => {
  for (const value of [
    "http://chatgpt.com/",
    "https://chatgpt.com.evil.example/",
    "https://example.com/",
    "javascript:alert(1)",
    "https://user:password@chatgpt.com/",
    "x".repeat(2049),
  ]) {
    assert.equal(normalizeChatGptUrl(value), null, value);
  }
  assert.equal(DEFAULT_CHATGPT_URL, "https://chatgpt.com/");
});
