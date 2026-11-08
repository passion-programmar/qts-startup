import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelTestOutcome,
  classifyModelTestNetworkError,
  classifyModelTestReply,
  continueModelTestRun,
  createModelTestRun,
  defaultModelTestSettings,
  describeModelTestCell,
  isModelTestAllowed,
  isModelTestCallTooSoon,
  modelTestModels,
  modelTestOutcomeFromAi,
  nextModelTestStep,
  nextPacificMidnight,
  pacificDay,
  parseModelTestSettings,
  reserveModelTestCall,
  summarizeModelTestRun,
  type ModelTestKeyState,
  type ModelTestModelId,
  type ModelTestOutcome,
  type ModelTestSettings,
} from "@/server/gemini/model-test";

const now = Date.parse("2026-11-08T17:00:00Z");
const flash38: ModelTestModelId = "gemini-3.8-flash";
const flash36: ModelTestModelId = "gemini-3.6-flash";
const lite: ModelTestModelId = "gemini-3.5-flash-lite";
const info = (id: ModelTestModelId) => modelTestModels.find((model) => model.id === id)!;
const answer = JSON.stringify({ isJobPage: true, isRemote: true, job: { title: "x" }, matchingProfileIndexes: [] });
const okBody = JSON.stringify({ modelVersion: "gemini-3.8-flash", candidates: [{ content: { parts: [{ text: answer }] } }] });
const quotaBody = (quotaId: string, quotaValue: string, extra: object[] = []) => JSON.stringify({
  error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded", details: [
    { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaValue }] },
    ...extra,
  ] },
});
const ok = classifyModelTestReply(200, okBody, 900);
const overloaded = classifyModelTestReply(503, JSON.stringify({ error: { message: "high demand" } }), 400);
const dailyLimit = classifyModelTestReply(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20"), 300);
const freshKey = (): ModelTestKeyState => createModelTestRun("run", ["k"], now).keys.k;

function settingsWith(changes: Partial<ModelTestSettings> = {}, caps: Partial<Record<ModelTestModelId, number>> = {}): ModelTestSettings {
  const settings = { ...defaultModelTestSettings(), ...changes };
  for (const [id, maxCalls] of Object.entries(caps)) settings.models[id as ModelTestModelId].maxCalls = maxCalls;
  return settings;
}

/** One test call to the model the rules pick, answered with `outcome`. */
function step(key: ModelTestKeyState, settings: ModelTestSettings, outcome: ModelTestOutcome, at = now) {
  const next = nextModelTestStep(settings, key, at);
  assert.equal(next.kind, "call");
  if (next.kind !== "call") throw new Error("expected a call");
  return { model: next.model, key: applyModelTestOutcome(reserveModelTestCall(key, next.model, at), next.model, outcome, settings, at) };
}

test("a key works down the models: daily limit moves on, then the cap ends the test", () => {
  const settings = settingsWith({}, { [flash38]: 25, [flash36]: 25, [lite]: 2 });
  let key = freshKey();
  const used: string[] = [];
  const run = (outcome: ModelTestOutcome) => {
    const result = step(key, settings, outcome);
    used.push(result.model);
    key = result.key;
  };
  for (let index = 0; index < 20; index += 1) run(ok);
  run(dailyLimit);
  for (let index = 0; index < 20; index += 1) run(ok);
  run(dailyLimit);
  run(ok);
  run(ok);

  assert.deepEqual(used.slice(19, 22), [flash38, flash38, flash36]);
  assert.deepEqual(used.slice(-3), [flash36, lite, lite]);
  assert.equal(nextModelTestStep(settings, key, now).kind, "done");
  assert.equal(key.models[flash38]?.worked, 20);
  assert.equal(key.models[flash38]?.dailyLimit, 20);
  assert.equal(key.models[flash38]?.limited, 1);
  assert.equal(key.models[flash38]?.failed, 0);
});

test("unticked models are skipped, and raising a cap lets the same run continue", () => {
  const settings = settingsWith({}, { [lite]: 1 });
  settings.models[flash38].enabled = false;
  settings.models[flash36].enabled = false;
  const first = step(freshKey(), settings, ok);
  assert.equal(first.model, lite);
  assert.equal(nextModelTestStep(settings, first.key, now).kind, "done");
  assert.deepEqual(nextModelTestStep(settingsWith({}, { [lite]: 2 }), first.key, now), { kind: "call", model: flash38 });
  const onlyLite = settingsWith({}, { [lite]: 2 });
  onlyLite.models[flash38].enabled = false;
  onlyLite.models[flash36].enabled = false;
  assert.deepEqual(nextModelTestStep(onlyLite, first.key, now), { kind: "call", model: lite });
});

test("failures stay on the model until the setting's count in a row, and a success resets the count", () => {
  const settings = settingsWith({ failuresBeforeNextModel: 3 });
  let key = freshKey();
  key = step(key, settings, overloaded).key;
  key = step(key, settings, overloaded).key;
  key = step(key, settings, ok).key;
  assert.equal(key.models[flash38]?.failuresInRow, 0);
  for (let index = 0; index < 3; index += 1) key = step(key, settings, overloaded).key;
  assert.equal(key.models[flash38]?.failed, 5);
  assert.equal(key.models[flash38]?.finished, true);
  assert.deepEqual(nextModelTestStep(settings, key, now), { kind: "call", model: flash36 });
  assert.match(key.models[flash38]?.unavailable?.text ?? "", /503 overloaded, moved on after 3 failures in a row/);
});

test("setting failures to 1 moves to the next model after one failure, like the live plan", () => {
  const settings = settingsWith({ failuresBeforeNextModel: 1 });
  assert.deepEqual(nextModelTestStep(settings, step(freshKey(), settings, overloaded).key, now), { kind: "call", model: flash36 });
});

test("a per-minute limit waits on the same model, then tries it again", () => {
  const settings = settingsWith();
  const reply = classifyModelTestReply(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "5", [{ retryDelay: "34.2s" }]), 200);
  assert.deepEqual([reply.kind, reply.kind === "minute_limit" && reply.limit, reply.kind === "minute_limit" && reply.retryAfterSeconds], ["minute_limit", 5, 35]);
  const key = step(freshKey(), settings, reply).key;
  assert.equal(key.models[flash38]?.minuteLimit, 5);
  assert.equal(key.models[flash38]?.finished, false);
  assert.equal(nextModelTestStep(settings, key, now + 34_000).kind, "wait");
  assert.deepEqual(nextModelTestStep(settings, key, now + 35_000), { kind: "call", model: flash38 });
  assert.equal(key.models[flash38]?.failed, 0);
});

