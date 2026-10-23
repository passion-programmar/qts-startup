import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultGeminiApiLimits,
  parseGeminiApiLimits,
} from "./gemini-api-limits";

test("Gemini API limits accept positive bounded integer values", () => {
  assert.deepEqual(
    parseGeminiApiLimits({
      requestsPerMinute: "12",
      requestsPerDay: "450",
      inputTokensPerMinute: "30000",
    }),
    {
      requestsPerMinute: 12,
      requestsPerDay: 450,
      inputTokensPerMinute: 30_000,
    },
  );
});

test("Gemini API limits reject missing, fractional, non-positive, and excessive values", () => {
  assert.equal(parseGeminiApiLimits(null), null);
  assert.equal(parseGeminiApiLimits({ ...defaultGeminiApiLimits, requestsPerDay: 0 }), null);
  assert.equal(parseGeminiApiLimits({ ...defaultGeminiApiLimits, requestsPerMinute: 1.5 }), null);
  assert.equal(parseGeminiApiLimits({ ...defaultGeminiApiLimits, inputTokensPerMinute: 10_000_001 }), null);
  assert.equal(parseGeminiApiLimits({ ...defaultGeminiApiLimits, requestsPerDay: "2e3" }), null);
});
