import assert from "node:assert/strict";
import test from "node:test";
import { getGetJdFailureMessage } from "@/server/gemini/get-jd-failure-message";

test("Gemini HTTP failures get their specific Manager message", () => {
  assert.match(getGetJdFailureMessage("gemini_http_429"), /busy or its quota/);
  assert.match(getGetJdFailureMessage("gemini_count_tokens_http_429"), /busy or its quota/);
  assert.match(getGetJdFailureMessage("gemini_http_401"), /check the Gemini API key/);
  assert.match(getGetJdFailureMessage("gemini_http_403"), /check the Gemini API key/);
  assert.match(getGetJdFailureMessage("gemini_http_503"), /temporarily unavailable/);
  assert.match(getGetJdFailureMessage("gemini_timeout"), /could not reach Gemini/);
  assert.match(getGetJdFailureMessage("gemini_network_error"), /could not reach Gemini/);
});

test("other failures get the general message", () => {
  for (const code of ["gemini_http_400", "gemini_http_404", "gemini_invalid_response", "42703", "unknown"]) {
    assert.match(getGetJdFailureMessage(code), /could not evaluate this page/, code);
  }
});
