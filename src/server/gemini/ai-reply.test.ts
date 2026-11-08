import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroqChatBody,
  classifyAiNetworkError,
  classifyGeminiReply,
  classifyGroqReply,
  estimateGroqInputTokens,
} from "@/server/gemini/ai-reply";

const quotaBody = (quotaId: string, quotaValue: string, extra: object[] = []) => JSON.stringify({
  error: { message: "Quota exceeded", details: [{ violations: [{ quotaId, quotaValue }] }, ...extra] },
});
const reason = (outcome: unknown) => (outcome as { reason?: string }).reason;

test("Gemini's successful reply gives its text and the model that answered", () => {
  const body = JSON.stringify({ modelVersion: "gemini-3.6-flash", candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] } }] });
  assert.deepEqual(classifyGeminiReply(200, body, 900), { kind: "worked", httpStatus: 200, durationMs: 900, modelVersion: "gemini-3.6-flash", text: '{"a":1}' });
  assert.equal((classifyGeminiReply(200, JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), 1) as { text: string }).text, "");
  assert.equal(classifyGeminiReply(200, "", 1).kind, "worked");
});

test("Gemini's limits are told apart", () => {
  const daily = classifyGeminiReply(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20"), 1);
  assert.deepEqual([daily.kind, daily.kind === "daily_limit" && daily.limit], ["daily_limit", 20]);
  assert.equal(reason(classifyGeminiReply(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0"), 1)), "no_quota");
  assert.equal(reason(classifyGeminiReply(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "0"), 1)), "no_quota");
  const minute = classifyGeminiReply(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "5", [{ retryDelay: "34.2s" }]), 1);
  assert.deepEqual([minute.kind, minute.kind === "minute_limit" && minute.limit, minute.kind === "minute_limit" && minute.retryAfterSeconds], ["minute_limit", 5, 35]);
  const tokens = classifyGeminiReply(429, quotaBody("GenerateContentInputTokensPerModelPerMinute-FreeTier", "250000"), 1);
  assert.deepEqual([tokens.kind, tokens.kind === "minute_limit" && tokens.limit], ["minute_limit", null]);
  const noDetails = classifyGeminiReply(429, JSON.stringify({ error: { message: "generate_requests_per_model_per_day exceeded" } }), 1);
  assert.equal(noDetails.kind, "daily_limit");
});

test("Gemini's other errors are told apart", () => {
  assert.equal(reason(classifyGeminiReply(503, "{}", 1)), "overloaded");
  assert.equal(reason(classifyGeminiReply(500, "not json", 1)), "overloaded");
  assert.equal(reason(classifyGeminiReply(404, "{}", 1)), "model_missing");
  assert.equal(reason(classifyGeminiReply(403, "{}", 1)), "no_access");
  assert.equal(reason(classifyGeminiReply(400, JSON.stringify({ error: { message: "bad schema" } }), 1)), "bad_request");
  assert.equal(reason(classifyGeminiReply(400, JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), 1)), "bad_key");
  assert.equal(reason(classifyGeminiReply(400, JSON.stringify({ error: { message: "x", details: [{ reason: "API_KEY_INVALID" }] } }), 1)), "bad_key");
});

test("Groq's successful reply gives its text", () => {
  const body = JSON.stringify({ model: "openai/gpt-oss-120b", choices: [{ message: { content: ' {"a":1} ' }, finish_reason: "stop" }] });
  assert.deepEqual(classifyGroqReply(200, body, 800), { kind: "worked", httpStatus: 200, durationMs: 800, modelVersion: "openai/gpt-oss-120b", text: '{"a":1}' });
  assert.equal((classifyGroqReply(200, "{}", 1) as { text: string }).text, "");
});

test("Groq's limits are told apart from its message and wait time", () => {
  const groqError = (message: string) => JSON.stringify({ error: { message, type: "tokens", code: "rate_limit_exceeded" } });
  const tpd = classifyGroqReply(429, groqError("Rate limit reached for model `x` on tokens per day (TPD): Limit 200000, Used 199000, Requested 2000."), 1);
  assert.deepEqual([tpd.kind, tpd.kind === "daily_limit" && tpd.limit], ["daily_limit", 200_000]);
  assert.equal(classifyGroqReply(429, groqError("on requests per day (RPD): Limit 1000"), 1).kind, "daily_limit");

  const tpm = classifyGroqReply(429, groqError("on tokens per minute (TPM): Limit 8000, Used 7900, Requested 500. Please try again in 8.9s."), 1);
  assert.deepEqual([tpm.kind, tpm.kind === "minute_limit" && tpm.retryAfterSeconds, tpm.kind === "minute_limit" && tpm.limit], ["minute_limit", 9, null]);
  const rpm = classifyGroqReply(429, groqError("on requests per minute (RPM): Limit 30, Used 30"), 1, "12");
  assert.deepEqual([rpm.kind, rpm.kind === "minute_limit" && rpm.retryAfterSeconds, rpm.kind === "minute_limit" && rpm.limit], ["minute_limit", 12, 30]);
});

test("Groq's other errors are told apart", () => {
  assert.equal(reason(classifyGroqReply(503, "{}", 1)), "overloaded");
  assert.equal(reason(classifyGroqReply(498, "{}", 1)), "overloaded");
  assert.equal(reason(classifyGroqReply(401, "{}", 1)), "bad_key");
  assert.equal(reason(classifyGroqReply(403, "{}", 1)), "no_access");
  assert.equal(reason(classifyGroqReply(404, "{}", 1)), "model_missing");
  assert.equal(reason(classifyGroqReply(413, "{}", 1)), "too_large");
  assert.equal(reason(classifyGroqReply(400, JSON.stringify({ error: { message: "failed", code: "json_validate_failed" } }), 1)), "broken_reply");
  assert.equal(reason(classifyGroqReply(400, JSON.stringify({ error: { message: "bad" } }), 1)), "bad_request");
});

test("no HTTP reply is a timeout or a network error, and keeps no message", () => {
  assert.deepEqual(classifyAiNetworkError("TimeoutError", 18_000), { kind: "failed", reason: "timeout", httpStatus: null, durationMs: 18_000, detail: null });
  assert.equal(reason(classifyAiNetworkError("AbortError", 1)), "timeout");
  assert.equal(reason(classifyAiNetworkError("TypeError", 1)), "network");
});

test("Groq's request maps the conversation and asks for JSON", () => {
  const body = buildGroqChatBody("openai/gpt-oss-120b", [
    { role: "user", parts: [{ text: "question" }] },
    { role: "model", parts: [{ text: "answer" }] },
    { role: "user", parts: [{ text: "again" }] },
  ], 0.2, "Use this shape.");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.match(body.messages[0].content, /JSON object only.*Use this shape\./);
  assert.equal(body.messages[2].content, "answer");
});

test("Groq's token estimate errs high", () => {
  const text = "x".repeat(35_000);
  assert.equal(estimateGroqInputTokens([{ role: "user", parts: [{ text }] }]), 10_064);
});
