import assert from "node:assert/strict";
import test from "node:test";
import {
  aiSlotBlock,
  aiSlotId,
  aiSlotIsOutForTheDay,
  defaultAiLimits,
  describeAiSlot,
  emptyAiSlotUsage,
  keysNotCalledFirst,
  parseAiLimits,
  parseAiSlotId,
  readSavedAiLimits,
  type AiModelLimits,
  type AiSlotPause,
} from "@/server/gemini/ai-models";

const now = Date.parse("2026-11-08T17:00:00Z");
const limits: AiModelLimits = { requestsPerMinute: 2, requestsPerDay: 18, inputTokensPerMinute: 25_000, inputTokensPerDay: null };
const groq: AiModelLimits = { requestsPerMinute: 20, requestsPerDay: 800, inputTokensPerMinute: 6_000, inputTokensPerDay: 150_000 };
const pause = (reason: AiSlotPause["reason"], minutes = 30): AiSlotPause => ({
  until: new Date(now + minutes * 60_000).toISOString(), reason, text: reason, at: new Date(now).toISOString(),
});

test("the starting limits are the agreed ones, safely under the measured quota", () => {
  const defaults = defaultAiLimits();
  assert.deepEqual(defaults["gemini-3.6-flash"], limits);
  assert.equal(defaults["gemini-3.5-flash-lite"].requestsPerDay, 200);
  assert.deepEqual(defaults["openai/gpt-oss-120b"], groq);
});

test("the Super Admin's limits are all checked before anything is saved", () => {
  const form = Object.fromEntries(Object.entries(defaultAiLimits()).map(([id, value]) => [id, {
    requestsPerMinute: String(value.requestsPerMinute),
    requestsPerDay: String(value.requestsPerDay),
    inputTokensPerMinute: String(value.inputTokensPerMinute),
    inputTokensPerDay: value.inputTokensPerDay === null ? "" : String(value.inputTokensPerDay),
  }]));
  assert.deepEqual(parseAiLimits(form), defaultAiLimits());
  for (const [field, bad] of [["requestsPerMinute", "0"], ["requestsPerDay", "x"], ["inputTokensPerMinute", "1.5"], ["inputTokensPerDay", "-1"]]) {
    const broken = structuredClone(form);
    (broken["gemini-3.6-flash"] as Record<string, string>)[field] = bad;
    assert.equal(parseAiLimits(broken), null, field);
  }
  assert.equal(parseAiLimits({ "gemini-3.6-flash": form["gemini-3.6-flash"] }), null);
});

test("saved limits fall back per model, so a new model starts from its defaults", () => {
  const saved = readSavedAiLimits({ "gemini-3.6-flash": { ...limits, requestsPerDay: 15 } });
  assert.equal(saved["gemini-3.6-flash"].requestsPerDay, 15);
  assert.equal(saved["openai/gpt-oss-120b"].inputTokensPerDay, 150_000);
  assert.deepEqual(readSavedAiLimits(null), defaultAiLimits());
});

test("a slot id joins a key and a model, and a bare hash has no model", () => {
  assert.deepEqual(parseAiSlotId(aiSlotId("abc", "openai/gpt-oss-120b")), { keyHash: "abc", modelId: "openai/gpt-oss-120b" });
  assert.deepEqual(parseAiSlotId("abc"), { keyHash: "abc", modelId: null });
});

test("a slot is blocked by its pause and each of its limits, in that order", () => {
  const block = (usage: Partial<typeof emptyAiSlotUsage>, tokens = 1_000, active?: AiSlotPause, l = limits) =>
    aiSlotBlock(l, { ...emptyAiSlotUsage, ...usage }, active, tokens, now);
  assert.equal(block({}), null);
  assert.equal(block({}, 1_000, pause("overloaded")), "paused");
  assert.equal(block({}, 1_000, pause("overloaded", -1)), null);
  assert.equal(block({ dayCalls: 18 }), "day_calls");
  assert.equal(block({ minuteCalls: 2 }), "minute_calls");
  assert.equal(block({ minuteTokens: 24_500 }), "minute_tokens");
  assert.equal(block({ dayTokens: 149_500 }, 1_000, undefined, groq), "day_tokens");
  assert.equal(block({}, 25_001), "too_large");
  assert.equal(block({}, 6_001, undefined, groq), "too_large");
});

test("only daily and permanent problems count as out for the day", () => {
  assert.equal(aiSlotIsOutForTheDay("day_calls", undefined), true);
  assert.equal(aiSlotIsOutForTheDay("day_tokens", undefined), true);
  assert.equal(aiSlotIsOutForTheDay("paused", pause("daily_limit")), true);
  assert.equal(aiSlotIsOutForTheDay("paused", pause("bad_key")), true);
  assert.equal(aiSlotIsOutForTheDay("paused", pause("overloaded")), false);
  assert.equal(aiSlotIsOutForTheDay("minute_calls", undefined), false);
  assert.equal(aiSlotIsOutForTheDay(null, undefined), false);
});

test("keys not yet called come first, keeping the random order within each group", () => {
  assert.deepEqual(keysNotCalledFirst(["C", "A", "D", "B"], (key) => key === "A" || key === "B"), ["C", "D", "A", "B"]);
});

test("the Super Admin sees each slot's usage and a plain status", () => {
  const view = (usage: Partial<typeof emptyAiSlotUsage>, active?: AiSlotPause, busy = false) =>
    describeAiSlot(limits, { ...emptyAiSlotUsage, ...usage }, active, busy, now);
  assert.deepEqual(view({ dayCalls: 12 }), { used: "12 of 18", status: "Available", tone: "ok" });
  assert.equal(view({}, undefined, true).status, "Busy");
  assert.equal(view({ dayCalls: 18 }).status, "Limit reached");
  assert.equal(view({ minuteCalls: 2 }).status, "Minute limit");
  assert.equal(view({}, pause("overloaded")).status, "Paused 30m");
  assert.equal(view({}, pause("bad_key")).status, "Bad key");
  assert.equal(view({}, pause("no_access")).status, "No access");
  assert.equal(view({}, pause("model_missing")).status, "Model missing");
  assert.equal(view({}, pause("no_quota")).status, "No quota");
  const until = { ...pause("daily_limit"), until: "2026-11-09T08:00:00.000Z" };
  assert.deepEqual(view({ dayCalls: 20 }, until), { used: "20 of 18", status: "Until 00:00", tone: "out" });
  assert.equal(view({}, pause("overloaded", -1)).status, "Available");
});
