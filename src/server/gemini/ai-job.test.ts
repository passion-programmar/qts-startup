import assert from "node:assert/strict";
import test from "node:test";
import {
  aiRequestBudgetMs,
  aiTryTimeoutMs,
  AiJobError,
  decideAiFailure,
  runAiJob,
  type AiJobDeps,
  type AiJobSlot,
  type AiJobState,
} from "@/server/gemini/ai-job";
import {
  aiSlotId,
  defaultAiLimits,
  emptyAiSlotUsage,
  nextPacificMidnight,
  type AiModel,
  type AiSlotPauses,
  type AiSlotUsage,
} from "@/server/gemini/ai-models";
import type { AiFailure, AiOutcome } from "@/server/gemini/ai-reply";

const flash36 = "gemini-3.6-flash";
const lite = "gemini-3.5-flash-lite";
const groq = "openai/gpt-oss-120b";
const start = Date.parse("2026-11-08T17:00:00Z");
const midnight = new Date(nextPacificMidnight(start)).toISOString();

const facts = { httpStatus: 503, durationMs: 100, detail: null };
const overloaded: AiFailure = { kind: "failed", reason: "overloaded", ...facts };
const timedOut: AiFailure = { kind: "failed", reason: "timeout", httpStatus: null, durationMs: 18_000, detail: null };
const dailyLimit: AiFailure = { kind: "daily_limit", limit: 20, httpStatus: 429, durationMs: 100, detail: null };
const minuteLimit: AiFailure = { kind: "minute_limit", limit: 5, retryAfterSeconds: 34, httpStatus: 429, durationMs: 100, detail: null };
const noQuota: AiFailure = { kind: "blocked", reason: "no_quota", httpStatus: 429, durationMs: 100, detail: null };
const missing: AiFailure = { kind: "blocked", reason: "model_missing", httpStatus: 404, durationMs: 100, detail: null };
const noAccess: AiFailure = { kind: "blocked", reason: "no_access", httpStatus: 403, durationMs: 100, detail: null };
const badKey: AiFailure = { kind: "blocked", reason: "bad_key", httpStatus: 400, durationMs: 100, detail: null };
const badRequest: AiFailure = { kind: "blocked", reason: "bad_request", httpStatus: 400, durationMs: 100, detail: "schema is wrong" };
const worked: AiOutcome = { kind: "worked", httpStatus: 200, durationMs: 900, modelVersion: "m", text: '{"ok":true}' };
const broken: AiOutcome = { kind: "worked", httpStatus: 200, durationMs: 900, modelVersion: "m", text: "not json" };

type Reply = AiOutcome | ((slot: AiJobSlot, timeoutMs: number) => AiOutcome);

function world(options: {
  gemini?: string[];
  groq?: string[];
  replies?: Reply[];
  usage?: Record<string, Partial<AiSlotUsage>>;
  pauses?: AiSlotPauses;
  rounds?: Record<string, string[]>;
  tokens?: Partial<Record<string, number>>;
  deadlineAt?: number;
  callMs?: number;
} = {}) {
  let clock = start;
  const keyList = (names: string[]) => names.map((name) => ({ apiKey: `secret-${name}`, keyHash: name }));
  const log = {
    calls: [] as Array<{ key: string; model: string; timeoutMs: number }>,
    released: [] as string[],
    claimed: [] as string[],
    paused: {} as AiSlotPauses,
    reads: 0,
    slept: 0,
  };
  const replies = [...(options.replies ?? [worked])];
  const usage = new Map(Object.entries(options.usage ?? {}).map(([slot, value]) => [slot, { ...emptyAiSlotUsage, ...value }]));
  let pauses: AiSlotPauses = { ...(options.pauses ?? {}) };
  const rounds = Object.fromEntries(Object.entries(options.rounds ?? {}).map(([model, keys]) => [model, new Set(keys)]));
  const deps: AiJobDeps<string, unknown> = {
    keys: { gemini: keyList(options.gemini ?? ["A", "B", "C"]), groq: keyList(options.groq ?? []) },
    deadlineAt: options.deadlineAt ?? start + aiRequestBudgetMs,
    now: () => clock,
    sleep: async (ms) => { clock += ms; log.slept += ms; },
    // Keeps the listed order, so a test can say exactly which key comes first.
    shuffle: (items) => [...items],
    readState: async (): Promise<AiJobState> => {
      log.reads += 1;
      return { limits: defaultAiLimits(), pauses: { ...pauses }, usage, rounds };
    },
    estimateTokens: (model: AiModel) => options.tokens?.[model.id] ?? 1_000,
    claim: async (slot) => { log.claimed.push(slot.slotId); return `lease-${slot.slotId}`; },
    release: async (slot) => { log.released.push(slot.slotId); },
    call: async (slot, _claim, timeoutMs) => {
      log.calls.push({ key: slot.key.keyHash, model: slot.model.id, timeoutMs });
      clock += options.callMs ?? 1_000;
      const reply = replies.shift();
      assert.ok(reply, "the job made more calls than the test expected");
      return typeof reply === "function" ? reply(slot, timeoutMs) : reply;
    },
    savePauses: async (added) => { pauses = { ...pauses, ...added }; Object.assign(log.paused, added); },
    parse: (text) => JSON.parse(text) as unknown,
  };
  const route = () => log.calls.map((call) => `${call.key}+${call.model}`);
  return { deps, log, route, setClock: (value: number) => { clock = value; } };
}

