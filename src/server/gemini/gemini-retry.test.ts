import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_RETRY_DELAY_MS, withGeminiRetry } from "@/server/gemini/gemini-retry";

const responses = (...statuses: number[]) => {
  let calls = 0;
  const request = async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;
    return { ok: status >= 200 && status < 300, status };
  };
  return { request, calls: () => calls };
};

test("a 503 is retried once after a short pause and the retry's answer is used", async () => {
  const waits: number[] = [];
  const { request, calls } = responses(503, 200);
  let counted = 0;
  const result = await withGeminiRetry(request, {
    wait: async (ms) => { waits.push(ms); },
    beforeRetry: async () => { counted += 1; },
  });
  assert.equal(result.status, 200);
  assert.equal(calls(), 2);
  assert.deepEqual(waits, [GEMINI_RETRY_DELAY_MS]);
  assert.equal(counted, 1);
});

test("a second 5xx is returned instead of retrying again", async () => {
  const { request, calls } = responses(503, 503, 200);
  const result = await withGeminiRetry(request, { wait: async () => {} });
  assert.equal(result.status, 503);
  assert.equal(calls(), 2);
});

test("success, quota, and key errors are not retried", async () => {
  for (const status of [200, 400, 401, 403, 404, 429]) {
    const { request, calls } = responses(status, 200);
    const result = await withGeminiRetry(request, { wait: async () => {} });
    assert.equal(result.status, status);
    assert.equal(calls(), 1, String(status));
  }
});
