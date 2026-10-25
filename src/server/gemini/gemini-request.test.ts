import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateGeminiInputTokens,
} from "./gemini-request";

test("estimates Gemini input locally from prompt and generation configuration", () => {
  const compactConfig = { temperature: 0.2 };
  const schemaConfig = {
    ...compactConfig,
    responseSchema: {
      type: "OBJECT",
      properties: { matchingProfileIds: { type: "ARRAY" } },
    },
  };

  const compactEstimate = estimateGeminiInputTokens("job prompt", compactConfig);
  const schemaEstimate = estimateGeminiInputTokens("job prompt", schemaConfig);

  assert.ok(Number.isSafeInteger(compactEstimate));
  assert.ok(compactEstimate > 0);
  assert.ok(
    schemaEstimate > compactEstimate,
    "response-schema text must be included in the estimate",
  );
});

test("uses the larger word-based estimate for short English words", () => {
  const prompt = Array.from({ length: 100 }, () => "a").join(" ");
  const estimate = estimateGeminiInputTokens(prompt, {});

  // 101 whitespace groups including serialized config, then 15% headroom and
  // 16 request-overhead tokens.
  assert.equal(estimate, 172);
});

test("counts non-ASCII code points conservatively", () => {
  const asciiEstimate = estimateGeminiInputTokens("a".repeat(40), {});
  const nonAsciiEstimate = estimateGeminiInputTokens("界".repeat(40), {});

  assert.ok(nonAsciiEstimate > asciiEstimate);
});

test("page-text estimates land about 15% above Google's CountTokens result", () => {
  // Production samples (Gemini Count mode): ~5.15 ASCII characters per Google token.
  for (const googleTokens of [3808, 3830]) {
    const pageText = "Senior engineer role. ".repeat(Math.round((googleTokens * 5.15) / 22));
    const ratio = estimateGeminiInputTokens(pageText, {}) / googleTokens;
    assert.ok(ratio >= 1.13 && ratio <= 1.2, `estimate is ${Math.round((ratio - 1) * 100)}% above Google`);
  }
});