const failsWith = (code: string) => (error: unknown) => error instanceof AiJobError && error.code === code;

test("a normal job uses the best model on the next key and releases it", async () => {
  const { deps, log, route } = world();
  assert.deepEqual(await runAiJob(deps), { ok: true });
  assert.deepEqual(route(), [`A+${flash36}`]);
  assert.deepEqual(log.released, [aiSlotId("A", flash36)]);
});

test("a key already called on this model waits until every key has had a turn", async () => {
  const { deps, route } = world({ rounds: { [flash36]: ["A", "B"] } });
  await runAiJob(deps);
  assert.deepEqual(route(), [`C+${flash36}`]);
});

test("once every key has been called, the rotation can use a called key again", async () => {
  const { deps, route } = world({ rounds: { [flash36]: ["A", "B", "C"] } });
  await runAiJob(deps);
  assert.deepEqual(route(), [`A+${flash36}`]);
});

test("each model keeps its own rotation", async () => {
  const usage = Object.fromEntries(["A", "B", "C"].map((key) => [aiSlotId(key, flash36), { dayCalls: 18 }]));
  const { deps, route } = world({ usage, rounds: { [flash36]: [], [lite]: ["A"] } });
  await runAiJob(deps);
  assert.deepEqual(route(), [`B+${lite}`]);
});

test("an error tries the same key on the next model, then the next key from the first model", async () => {
  const { deps, route } = world({ replies: [overloaded, overloaded, worked] });
  assert.deepEqual(await runAiJob(deps), { ok: true });
  assert.deepEqual(route(), [`A+${flash36}`, `A+${lite}`, `B+${flash36}`]);
});

test("the second key also gets both models, and every failure pauses only its own slot", async () => {
  const { deps, log, route } = world({ replies: [overloaded, timedOut, overloaded, worked] });
  await runAiJob(deps);
  assert.deepEqual(route(), [`A+${flash36}`, `A+${lite}`, `B+${flash36}`, `B+${lite}`]);
  assert.deepEqual(Object.keys(log.paused).sort(), [aiSlotId("A", lite), aiSlotId("A", flash36), aiSlotId("B", flash36)].sort());
});

test("a job tries at most two Gemini keys, then reports busy", async () => {
  const { deps, route } = world({ replies: [overloaded, overloaded, overloaded, overloaded] });
  await assert.rejects(runAiJob(deps), failsWith("ai_busy"));
  assert.equal(route().length, 4);
});

test("Groq answers when Gemini's tries for this job have failed", async () => {
  const { deps, route } = world({ groq: ["G1", "G2"], replies: [overloaded, overloaded, overloaded, overloaded, worked] });
  assert.deepEqual(await runAiJob(deps), { ok: true });
  assert.deepEqual(route().at(-1), `G1+${groq}`);
});

test("Groq answers when Gemini has no free slot, with no Gemini call at all", async () => {
  const usage = Object.fromEntries(["A", "B"].flatMap((key) => [
    [aiSlotId(key, flash36), { dayCalls: 18 }],
    [aiSlotId(key, lite), { dayCalls: 200 }],
  ]));
  const { deps, route } = world({ gemini: ["A", "B"], groq: ["G1"], usage });
  await runAiJob(deps);
  assert.deepEqual(route(), [`G1+${groq}`]);
});

