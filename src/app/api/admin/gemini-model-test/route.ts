import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getGeminiApiKeys, requestGeminiApi } from "@/lib/gemini-usage";
import { getCurrentUser } from "@/lib/session";
import { estimateGeminiInputTokens } from "@/server/gemini/gemini-request";
import { geminiJobEvaluationGenerationConfig } from "@/server/gemini/job-evaluation-config";
import {
  applyModelTestOutcome,
  buildModelTestPrompt,
  classifyModelTestNetworkError,
  classifyModelTestReply,
  continueModelTestRun,
  createModelTestRun,
  defaultModelTestSettings,
  isModelTestAllowed,
  isModelTestCallTooSoon,
  maxModelTestKeys,
  nextModelTestStep,
  pacificDay,
  parseModelTestSettings,
  reserveModelTestCall,
  type ModelTestKeyState,
  type ModelTestModelId,
  type ModelTestOutcome,
  type ModelTestSettings,
} from "@/server/gemini/model-test";
import {
  clearModelTestRun,
  clearModelTestSettings,
  modelTestKeyId,
  readModelTestState,
  saveModelTestSettings,
  writeModelTestKey,
  writeModelTestRun,
} from "@/server/gemini/model-test-store";

// Gemini Usage's Model test. Each "call" is one Google request; the page runs the rounds, because
// one server request can't last as long as a whole test. Test calls don't touch the live per-key
// counters or leases, and appear in the Google responses list like any other call.

export const maxDuration = 60;

const googleTimeoutMs = 45_000;
const saveAttempts = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const failure = (error: string, status: number, code?: string) =>
  NextResponse.json({ error, ...(code ? { code } : {}) }, { status });

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function readKeyNumber(value: unknown, keyCount: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= keyCount ? value : null;
}

async function callGoogle(apiKey: string, model: ModelTestModelId, testText: string): Promise<ModelTestOutcome> {
  const prompt = buildModelTestPrompt(testText);
  const startedAt = Date.now();
  try {
    const response = await requestGeminiApi(
      apiKey,
      "generate_content",
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: geminiJobEvaluationGenerationConfig,
        }),
        signal: AbortSignal.timeout(googleTimeoutMs),
        cache: "no-store",
      },
      { local: estimateGeminiInputTokens(prompt, geminiJobEvaluationGenerationConfig) },
    );
    return classifyModelTestReply(response.status, response.body.replaceAll(apiKey, "[redacted]"), Date.now() - startedAt);
  } catch (error) {
    return classifyModelTestNetworkError(error instanceof Error ? error.name : "Error", Date.now() - startedAt);
  }
}

/** Null when the run was reset while Google was answering. */
async function saveOutcome(
  runId: string,
  keyId: string,
  reserved: ModelTestKeyState,
  model: ModelTestModelId,
  outcome: ModelTestOutcome,
  settings: ModelTestSettings,
): Promise<ModelTestKeyState | null> {
  let base = reserved;
  for (let attempt = 0; attempt < saveAttempts; attempt += 1) {
    const next = applyModelTestOutcome(base, model, outcome, settings, Date.now());
    if (await writeModelTestKey(runId, keyId, base.version, next)) return next;
    const { run } = await readModelTestState();
    const latest = run?.runId === runId ? run.keys[keyId] : undefined;
    if (!latest) return null;
    base = latest;
  }
  return null;
}

async function start(body: Record<string, unknown>) {
  const keys = getGeminiApiKeys();
  const numbers = Array.isArray(body.keyNumbers) ? body.keyNumbers.map((value) => readKeyNumber(value, keys.length)) : [];
  if (!numbers.length || numbers.length > maxModelTestKeys || numbers.includes(null) || new Set(numbers).size !== numbers.length) {
    return failure(`Tick between 1 and ${maxModelTestKeys} keys.`, 400);
  }
  const keyIds = (numbers as number[]).map((number) => modelTestKeyId(keys[number - 1]));
  const nowMs = Date.now();
  const { run: existing } = await readModelTestState();
  // Google's daily limits have reset by a new Pacific day, so yesterday's counts no longer apply.
  const run = existing?.pacificDay === pacificDay(nowMs)
    ? continueModelTestRun(existing, keyIds)
    : createModelTestRun(randomUUID(), keyIds, nowMs);
  await writeModelTestRun(run);
  return NextResponse.json({ run });
}

async function call(body: Record<string, unknown>) {
  const keys = getGeminiApiKeys();
  const keyNumber = readKeyNumber(body.keyNumber, keys.length);
  if (keyNumber === null || typeof body.runId !== "string") return failure("Invalid key or run.", 400);
  const apiKey = keys[keyNumber - 1];
  const keyId = modelTestKeyId(apiKey);

  const { settings, run } = await readModelTestState();
  if (!run || run.runId !== body.runId) return failure("This test was reset. Press Start to begin again.", 409, "stale_run");
  const nowMs = Date.now();
  if (run.pacificDay !== pacificDay(nowMs)) {
    return failure("A new Pacific day has started, so Google's limits have reset. Press Start for a new count.", 409, "new_day");
  }
  const key = run.keys[keyId];
  if (!key) return failure("That key is not part of this test.", 400);

  const reply = (state: ModelTestKeyState, result: string) =>
    NextResponse.json({ keyId, key: state, result, done: nextModelTestStep(settings, state, Date.now()).kind === "done" });

  const step = nextModelTestStep(settings, key, nowMs);
  if (step.kind === "done") return reply(key, "done");
  if (step.kind === "wait") return reply(key, "waiting");
  if (isModelTestCallTooSoon(settings, key, nowMs)) return reply(key, "too_soon");

  const reserved = reserveModelTestCall(key, step.model, nowMs);
  if (!(await writeModelTestKey(run.runId, keyId, key.version, reserved))) return reply(key, "busy");

  const outcome = await callGoogle(apiKey, step.model, settings.testText);
  const saved = await saveOutcome(run.runId, keyId, reserved, step.model, outcome, settings);
  if (!saved) return failure("This test was reset. Press Start to begin again.", 409, "stale_run");
  return reply(saved, "called");
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isModelTestAllowed(process.env)) return failure("Not found.", 404);
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "super_admin") return failure("Forbidden.", 403);
  if (!isSameOriginRequest(request)) return failure("Invalid request origin.", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Invalid JSON body.", 400);
  }
  if (!isRecord(body)) return failure("Invalid request.", 400);

  try {
    switch (body.action) {
      case "start":
        return await start(body);
      case "call":
        return await call(body);
      case "reset_counts":
        await clearModelTestRun();
        return NextResponse.json({ run: null });
      case "save_settings": {
        const settings = parseModelTestSettings(body.settings);
        if (!settings) return failure("Check the test settings: tick a model, use whole numbers in range, and keep the test text.", 400);
        await saveModelTestSettings(settings, currentUser.id);
        return NextResponse.json({ settings });
      }
      case "reset_settings":
        await clearModelTestSettings();
        return NextResponse.json({ settings: defaultModelTestSettings() });
      default:
        return failure("Unknown action.", 400);
    }
  } catch (error) {
    console.error("Gemini model test failed.", error instanceof Error ? error.name : "Unknown error");
    return failure("The test request failed. Check the Vercel function log.", 500);
  }
}
