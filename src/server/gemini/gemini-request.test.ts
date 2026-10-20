import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiCountTokensRequest,
  geminiModel,
} from "./gemini-request";

test("countTokens identifies the model inside generateContentRequest", () => {
  const generationConfig = { temperature: 0.2 };

  assert.deepEqual(
    buildGeminiCountTokensRequest("job prompt", generationConfig),
    {
      generateContentRequest: {
        model: `models/${geminiModel}`,
        contents: [{ role: "user", parts: [{ text: "job prompt" }] }],
        generationConfig,
      },
    },
  );
});
