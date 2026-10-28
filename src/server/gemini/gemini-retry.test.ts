import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_FAILOVER_KEYS, isGeminiUnavailableError, withGeminiKeyFailover } from "@/server/gemini/gemini-retry";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { code: `gemini_http_${status}` });

/** Keys A, B, C... answering in turn; records what was selected, paused, and released. */
function pool(answers: Record<string, number>) {
  const log = { selected: [] as string[], paused: [] as string[], released: [] as string[] };
  const steps = {
    select: async (excluded: Set<string>) => {
      const apiKey = Object.keys(answers).find((key) => !excluded.has(key));
      if (apiKey) log.selected.push(apiKey);
      return apiKey ? { apiKey } : null;
    },
    run: async ({ apiKey }: { apiKey: string }) => {
      const status = answers[apiKey];
      if (status !== 200) throw httpError(status);
      return `answer from ${apiKey}`;
    },
    pause: async ({ apiKey }: { apiKey: string }) => { log.paused.push(apiKey); },
    release: async ({ apiKey }: { apiKey: string }) => { log.released.push(apiKey); },
  };
  return { steps, log };
}

test("a 503 pauses that key and the request goes to another key, never the same one again", async () => {
  const { steps, log } = pool({ A: 503, B: 200, C: 200 });
  assert.equal(await withGeminiKeyFailover(steps), "answer from B");
  assert.deepEqual(log, { selected: ["A", "B"], paused: ["A"], released: ["A", "B"] });
});

test("when every key tried is unavailable, each is paused and the last error is returned", async () => {
  const { steps, log } = pool({ A: 503, B: 500, C: 503, D: 200 });
  await assert.rejects(withGeminiKeyFailover(steps), (error: Error & { code?: string }) => error.code === "gemini_http_503");
  // At most GEMINI_FAILOVER_KEYS keys for one request.
  assert.equal(log.selected.length, GEMINI_FAILOVER_KEYS);
  assert.deepEqual(log.paused, ["A", "B", "C"]);
});

test("quota, key, and request errors are neither paused nor sent to another key", async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const { steps, log } = pool({ A: status, B: 200 });
    await assert.rejects(withGeminiKeyFailover(steps));
    assert.deepEqual([log.selected, log.paused, log.released], [["A"], [], ["A"]]);
  }
});

test("no free key gives null; a 503 with no other free key gives the 503", async () => {
  assert.equal(await withGeminiKeyFailover(pool({}).steps), null);
  await assert.rejects(withGeminiKeyFailover(pool({ A: 503 }).steps), (error: Error & { code?: string }) => error.code === "gemini_http_503");
});

test("only Gemini's 5xx replies count as unavailable", () => {
  assert.equal(isGeminiUnavailableError(httpError(503)), true);
  assert.equal(isGeminiUnavailableError(httpError(500)), true);
  assert.equal(isGeminiUnavailableError(httpError(429)), false);
  assert.equal(isGeminiUnavailableError(Object.assign(new Error("t"), { code: "gemini_timeout" })), false);
  assert.equal(isGeminiUnavailableError(new Error("plain")), false);
});
