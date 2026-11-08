import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// The route with a fake Google and an in-memory store. Nothing here reaches a network or a database.

type Fixture = {
  user: { id: string; role: string } | null;
  keys: string[];
  settings: Record<string, unknown>;
  run: { runId: string; pacificDay: string; keys: Record<string, { lastCallAt: string | null; version: number; models: Record<string, Record<string, number>> }> } | null;
  google: Array<{ key: string; url: string; body: { generationConfig: { responseMimeType: string } } }>;
  reply: () => { ok: boolean; status: number; body: string };
  failNextKeySave: boolean;
};

const answer = JSON.stringify({ isJobPage: true, job: {} });
const okReply = () => ({ ok: true, status: 200, body: JSON.stringify({ modelVersion: "m", candidates: [{ content: { parts: [{ text: answer }] } }] }) });
const fixture: Fixture = { user: null, keys: [], settings: {}, run: null, google: [], reply: okReply, failNextKeySave: false };
(globalThis as Record<string, unknown>).__qtsModelTest = fixture;

let POST: (request: Request) => Promise<Response>;
let defaults: () => Record<string, unknown>;

test.before(async () => {
  const f = "globalThis.__qtsModelTest";
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/session": `export const getCurrentUser=async()=>${f}.user;`,
    // Only these two: a route that also used the live counters or leases would not build here.
    "@/lib/gemini-usage": `export const getGeminiApiKeys=()=>${f}.keys;export const requestGeminiApi=async(key,kind,url,options)=>{${f}.google.push({key,url,body:JSON.parse(options.body)});return ${f}.reply();};`,
    "@/server/gemini/model-test-store": `
      export const modelTestKeyId=(key)=>'id-'+key.slice(0,4);
      export const readModelTestState=async()=>({settings:${f}.settings,run:${f}.run?structuredClone(${f}.run):null});
      export const saveModelTestSettings=async(value)=>{${f}.settings=value};
      export const clearModelTestSettings=async()=>{${f}.settings={cleared:true}};
      export const writeModelTestRun=async(run)=>{${f}.run=structuredClone(run)};
      export const clearModelTestRun=async()=>{${f}.run=null};
      export const writeModelTestKey=async(runId,keyId,version,state)=>{
        if(${f}.failNextKeySave){${f}.failNextKeySave=false;return false;}
        const run=${f}.run;
        if(!run||run.runId!==runId||run.keys[keyId].version!==version)return false;
        run.keys[keyId]=structuredClone(state);return true;};`,
  };
  const bundled = await build({
    absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    entryPoints: [resolve("src/app/api/admin/gemini-model-test/route.ts")],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "model-test-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => (path in mocks ? { path, namespace: "local-fixture" } : undefined));
      builder.onLoad({ filter: /.*/, namespace: "local-fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as { POST: typeof POST } };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  POST = loaded.exports.POST;

  const rules = await import("@/server/gemini/model-test");
  defaults = () => JSON.parse(JSON.stringify(rules.defaultModelTestSettings()));
});

const send = (body: object, origin = "https://qts.test") =>
  POST(new Request("https://qts.test/api/admin/gemini-model-test", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }));

function reset() {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  fixture.user = { id: "admin", role: "super_admin" };
  fixture.keys = ["AIzaKEYONE", "BIzaKEYTWO", "CIzaKEYTHREE", "DIzaKEYFOUR"];
  fixture.settings = defaults();
  fixture.run = null;
  fixture.google = [];
  fixture.reply = okReply;
  fixture.failNextKeySave = false;
}

const started = async (keyNumbers = [1]) => (await (await send({ action: "start", keyNumbers })).json()).run as { runId: string };
const callKey = (runId: string, keyNumber = 1) => send({ action: "call", runId, keyNumber });
/** Lets the next call through the speed check. */
function nextRound(keyId = "id-AIza") {
  fixture.run!.keys[keyId].lastCallAt = new Date(Date.now() - 3_600_000).toISOString();
}
const quota = (quotaId: string, quotaValue: string) => () => ({
  ok: false, status: 429, body: JSON.stringify({ error: { message: "quota", details: [{ violations: [{ quotaId, quotaValue }] }] } }),
});

test("outside Production nothing runs, even for a Super Admin", async () => {
  reset();
  process.env.VERCEL_ENV = "preview";
  const response = await send({ action: "start", keyNumbers: [1] });
  assert.equal(response.status, 404);
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  assert.equal((await callKey("any")).status, 404);
  assert.equal(fixture.google.length, 0);
  assert.equal(fixture.run, null);
});

test("only a Super Admin on the same site can use it", async () => {
  reset();
  fixture.user = { id: "m", role: "manager" };
  assert.equal((await send({ action: "start", keyNumbers: [1] })).status, 403);
  fixture.user = null;
  assert.equal((await send({ action: "start", keyNumbers: [1] })).status, 403);
  fixture.user = { id: "admin", role: "super_admin" };
  assert.equal((await send({ action: "start", keyNumbers: [1] }, "https://other.test")).status, 403);
  assert.equal(fixture.run, null);
});

test("Start takes between one and three different keys that exist", async () => {
  reset();
  for (const keyNumbers of [[], [1, 2, 3, 4], [1, 1], [9], ["1"]]) {
    assert.equal((await send({ action: "start", keyNumbers })).status, 400);
  }
  assert.equal(fixture.run, null);
  assert.equal((await send({ action: "start", keyNumbers: [1, 2, 3] })).status, 200);
  assert.deepEqual(Object.keys(fixture.run!.keys).sort(), ["id-AIza", "id-BIza", "id-CIza"]);
});

test("one call sends one Google request to the best model, with Get JD's JSON settings", async () => {
  reset();
  const run = await started();
  const body = await (await callKey(run.runId)).json();
  assert.equal(body.result, "called");
  assert.equal(fixture.google.length, 1);
  assert.match(fixture.google[0].url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(fixture.google[0].key, "AIzaKEYONE");
  assert.equal(fixture.google[0].body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.key.models["gemini-3.8-flash"].worked, 1);
  assert.equal(body.key.models["gemini-3.8-flash"].validJson, 1);
});

test("the API key never appears in a reply", async () => {
  reset();
  fixture.reply = () => ({ ok: false, status: 400, body: JSON.stringify({ error: { message: "API key AIzaKEYONE not valid" } }) });
  const run = await started();
  const response = await callKey(run.runId);
  const text = await response.text();
  assert.equal(JSON.parse(text).key.models["gemini-3.8-flash"].detail, "API key [redacted] not valid");
  assert.equal(text.includes("AIzaKEYONE"), false);
});

test("a call too soon after the last one reaches no Google request", async () => {
  reset();
  const run = await started();
  await callKey(run.runId);
  const body = await (await callKey(run.runId)).json();
  assert.equal(body.result, "too_soon");
  assert.equal(fixture.google.length, 1);
});

test("a daily limit moves that key to the next model", async () => {
  reset();
  const run = await started();
  fixture.reply = quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "20");
  const body = await (await callKey(run.runId)).json();
  assert.equal(body.key.models["gemini-3.8-flash"].dailyLimit, 20);
  nextRound();
  fixture.reply = okReply;
  await callKey(run.runId);
  assert.match(fixture.google[1].url, /gemini-3\.6-flash/);
});

test("a per-minute limit waits with no Google request, on the same model", async () => {
  reset();
  const run = await started();
  fixture.reply = quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "5");
  await callKey(run.runId);
  nextRound();
  const body = await (await callKey(run.runId)).json();
  assert.equal(body.result, "waiting");
  assert.equal(fixture.google.length, 1);
});

test("a timeout is counted as a failed call", async () => {
  reset();
  const run = await started();
  fixture.reply = () => { throw Object.assign(new Error("timed out with key AIzaKEYONE"), { name: "TimeoutError" }); };
  const response = await callKey(run.runId);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(text).key.models["gemini-3.8-flash"].failed, 1);
  assert.equal(text.includes("AIzaKEYONE"), false);
});

