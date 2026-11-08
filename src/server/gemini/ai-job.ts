import {
  aiModels,
  aiRequestTooLarge,
  aiSlotBlock,
  aiSlotId,
  aiSlotIsOutForTheDay,
  emptyAiSlotUsage,
  keysNotCalledFirst,
  nextPacificMidnight,
  type AiLimits,
  type AiModel,
  type AiPauseReason,
  type AiProvider,
  type AiSlotPause,
  type AiSlotPauses,
  type AiSlotUsage,
} from "@/server/gemini/ai-models";
import type { AiFailure, AiOutcome } from "@/server/gemini/ai-reply";

// One AI request from start to finish. Each model has its own rotation of keys. On an error the
// same key tries the next model; if that fails too, the next key starts again from the first
// model. Groq comes last. Everything outside these rules is passed in, so this file can be tested
// without a database, a network or an API key.

export const aiTryTimeoutMs = 18_000;
export const aiRequestBudgetMs = 55_000;
const minimumTryMs = 3_000;
const maxKeysPerProvider = 2;
const noSlotWaitMs = 20_000;
const noSlotPollMs = 4_000;
const overloadPauseMs = 30 * 60_000;
const modelMissingPauseMs = 30 * 60_000;
const defaultMinuteWaitSeconds = 60;

export type AiJobErrorCode = "ai_not_configured" | "ai_busy" | "ai_quota_used_up" | "ai_too_large" | "ai_bad_request";

export class AiJobError extends Error {
  constructor(
    readonly code: AiJobErrorCode,
    message: string,
    /** When the job can run again, for a quota that is used up until the daily reset. */
    readonly retryAt: number | null = null,
  ) {
    super(message);
  }
}

export type AiFailureDecision = {
  pause: { scope: "slot" | "key"; reason: AiPauseReason; text: string; until: number } | null;
  move: "next_model" | "next_key" | "stop";
};

/** What each failure means: how long to pause, and where the job goes next. */
export function decideAiFailure(outcome: AiFailure, nowMs: number): AiFailureDecision {
  switch (outcome.kind) {
    case "failed": {
      const text = outcome.reason === "timeout" ? "Timed out" : outcome.reason === "network" ? "Network error" : `${outcome.httpStatus} overloaded`;
      return { pause: { scope: "slot", reason: outcome.reason, text, until: nowMs + overloadPauseMs }, move: "next_model" };
    }
    case "daily_limit":
      return { pause: { scope: "slot", reason: "daily_limit", text: "Daily limit", until: nextPacificMidnight(nowMs) }, move: "next_model" };
    case "minute_limit":
      return {
        pause: {
          scope: "slot",
          reason: "minute_limit",
          text: "Per-minute limit",
          until: nowMs + (outcome.retryAfterSeconds ?? defaultMinuteWaitSeconds) * 1000,
        },
        move: "next_model",
      };
    case "blocked":
      switch (outcome.reason) {
        case "no_quota":
          return { pause: { scope: "slot", reason: "no_quota", text: "No quota for this model", until: nextPacificMidnight(nowMs) }, move: "next_model" };
        case "model_missing":
          return { pause: { scope: "slot", reason: "model_missing", text: "Model not found", until: nowMs + modelMissingPauseMs }, move: "next_model" };
        case "no_access":
          return { pause: { scope: "key", reason: "no_access", text: "No access", until: nextPacificMidnight(nowMs) }, move: "next_key" };
        case "bad_key":
          return { pause: { scope: "key", reason: "bad_key", text: "Bad or revoked key", until: nextPacificMidnight(nowMs) }, move: "next_key" };
        case "too_large":
        case "broken_reply":
          return { pause: null, move: "next_model" };
        case "bad_request":
          return { pause: null, move: "stop" };
      }
  }
}

export type AiJobKey = { apiKey: string; keyHash: string };
export type AiJobSlot = { model: AiModel; key: AiJobKey; slotId: string };
export type AiJobState = {
  limits: AiLimits;
  pauses: AiSlotPauses;
  usage: Map<string, AiSlotUsage>;
  /** For each model, the keys already called in its current round. */
  rounds: Record<string, Set<string>>;
};

