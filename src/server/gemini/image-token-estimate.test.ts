import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_IMAGE_TILE_TOKENS, estimateGeminiImageTokens } from "@/server/gemini/image-token-estimate";

test("small images count as one 258-token unit", () => {
  assert.equal(estimateGeminiImageTokens(384, 384), GEMINI_IMAGE_TILE_TOKENS);
  assert.equal(estimateGeminiImageTokens(100, 50), GEMINI_IMAGE_TILE_TOKENS);
});

test("larger images count 258 tokens per 768 px tile", () => {
  assert.equal(estimateGeminiImageTokens(768, 768), 258);
  assert.equal(estimateGeminiImageTokens(1024, 768), 516);
  assert.equal(estimateGeminiImageTokens(1920, 1080), 3 * 2 * 258);
});

test("unknown dimensions fall back to one unit", () => {
  assert.equal(estimateGeminiImageTokens(0, 0), GEMINI_IMAGE_TILE_TOKENS);
  assert.equal(estimateGeminiImageTokens(Number.NaN, 500), GEMINI_IMAGE_TILE_TOKENS);
});
