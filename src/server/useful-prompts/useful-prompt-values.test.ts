import assert from "node:assert/strict";
import test from "node:test";
import { groupUsefulPrompts, parseUsefulPrompt } from "./useful-prompt-values";

test("a useful prompt needs a title and text within the limits", () => {
  assert.deepEqual(parseUsefulPrompt({ title: "  Cold   email ", content: "Line one\r\nLine two\n" }), {
    title: "Cold email",
    content: "Line one\nLine two",
  });
  assert.equal(parseUsefulPrompt({ title: " ", content: "x" }), "Enter a title.");
  assert.equal(parseUsefulPrompt({ title: "A", content: "" }), "Enter the prompt text.");
  assert.match(String(parseUsefulPrompt({ title: "A".repeat(201), content: "x" })), /title is too long/);
  assert.match(String(parseUsefulPrompt({ title: "A", content: "x".repeat(50001) })), /prompt is too long/);
  assert.equal(parseUsefulPrompt({ title: 5, content: null }), "Enter a title.");
});

test("useful prompts group by key with the newest version current", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  const grouped = groupUsefulPrompts([
    { id: "a1", promptKey: "a", version: 1, title: "Old A", content: "a1", createdAt: at(1) },
    { id: "b1", promptKey: "b", version: 1, title: "B", content: "b1", createdAt: at(2) },
    { id: "a2", promptKey: "a", version: 2, title: "New A", content: "a2", createdAt: at(5) },
  ]);
  assert.deepEqual(grouped.map((prompt) => prompt.promptKey), ["a", "b"]);
  assert.equal(grouped[0].title, "New A");
  assert.equal(grouped[0].version, 2);
  assert.equal(grouped[0].createdAt, at(1).toISOString());
  assert.deepEqual(grouped[0].versions.map((version) => version.version), [2, 1]);
});