test("a failed Groq key moves on to the next Groq key", async () => {
  const usage = Object.fromEntries(["A"].flatMap((key) => [
    [aiSlotId(key, flash36), { dayCalls: 18 }],
    [aiSlotId(key, lite), { dayCalls: 200 }],
  ]));
  const { deps, route } = world({ gemini: ["A"], groq: ["G1", "G2"], usage, replies: [overloaded, worked] });
  await runAiJob(deps);
  assert.deepEqual(route(), [`G1+${groq}`, `G2+${groq}`]);
});

test("a job too big for Groq stays with Gemini", async () => {
  const { deps, route } = world({ groq: ["G1"], tokens: { [groq]: 7_000 }, replies: [overloaded, overloaded, overloaded, overloaded] });
  await assert.rejects(runAiJob(deps), failsWith("ai_busy"));
  assert.ok(route().every((step) => !step.includes(groq)));
});

test("a request bigger than every model's limit says too long and calls nothing", async () => {
  const { deps, log } = world({ groq: ["G1"], tokens: { [flash36]: 30_000, [lite]: 30_000, [groq]: 30_000 } });
  await assert.rejects(runAiJob(deps), failsWith("ai_too_large"));
  assert.equal(log.calls.length, 0);
});

test("a broken reply tries the next model with no pause", async () => {
  const { deps, log, route } = world({ replies: [broken, worked] });
  assert.deepEqual(await runAiJob(deps), { ok: true });
  assert.deepEqual(route(), [`A+${flash36}`, `A+${lite}`]);
  assert.deepEqual(log.paused, {});
});

test("a bad request stops the job and shows the reason", async () => {
  const { deps, log, route } = world({ groq: ["G1"], replies: [badRequest] });
  await assert.rejects(runAiJob(deps), (error: unknown) => failsWith("ai_bad_request")(error) && /schema is wrong/.test((error as Error).message));
  assert.equal(route().length, 1);
  assert.deepEqual(log.paused, {});
});

test("a bad key pauses all of that key's models and goes straight to the next key", async () => {
  for (const failure of [badKey, noAccess]) {
    const { deps, log, route } = world({ replies: [failure, worked] });
    await runAiJob(deps);
    assert.deepEqual(route(), [`A+${flash36}`, `B+${flash36}`]);
    assert.deepEqual(Object.keys(log.paused).sort(), [aiSlotId("A", lite), aiSlotId("A", flash36)].sort());
    assert.equal(log.paused[aiSlotId("A", lite)].until, midnight);
  }
});

test("a daily limit pauses only that key and model until midnight Pacific", async () => {
  const { deps, log, route } = world({ replies: [dailyLimit, worked] });
  await runAiJob(deps);
  assert.deepEqual(route(), [`A+${flash36}`, `A+${lite}`]);
  assert.deepEqual(Object.keys(log.paused), [aiSlotId("A", flash36)]);
  assert.equal(log.paused[aiSlotId("A", flash36)].until, midnight);
});

test("a paused slot is skipped with no call, and the key's other model still works", async () => {
  const paused = { [aiSlotId("A", flash36)]: { until: midnight, reason: "daily_limit" as const, text: "Daily limit", at: "x" } };
  const { deps, route } = world({ gemini: ["A"], pauses: paused });
  await runAiJob(deps);
  assert.deepEqual(route(), [`A+${lite}`]);
});

test("a finished pause lets the slot be used again", async () => {
  const paused = { [aiSlotId("A", flash36)]: { until: new Date(start - 1).toISOString(), reason: "overloaded" as const, text: "503", at: "x" } };
  const { deps, route } = world({ gemini: ["A"], pauses: paused });
  await runAiJob(deps);
  assert.deepEqual(route(), [`A+${flash36}`]);
});

test("a slot at its minute or daily limit isn't called", async () => {
  const usage = {
    [aiSlotId("A", flash36)]: { minuteCalls: 2 },
    [aiSlotId("B", flash36)]: { dayCalls: 18 },
  };
  const { deps, route } = world({ usage });
  await runAiJob(deps);
  assert.deepEqual(route(), [`C+${flash36}`]);
});

test("a daily token limit stops Groq only when the next job wouldn't fit", async () => {
  const onlyGroq = world({ gemini: [], groq: ["G1", "G2"], usage: { [aiSlotId("G1", groq)]: { dayTokens: 149_500 } } });
  await runAiJob(onlyGroq.deps);
  assert.deepEqual(onlyGroq.route(), [`G2+${groq}`]);
});