test("a per-minute limit with no retry time waits a minute", () => {
  const key = step(freshKey(), settingsWith(), classifyModelTestReply(429, quotaBody("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "5"), 200)).key;
  assert.equal(key.models[flash38]?.unavailable?.until, new Date(now + 60_000).toISOString());
});

test("Google's replies are read into the right outcome", () => {
  const worked = classifyModelTestReply(200, okBody, 1200);
  assert.deepEqual(worked, { kind: "worked", httpStatus: 200, durationMs: 1200, modelVersion: "gemini-3.8-flash", validJson: true });
  const notJson = JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] });
  assert.equal(classifyModelTestReply(200, notJson, 1).kind, "worked");
  assert.equal((classifyModelTestReply(200, notJson, 1) as { validJson: boolean }).validJson, false);
  assert.equal((classifyModelTestReply(200, "", 1) as { validJson: boolean }).validJson, false);

  assert.deepEqual(
    [dailyLimit.kind, dailyLimit.kind === "daily_limit" && dailyLimit.limit],
    ["daily_limit", 20],
  );
  assert.equal(classifyModelTestReply(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0"), 1).kind, "blocked");
  assert.equal(classifyModelTestReply(404, "{}", 1).kind, "blocked");
  assert.equal((classifyModelTestReply(404, "{}", 1) as { reason: string }).reason, "model_missing");
  assert.equal((classifyModelTestReply(403, "{}", 1) as { reason: string }).reason, "no_access");
  assert.equal((classifyModelTestReply(400, "{}", 1) as { reason: string }).reason, "bad_request");
  assert.equal((classifyModelTestReply(500, "not json", 1) as { reason: string }).reason, "overloaded");
  assert.equal((classifyModelTestNetworkError("TimeoutError", 45_000) as { reason: string }).reason, "timeout");
  assert.equal((classifyModelTestNetworkError("TypeError", 10) as { reason: string }).reason, "network");
});

test("a 429 that names both limits counts as the daily limit, and a token limit is not a count of calls", () => {
  const both = JSON.stringify({ error: { details: [{ violations: [
    { quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "5" },
    { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" },
  ] }] } });
  assert.equal(classifyModelTestReply(429, both, 1).kind, "daily_limit");
  const tokens = classifyModelTestReply(429, quotaBody("GenerateContentInputTokensPerModelPerMinute-FreeTier", "250000"), 1);
  assert.deepEqual([tokens.kind, tokens.kind === "minute_limit" && tokens.limit], ["minute_limit", null]);
  const noDetails = classifyModelTestReply(429, JSON.stringify({ error: { message: "generate_requests_per_model_per_day exceeded" } }), 1);
  assert.equal(noDetails.kind, "daily_limit");
});

test("a limit of 0 finishes the model as having no quota", () => {
  const settings = settingsWith();
  const key = step(freshKey(), settings, classifyModelTestReply(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "0"), 1)).key;
  assert.equal(key.models[flash38]?.dailyLimit, 0);
  const view = describeModelTestCell(info(flash38), key.models[flash38], 25, now);
  assert.deepEqual([view.status, view.reason, view.limit, view.left, view.availableAgain], ["Not available", "No quota for this model on this project", "0", "0", "Not until fixed"]);
});

test("a model Google refuses finishes after one call and the key moves on", () => {
  const settings = settingsWith();
  const key = step(freshKey(), settings, classifyModelTestReply(404, "{}", 1)).key;
  assert.deepEqual(nextModelTestStep(settings, key, now), { kind: "call", model: flash36 });
  assert.equal(describeModelTestCell(info(flash38), key.models[flash38], 25, now).availableAgain, "Not until fixed");
});

test("the timeline records only changes and keeps its size", () => {
  const settings = settingsWith({ failuresBeforeNextModel: 100 });
  let key = freshKey();
  key = step(key, settings, ok, now).key;
  key = step(key, settings, ok, now + 1000).key;
  assert.equal(key.timeline.length, 0);
  key = step(key, settings, overloaded, now + 2000).key;
  key = step(key, settings, overloaded, now + 3000).key;
  key = step(key, settings, ok, now + 4000).key;
  assert.deepEqual(key.timeline.map((event) => [event.available, event.text]), [[false, "503 overloaded"], [true, "Available again"]]);
  assert.equal(key.timeline[0].at, new Date(now + 2000).toISOString());

  const busy = settingsWith({ failuresBeforeNextModel: 100 }, { [flash38]: 5000 });
  for (let index = 0; index < 120; index += 1) {
    key = step(key, busy, overloaded, now + index).key;
    key = step(key, busy, ok, now + index).key;
  }
  assert.equal(key.timeline.length, 100);
});

test("repeated failures keep the time the model first became unavailable", () => {
  const settings = settingsWith({ failuresBeforeNextModel: 100 });
  let key = step(freshKey(), settings, overloaded, now).key;
  key = step(key, settings, overloaded, now + 30_000).key;
  assert.equal(key.models[flash38]?.unavailable?.since, new Date(now).toISOString());
});

test("the cap counts every attempt, so a run always ends", () => {
  const settings = settingsWith({ failuresBeforeNextModel: 100 }, { [flash38]: 3, [flash36]: 1, [lite]: 1 });
  let key = freshKey();
  for (let index = 0; index < 3; index += 1) key = step(key, settings, overloaded).key;
  assert.deepEqual(nextModelTestStep(settings, key, now), { kind: "call", model: flash36 });
});

test("the page shows left and limit as reported until Google states them", () => {
  const settings = settingsWith();
  let key = freshKey();
  for (let index = 0; index < 12; index += 1) key = step(key, settings, ok).key;
  const before = describeModelTestCell(info(flash38), key.models[flash38], 25, now);
  assert.deepEqual([before.worked, before.limit, before.left, before.status, before.reason, before.validJson], [12, "about 20", "about 8", "Available", "Working", "12 of 12"]);
  assert.equal(before.lastReply, "HTTP 200 · 0.9 s · gemini-3.8-flash");

  key = step(key, settings, classifyModelTestReply(429, quotaBody("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "18"), 1)).key;
  const after = describeModelTestCell(info(flash38), key.models[flash38], 25, now);
  assert.deepEqual([after.limit, after.left, after.status, after.reason], ["18", "0", "Not available", "Daily limit, Google says 18"]);

  const untested = describeModelTestCell(info(lite), undefined, 5, now);
  assert.deepEqual([untested.limit, untested.left, untested.status], ["?", "?", "Not tested"]);
});

test("the page shows when a model is not available and when it comes back", () => {
  const settings = settingsWith();
  const key = step(freshKey(), settings, dailyLimit, now).key;
  const view = describeModelTestCell(info(flash38), key.models[flash38], 25, now + 60_000);
  assert.equal(view.since, "09:00");
  // 17:00 UTC is 09:00 Pacific; midnight Pacific is 15 hours later.
  assert.equal(view.availableAgain, "00:00 (in 14h 59m)");

  const afterReset = describeModelTestCell(info(flash38), key.models[flash38], 25, nextPacificMidnight(now) + 1);
  assert.deepEqual([afterReset.status, afterReset.reason, afterReset.availableAgain], ["Available", "Limit has reset", "Now"]);

  const overloadedKey = step(freshKey(), settings, overloaded, now).key;
  assert.equal(describeModelTestCell(info(flash38), overloadedKey.models[flash38], 25, now).availableAgain, "Unknown until a retry works");
});

test("the test cap is shown when a model stopped because of it", () => {
  const settings = settingsWith({}, { [lite]: 1 });
  settings.models[flash38].enabled = false;
  settings.models[flash36].enabled = false;
  const view = describeModelTestCell(info(lite), step(freshKey(), settings, ok).key.models[lite], 1, now);
  assert.deepEqual([view.status, view.reason, view.left], ["Available", "Test cap reached", "?"]);
});

test("speed is limited per key, with a little leeway", () => {
  const settings = settingsWith({ callsPerMinute: 2 });
  const key = reserveModelTestCall(freshKey(), flash38, now);
  assert.equal(isModelTestCallTooSoon(settings, freshKey(), now), false);
  assert.equal(isModelTestCallTooSoon(settings, key, now + 20_000), true);
  assert.equal(isModelTestCallTooSoon(settings, key, now + 28_000), false);
});

test("at high speed a key's random place in the round doesn't make it miss a round", () => {
  const settings = settingsWith({ callsPerMinute: 60 });
  const key = reserveModelTestCall(freshKey(), flash38, now);
  // First in one round and last-but-two places earlier in the next: 300 ms under the round's length.
  assert.equal(isModelTestCallTooSoon(settings, key, now + 700), false);
  assert.equal(isModelTestCallTooSoon(settings, key, now + 400), true);
});

test("the attempt is counted and the version bumped before Google is called", () => {
  const key = reserveModelTestCall(freshKey(), flash38, now);
  assert.deepEqual([key.version, key.models[flash38]?.calls, key.lastCallAt], [1, 1, new Date(now).toISOString()]);
});

test("the total uses Google's stated limits, and says at least while any are unknown", () => {
  const settings = settingsWith({}, { [lite]: 1 });
  let key = freshKey();
  for (let index = 0; index < 2; index += 1) key = step(key, settings, ok).key;
  key = step(key, settings, dailyLimit).key;
  key = step(key, settings, dailyLimit).key;
  key = step(key, settings, ok).key;
  const run = { ...createModelTestRun("run", ["k", "other"], now), keys: { k: key, other: key } };
  assert.deepEqual(summarizeModelTestRun(run, ["k", "other"], settings), { total: 82, exact: false });
  settings.models[lite].enabled = false;
  assert.deepEqual(summarizeModelTestRun(run, ["k"], settings), { total: 40, exact: true });
});

test("settings accept the page's text numbers and refuse anything out of range", () => {
  const settings = defaultModelTestSettings();
  assert.deepEqual(parseModelTestSettings(JSON.parse(JSON.stringify(settings))), settings);
  const asText = { ...settings, callsPerMinute: "6", failuresBeforeNextModel: "1" };
  assert.deepEqual(
    [parseModelTestSettings(asText)?.callsPerMinute, parseModelTestSettings(asText)?.failuresBeforeNextModel],
    [6, 1],
  );
  for (const bad of [
    null,
    { ...settings, callsPerMinute: 0 },
    { ...settings, callsPerMinute: 61 },
    { ...settings, failuresBeforeNextModel: "x" },
    { ...settings, testText: "   " },
    { ...settings, testText: "x".repeat(100_001) },
    { ...settings, models: { ...settings.models, [lite]: { enabled: true, maxCalls: 5001 } } },
    { ...settings, models: Object.fromEntries(modelTestModels.map(({ id }) => [id, { enabled: false, maxCalls: 1 }])) },
  ]) {
    assert.equal(parseModelTestSettings(bad), null);
  }
});

test("Start on the same day keeps counts and adds newly ticked keys", () => {
  const run = createModelTestRun("run", ["a"], now);
  run.keys.a = reserveModelTestCall(run.keys.a, flash38, now);
  const continued = continueModelTestRun(run, ["a", "b"]);
  assert.equal(continued.runId, "run");
  assert.deepEqual(continued.selectedKeyIds, ["a", "b"]);
  assert.equal(continued.keys.a.models[flash38]?.calls, 1);
  assert.equal(continued.keys.b.version, 0);
});

test("the daily reset is midnight Pacific, across clock changes", () => {
  assert.equal(pacificDay(Date.parse("2026-11-09T07:59:00Z")), "2026-11-08");
  assert.equal(pacificDay(Date.parse("2026-11-09T08:00:00Z")), "2026-11-09");
  assert.equal(new Date(nextPacificMidnight(now)).toISOString(), "2026-11-09T08:00:00.000Z");
  // Clocks go forward on 8 March 2026: midnight that day is still PST, the next one is PDT.
  assert.equal(new Date(nextPacificMidnight(Date.parse("2026-03-07T20:00:00Z"))).toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(new Date(nextPacificMidnight(Date.parse("2026-03-08T20:00:00Z"))).toISOString(), "2026-03-09T07:00:00.000Z");
  // Clocks go back on 1 November 2026: midnight that night is PST.
  assert.equal(new Date(nextPacificMidnight(Date.parse("2026-11-01T20:00:00Z"))).toISOString(), "2026-11-02T08:00:00.000Z");
});

test("settings saved before Groq was added still load, and Groq starts from its defaults", () => {
  const settings = JSON.parse(JSON.stringify(defaultModelTestSettings())) as ModelTestSettings;
  delete (settings.models as Record<string, unknown>)["openai/gpt-oss-120b"];
  settings.callsPerMinute = 5;
  const parsed = parseModelTestSettings(settings);
  assert.equal(parsed?.callsPerMinute, 5);
  assert.deepEqual(parsed?.models["openai/gpt-oss-120b"], { enabled: true, maxCalls: 5 });
});

test("a key only ever gets its own provider's models", () => {
  const settings = settingsWith({}, { "openai/gpt-oss-120b": 1 });
  assert.deepEqual(nextModelTestStep(settings, freshKey(), now, "groq"), { kind: "call", model: "openai/gpt-oss-120b" });
  assert.deepEqual(nextModelTestStep(settings, freshKey(), now, "gemini"), { kind: "call", model: flash38 });
  const key = applyModelTestOutcome(reserveModelTestCall(freshKey(), "openai/gpt-oss-120b", now), "openai/gpt-oss-120b", ok, settings, now);
  assert.equal(nextModelTestStep(settings, key, now, "groq").kind, "done");
});

test("a reply that wasn't valid JSON is a retryable failure, not a refusal", () => {
  const settings = settingsWith();
  const outcome = modelTestOutcomeFromAi({ kind: "blocked", reason: "broken_reply", httpStatus: 400, durationMs: 1, detail: "x" });
  assert.equal(outcome.kind, "failed");
  const key = step(freshKey(), settings, outcome).key;
  assert.equal(key.models[flash38]?.finished, false);
  assert.equal(key.models[flash38]?.unavailable?.text, "Reply wasn't valid JSON");
});

test("the total counts each key only on its own provider's models", () => {
  const settings = settingsWith();
  const run = createModelTestRun("run", ["g"], now);
  run.keys.g = step(run.keys.g, settings, ok, now).key;
  assert.deepEqual(summarizeModelTestRun(run, ["g"], settings, () => "groq"), { total: 0, exact: false });
});

test("a new run is already counted live, so it's never counted twice", () => {
  assert.equal(createModelTestRun("run", ["k"], now).countedInLiveUsage, true);
});

test("the test can only be used on the Production deployment", () => {
  assert.equal(isModelTestAllowed({ VERCEL: "1", VERCEL_ENV: "production" }), true);
  assert.equal(isModelTestAllowed({ VERCEL: "1", VERCEL_ENV: "preview" }), false);
  assert.equal(isModelTestAllowed({}), false);
});
