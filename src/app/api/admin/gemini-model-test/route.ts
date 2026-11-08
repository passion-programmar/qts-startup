import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getGeminiApiKeyHash, getGeminiApiKeys, getGroqApiKeys, recordAiSlotCall } from "@/lib/gemini-usage";
import { getCurrentUser } from "@/lib/session";
import { callAiModel } from "@/server/gemini/ai-call";
import { aiSlotId, isAiModelId, type AiProvider } from "@/server/gemini/ai-models";
import { estimateGroqInputTokens } from "@/server/gemini/ai-reply";
import { estimateGeminiInputTokens } from "@/server/gemini/gemini-request";
import { geminiJobEvaluationGenerationConfig, groqJobEvaluationJsonHint } from "@/server/gemini/job-evaluation-config";
import {
  applyModelTestOutcome,
  buildModelTestPrompt,
  continueModelTestRun,
  createModelTestRun,
  defaultModelTestSettings,
  isModelTestAllowed,
  isModelTestCallTooSoon,
  maxModelTestKeys,
  modelTestOutcomeFromAi,
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

// Gemini Usage's Model test. Each "call" is one request to the provider; the page runs the rounds,
// because one server request can't last as long as a whole test. The test has its own limits, but
// every call it makes on a live model counts toward that key and model's usage for the day.

export const maxDuration = 60;

const providerTimeoutMs = 45_000;
const saveAttempts = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const failure = (error: string, status: number, code?: string) =>
  NextResponse.json({ error, ...(code ? { code } : {}) }, { status });

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

const keysOf = (provider: AiProvider): string[] => (provider === "groq" ? getGroqApiKeys() : getGeminiApiKeys());

function readKeyNumber(value: unknown, keyCount: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= keyCount ? value : null;
}

/** The ticked keys of one provider, or null when the list isn't valid. */
function readKeyIds(value: unknown, provider: AiProvider): string[] | null {
  if (value === undefined) return [];
  const keys = keysOf(provider);
  if (!Array.isArray(value) || value.length > maxModelTestKeys) return null;
  const numbers = value.map((entry) => readKeyNumber(entry, keys.length));
  if (numbers.includes(null) || new Set(numbers).size !== numbers.length) return null;
  return (numbers as number[]).map((number) => modelTestKeyId(keys[number - 1]));
}

async function callProvider(
  provider: AiProvider,
  apiKey: string,
  slotId: string,
  model: ModelTestModelId,
  testText: string,
): Promise<ModelTestOutcome> {
  const prompt = buildModelTestPrompt(testText);
  const contents = [{ role: "user" as const, parts: [{ text: prompt }] }];
  const outcome = await callAiModel(
    { provider, modelId: model, apiKey, slotId },
    {
      contents,
      generationConfig: geminiJobEvaluationGenerationConfig,
      jsonHint: groqJobEvaluationJsonHint,
      timeoutMs: providerTimeoutMs,
      tokenCounts: { local: estimateTokens(provider, prompt) },
    },
  );
  return modelTestOutcomeFromAi(outcome);
}

function estimateTokens(provider: AiProvider, prompt: string): number {
  return provider === "groq"
    ? estimateGroqInputTokens([{ role: "user", parts: [{ text: prompt }] }], groqJobEvaluationJsonHint)
    : estimateGeminiInputTokens(prompt, geminiJobEvaluationGenerationConfig);
}

/** Null when the run was reset while the provider was answering. */
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
  const geminiKeyIds = readKeyIds(body.keyNumbers, "gemini");
  const groqKeyIds = readKeyIds(body.groqKeyNumbers, "groq");
  if (!geminiKeyIds || !groqKeyIds || geminiKeyIds.length + groqKeyIds.length === 0) {
    return failure(`Tick between 1 and ${maxModelTestKeys} keys for each provider.`, 400);
  }
  const keyIds = [...geminiKeyIds, ...groqKeyIds];
  const nowMs = Date.now();
  const { run: existing } = await readModelTestState();
  // The daily limits have reset by a new Pacific day, so yesterday's counts no longer apply.
  const run = existing?.pacificDay === pacificDay(nowMs)
    ? continueModelTestRun(existing, keyIds)
    : createModelTestRun(randomUUID(), keyIds, nowMs);
  await writeModelTestRun(run);
  return NextResponse.json({ run });
}

async function call(body: Record<string, unknown>) {
  const provider: AiProvider = body.provider === "groq" ? "groq" : "gemini";
  const keys = keysOf(provider);
  const keyNumber = readKeyNumber(body.keyNumber, keys.length);
  if (keyNumber === null || typeof body.runId !== "string") return failure("Invalid key or run.", 400);
  const apiKey = keys[keyNumber - 1];
  const keyId = modelTestKeyId(apiKey);

  const { settings, run } = await readModelTestState();
  if (!run || run.runId !== body.runId) return failure("This test was reset. Press Start to begin again.", 409, "stale_run");
  const nowMs = Date.now();
  if (run.pacificDay !== pacificDay(nowMs)) {
    return failure("A new Pacific day has started, so the daily limits have reset. Press Start for a new count.", 409, "new_day");
  }
  const key = run.keys[keyId];
  if (!key) return failure("That key is not part of this test.", 400);

  const reply = (state: ModelTestKeyState, result: string) =>
    NextResponse.json({ keyId, key: state, result, done: nextModelTestStep(settings, state, Date.now(), provider).kind === "done" });

  const step = nextModelTestStep(settings, key, nowMs, provider);
  if (step.kind === "done") return reply(key, "done");
  if (step.kind === "wait") return reply(key, "waiting");
  if (isModelTestCallTooSoon(settings, key, nowMs)) return reply(key, "too_soon");

  const reserved = reserveModelTestCall(key, step.model, nowMs);
  if (!(await writeModelTestKey(run.runId, keyId, key.version, reserved))) return reply(key, "busy");

  const slotId = aiSlotId(getGeminiApiKeyHash(apiKey), step.model);
  // Only live models: 3.8 Flash isn't in use, so its usage rows would never be cleared.
  if (isAiModelId(step.model)) {
    await recordAiSlotCall(slotId, "generate_content", estimateTokens(provider, buildModelTestPrompt(settings.testText)));
  }
  const outcome = await callProvider(provider, apiKey, slotId, step.model, settings.testText);
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