test("when every slot is out for the day, it says so at once and gives the reset time", async () => {
  const usage = Object.fromEntries(["A"].flatMap((key) => [
    [aiSlotId(key, flash36), { dayCalls: 18 }],
    [aiSlotId(key, lite), { dayCalls: 200 }],
  ]));
  const { deps, log } = world({ gemini: ["A"], usage });
  await assert.rejects(runAiJob(deps), (error: unknown) => failsWith("ai_quota_used_up")(error) && (error as AiJobError).retryAt === Date.parse(midnight));
  assert.equal(log.slept, 0);
  assert.equal(log.calls.length, 0);
});

test("when slots are only briefly unavailable, it waits and then uses one that frees up", async () => {
  const slot = aiSlotId("A", flash36);
  const { deps, route, log } = world({ gemini: ["A"], usage: { [slot]: { minuteCalls: 2 }, [aiSlotId("A", lite)]: { minuteCalls: 2 } } });
  const readState = deps.readState;
  deps.readState = async () => {
    const state = await readState();
    if (log.slept >= 8_000) state.usage.set(slot, { ...emptyAiSlotUsage });
    return state;
  };
  await runAiJob(deps);
  assert.equal(log.slept, 8_000);
  assert.deepEqual(route(), [`A+${flash36}`]);
});

test("it stops waiting after about 20 seconds and reports busy", async () => {
  const usage = { [aiSlotId("A", flash36)]: { minuteCalls: 2 }, [aiSlotId("A", lite)]: { minuteCalls: 2 } };
  const { deps, log } = world({ gemini: ["A"], usage });
  await assert.rejects(runAiJob(deps), failsWith("ai_busy"));
  assert.ok(log.slept >= 16_000 && log.slept <= 20_000, `slept ${log.slept}`);
  assert.equal(log.calls.length, 0);
});

test("no keys at all says it isn't set up", async () => {
  const { deps } = world({ gemini: [], groq: [] });
  await assert.rejects(runAiJob(deps), failsWith("ai_not_configured"));
});

test("each try is limited to 18 seconds", async () => {
  const { deps, log } = world();
  await runAiJob(deps);
  assert.equal(log.calls[0].timeoutMs, aiTryTimeoutMs);
});

test("slow Gemini failures leave Groq one full try inside the time limit", async () => {
  const { deps, log, route } = world({ groq: ["G1"], callMs: 18_000, replies: [timedOut, timedOut, worked] });
  assert.deepEqual(await runAiJob(deps), { ok: true });
  assert.deepEqual(route(), [`A+${flash36}`, `A+${lite}`, `G1+${groq}`]);
  assert.equal(log.calls[2].timeoutMs, aiRequestBudgetMs - 36_000 > aiTryTimeoutMs ? aiTryTimeoutMs : aiRequestBudgetMs - 36_000);
});

test("with no time left it stops rather than overrun", async () => {
  const { deps, log } = world({ deadlineAt: start + 2_000 });
  await assert.rejects(runAiJob(deps), failsWith("ai_busy"));
  assert.equal(log.calls.length, 0);
});

test("a call that throws still releases its slot", async () => {
  const { deps, log } = world();
  deps.call = async () => { throw new Error("database went away"); };
  await assert.rejects(runAiJob(deps), /database went away/);
  assert.deepEqual(log.released, [aiSlotId("A", flash36)]);
});

test("each kind of failure gets the agreed pause and next step", () => {
  const now = start;
  const pause = (failure: AiFailure) => decideAiFailure(failure, now).pause;
  const move = (failure: AiFailure) => decideAiFailure(failure, now).move;
  assert.equal(pause(overloaded)?.until, now + 30 * 60_000);
  assert.equal(pause(timedOut)?.until, now + 30 * 60_000);
  assert.equal(pause(missing)?.until, now + 30 * 60_000);
  assert.equal(pause(dailyLimit)?.until, Date.parse(midnight));
  assert.equal(pause(noQuota)?.until, Date.parse(midnight));
  assert.equal(pause(minuteLimit)?.until, now + 34_000);
  assert.equal(pause({ ...minuteLimit, retryAfterSeconds: null })?.until, now + 60_000);
  assert.equal(pause(badKey)?.scope, "key");
  assert.equal(pause(badRequest), null);
  for (const failure of [overloaded, timedOut, dailyLimit, minuteLimit, noQuota, missing]) assert.equal(move(failure), "next_model");
  assert.equal(move(badKey), "next_key");
  assert.equal(move(noAccess), "next_key");
  assert.equal(move(badRequest), "stop");
});