test("a run with every model finished reports done and calls nothing", async () => {
  reset();
  const settings = fixture.settings as { models: Record<string, { maxCalls: number }> };
  settings.models["gemini-3.8-flash"].maxCalls = 1;
  settings.models["gemini-3.6-flash"].maxCalls = 1;
  settings.models["gemini-3.5-flash-lite"].maxCalls = 1;
  const run = await started();
  for (const expectedDone of [false, false, true]) {
    nextRound();
    assert.equal((await (await callKey(run.runId)).json()).done, expectedDone);
  }
  nextRound();
  assert.equal((await (await callKey(run.runId)).json()).result, "done");
  assert.equal(fixture.google.length, 3);
});

test("a second tab that loses the save makes no Google request", async () => {
  reset();
  const run = await started();
  fixture.failNextKeySave = true;
  assert.equal((await (await callKey(run.runId)).json()).result, "busy");
  assert.equal(fixture.google.length, 0);
});

test("a stale run or a new Pacific day stops the page and calls nothing", async () => {
  reset();
  await started();
  const stale = await callKey("old-run");
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "stale_run");

  const run = await started();
  fixture.run!.pacificDay = "2000-01-01";
  const newDay = await callKey(run.runId);
  assert.equal(newDay.status, 409);
  assert.equal((await newDay.json()).code, "new_day");
  assert.equal(fixture.google.length, 0);
});

test("resetting counts while Google is answering doesn't bring them back", async () => {
  reset();
  const run = await started();
  fixture.reply = () => { fixture.run = null; return okReply(); };
  const response = await callKey(run.runId);
  assert.equal(response.status, 409);
  assert.equal(fixture.run, null);
});

test("Start the same day continues the counts; on a new day it begins again", async () => {
  reset();
  const first = await started();
  await callKey(first.runId);
  const again = await started([1, 2]);
  assert.equal(again.runId, first.runId);
  assert.equal(fixture.run!.keys["id-AIza"].models["gemini-3.8-flash"].calls, 1);

  fixture.run!.pacificDay = "2000-01-01";
  const next = await started();
  assert.notEqual(next.runId, first.runId);
  assert.deepEqual(fixture.run!.keys["id-AIza"].models, {});
});

test("settings are checked before they are saved, and can go back to the defaults", async () => {
  reset();
  assert.equal((await send({ action: "save_settings", settings: { callsPerMinute: 2 } })).status, 400);
  const changed = { ...defaults(), callsPerMinute: 6 };
  const saved = await (await send({ action: "save_settings", settings: changed })).json();
  assert.equal(saved.settings.callsPerMinute, 6);
  assert.equal((fixture.settings as { callsPerMinute: number }).callsPerMinute, 6);
  const restored = await (await send({ action: "reset_settings" })).json();
  assert.equal(restored.settings.callsPerMinute, 2);
  assert.deepEqual(fixture.settings, { cleared: true });
});

test("Reset counts clears the saved run", async () => {
  reset();
  await started();
  assert.deepEqual(await (await send({ action: "reset_counts" })).json(), { run: null });
  assert.equal(fixture.run, null);
});

test.after(() => {
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});