export type AiJobDeps<Claim, Result> = {
  keys: Record<AiProvider, AiJobKey[]>;
  deadlineAt: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  shuffle: <Item>(items: Item[]) => Item[];
  readState: () => Promise<AiJobState>;
  estimateTokens: (model: AiModel) => number;
  /** Takes the slot's lease and counts the call. Null when the slot turned out not to be free. */
  claim: (slot: AiJobSlot, tokens: number, state: AiJobState) => Promise<Claim | null>;
  release: (slot: AiJobSlot, claim: Claim) => Promise<void>;
  call: (slot: AiJobSlot, claim: Claim, timeoutMs: number) => Promise<AiOutcome>;
  savePauses: (pauses: AiSlotPauses) => Promise<void>;
  /** Turns the model's text into the answer. Throwing means the reply was unusable. */
  parse: (text: string) => Result;
};

const busyMessage = "Gemini and Groq are busy right now. Try again shortly.";
const quotaMessage = "Today's Gemini and Groq quota is used up. It resets at midnight Pacific.";

export async function runAiJob<Claim, Result>(deps: AiJobDeps<Claim, Result>): Promise<Result> {
  const models = aiModels.filter((model) => deps.keys[model.provider].length > 0);
  if (!models.length) throw new AiJobError("ai_not_configured", "No Gemini or Groq key is set up. Ask your Super Admin.");

  let state = await deps.readState();
  const tokensFor = new Map<string, number>(models.map((model) => [model.id, deps.estimateTokens(model)]));
  const tokens = (model: AiModel) => tokensFor.get(model.id) ?? 0;
  if (models.every((model) => aiRequestTooLarge(state.limits[model.id], tokens(model)))) {
    throw new AiJobError("ai_too_large", "This job page is too long for the AI models. Nothing was saved.");
  }

  const slotOf = (model: AiModel, key: AiJobKey): AiJobSlot => ({ model, key, slotId: aiSlotId(key.keyHash, model.id) });
  const blockOf = (slot: AiJobSlot, nowMs: number) => aiSlotBlock(
    state.limits[slot.model.id],
    state.usage.get(slot.slotId) ?? emptyAiSlotUsage,
    state.pauses[slot.slotId],
    tokens(slot.model),
    nowMs,
  );
  const modelsOf = (provider: AiProvider) => models.filter((model) => model.provider === provider);

  /** Google's turn ends early enough to leave Groq one full try. */
  const timeForTry = (provider: AiProvider): number => {
    const reserved = provider === "gemini" && deps.keys.groq.length ? aiTryTimeoutMs : 0;
    const left = deps.deadlineAt - deps.now() - reserved;
    return left < minimumTryMs ? 0 : Math.min(aiTryTimeoutMs, left);
  };

  async function claimSlot(slot: AiJobSlot): Promise<{ slot: AiJobSlot; claim: Claim } | null> {
    const claim = await deps.claim(slot, tokens(slot.model), state);
    return claim === null ? null : { slot, claim };
  }

  /** The best model with a free slot, on the next key in that model's rotation. */
  async function claimBest(provider: AiProvider, triedKeys: Set<string>) {
    for (const model of modelsOf(provider)) {
      const called = state.rounds[model.id] ?? new Set<string>();
      const free = deps.keys[provider].filter((key) => !triedKeys.has(key.keyHash) && blockOf(slotOf(model, key), deps.now()) === null);
      for (const key of keysNotCalledFirst(deps.shuffle(free), (entry) => called.has(entry.keyHash))) {
        const claimed = await claimSlot(slotOf(model, key));
        if (claimed) return claimed;
      }
    }
    return null;
  }

  async function savePause(slot: AiJobSlot, decision: AiFailureDecision, nowMs: number): Promise<void> {
    if (!decision.pause) return;
    const { scope, reason, text, until } = decision.pause;
    const entry: AiSlotPause = { until: new Date(until).toISOString(), reason, text, at: new Date(nowMs).toISOString() };
    const slots = scope === "key" ? modelsOf(slot.model.provider).map((model) => slotOf(model, slot.key)) : [slot];
    const added: AiSlotPauses = Object.fromEntries(slots.map((target) => [target.slotId, entry]));
    state = { ...state, pauses: { ...state.pauses, ...added } };
    await deps.savePauses(added);
  }

  /** One call on a claimed slot: the answer, or where the job should go next. */
  async function attempt(slot: AiJobSlot, claim: Claim, timeoutMs: number): Promise<{ value: Result } | { move: AiFailureDecision["move"] }> {
    let outcome: AiOutcome;
    try {
      outcome = await deps.call(slot, claim, timeoutMs);
    } finally {
      await deps.release(slot, claim);
    }
    if (outcome.kind === "worked") {
      try {
        return { value: deps.parse(outcome.text) };
      } catch {
        return { move: "next_model" };
      }
    }
    const nowMs = deps.now();
    const decision = decideAiFailure(outcome, nowMs);
    await savePause(slot, decision, nowMs);
    if (decision.move === "stop") {
      throw new AiJobError("ai_bad_request", outcome.detail ? `The AI model refused this request: ${outcome.detail}` : "The AI model refused this request.");
    }
    return { move: decision.move };
  }

  /** One pass over the provider: up to two keys, each trying its models in order. */
  async function runProvider(provider: AiProvider): Promise<{ value: Result } | { calls: number }> {
    const triedKeys = new Set<string>();
    let calls = 0;
    for (let keyTurn = 0; keyTurn < maxKeysPerProvider; keyTurn += 1) {
      if (keyTurn > 0) state = mergeLocalPauses(await deps.readState(), state);
      if (timeForTry(provider) === 0) break;
      let current = await claimBest(provider, triedKeys);
      if (!current) break;
      triedKeys.add(current.slot.key.keyHash);

      while (current) {
        calls += 1;
        const result = await attempt(current.slot, current.claim, timeForTry(provider) || minimumTryMs);
        if ("value" in result) return result;
        if (result.move === "next_key") break;
        const failed: AiJobSlot = current.slot;
        const position: number = modelsOf(provider).findIndex((model) => model.id === failed.model.id);
        const nextModel: AiModel | undefined = modelsOf(provider)[position + 1];
        if (!nextModel || timeForTry(provider) === 0) break;
        const sameKey = slotOf(nextModel, failed.key);
        current = blockOf(sameKey, deps.now()) === null ? await claimSlot(sameKey) : null;
      }
    }
    return { calls };
  }

  const stopWaitingAt = deps.now() + noSlotWaitMs;
  for (;;) {
    const gemini = await runProvider("gemini");
    if ("value" in gemini) return gemini.value;
    const groq = await runProvider("groq");
    if ("value" in groq) return groq.value;
    if (gemini.calls + groq.calls > 0) throw new AiJobError("ai_busy", busyMessage);

    const nowMs = deps.now();
    const allSlots = models.flatMap((model) => deps.keys[model.provider].map((key) => slotOf(model, key)));
    const usable = allSlots.filter((slot) => blockOf(slot, nowMs) !== "too_large");
    if (usable.length && usable.every((slot) => aiSlotIsOutForTheDay(blockOf(slot, nowMs), state.pauses[slot.slotId]))) {
      throw new AiJobError("ai_quota_used_up", quotaMessage, nextPacificMidnight(nowMs));
    }
    if (nowMs + noSlotPollMs >= stopWaitingAt || nowMs + noSlotPollMs + aiTryTimeoutMs >= deps.deadlineAt) {
      throw new AiJobError("ai_busy", busyMessage);
    }
    await deps.sleep(noSlotPollMs);
    state = mergeLocalPauses(await deps.readState(), state);
  }
}

/** A fresh read, keeping this job's own pauses in case its write hasn't been read back yet. */
function mergeLocalPauses(fresh: AiJobState, previous: AiJobState): AiJobState {
  return { ...fresh, pauses: { ...previous.pauses, ...fresh.pauses } };
}
