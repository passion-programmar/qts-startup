import "server-only";

import { randomInt } from "node:crypto";
import {
  acquireAiSlot,
  getGeminiApiKeyHash,
  getGeminiApiKeys,
  getGroqApiKeys,
  releaseAiSlot,
  reserveAiSlot,
} from "@/lib/gemini-usage";
import { callAiModel } from "@/server/gemini/ai-call";
import { aiRequestBudgetMs, runAiJob, type AiJobKey, type AiJobSlot, type AiJobState } from "@/server/gemini/ai-job";
import { aiModels, aiSlotId } from "@/server/gemini/ai-models";
import { estimateGroqInputTokens } from "@/server/gemini/ai-reply";
import { markAiSlotCalled, readAiJobState, saveAiSlotPauses } from "@/server/gemini/ai-store";
import { estimateGeminiInputTokens } from "@/server/gemini/gemini-request";
import { requestGeminiTokenCount, type GeminiContent, type GeminiTokenCounts } from "@/server/gemini/gemini-keys";
import { getGeminiTokenCountMode } from "@/server/gemini/token-count-mode";

// Shared by Get JD and Apply's AI answers: runs one request through the key + model rules in
// ai-job.ts, using the real database and providers.

export type AiRequest<Result> = {
  contents: GeminiContent[];
  generationConfig: Record<string, unknown>;
  jsonHint?: string;
  /** Turns the model's text into the answer. Throwing means the reply was unusable. */
  parse: (text: string) => Result;
  /** When the whole request must be finished by. Defaults to the full time budget from now. */
  deadlineAt?: number;
};

type Claim = { leaseId: string; tokenCounts: GeminiTokenCounts };

function shuffled<Item>(items: Item[]): Item[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

const asKeys = (apiKeys: string[]): AiJobKey[] => apiKeys.map((apiKey) => ({ apiKey, keyHash: getGeminiApiKeyHash(apiKey) }));

export async function runAiRequest<Result>(request: AiRequest<Result>): Promise<Result> {
  const keys = { gemini: asKeys(getGeminiApiKeys()), groq: asKeys(getGroqApiKeys()) };
  const keyHashes = [...keys.gemini, ...keys.groq].map((key) => key.keyHash);
  const slotIds = aiModels.flatMap((model) => keys[model.provider].map((key) => aiSlotId(key.keyHash, model.id)));
  const promptText = request.contents.flatMap((content) => content.parts.map((part) => part.text)).join("\n\n");
  const tokenCountMode = await getGeminiTokenCountMode();

  return runAiJob<Claim, Result>({
    keys,
    deadlineAt: request.deadlineAt ?? Date.now() + aiRequestBudgetMs,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shuffle: shuffled,
    readState: () => readAiJobState(keyHashes, slotIds),
    estimateTokens: (model) => model.provider === "groq"
      ? estimateGroqInputTokens(request.contents, request.jsonHint)
      : estimateGeminiInputTokens(promptText, request.generationConfig),
    claim: async (slot: AiJobSlot, tokens: number, state: AiJobState) => {
      const limits = state.limits[slot.model.id];
      const leaseId = await acquireAiSlot(slot.slotId, limits);
      if (!leaseId) return null;
      try {
        const tokenCounts: GeminiTokenCounts = {
          local: tokens,
          gemini: tokenCountMode === "gemini" && slot.model.provider === "gemini"
            ? await requestGeminiTokenCount(slot.key.apiKey, slot.model.id, slot.slotId, request.contents, request.generationConfig)
            : null,
        };
        if (await reserveAiSlot(slot.slotId, leaseId, tokenCounts.gemini ?? tokenCounts.local, limits)) {
          await markAiSlotCalled(slot.model.id, slot.key.keyHash, keys[slot.model.provider].map((key) => key.keyHash));
          return { leaseId, tokenCounts };
        }
      } catch (error) {
        console.warn("Could not reserve an AI slot.", error instanceof Error ? error.name : "Unknown error");
      }
      await releaseAiSlot(slot.slotId, leaseId);
      return null;
    },
    release: (slot, claim) => releaseAiSlot(slot.slotId, claim.leaseId),
    call: (slot, claim, timeoutMs) => callAiModel(
      { provider: slot.model.provider, modelId: slot.model.id, apiKey: slot.key.apiKey, slotId: slot.slotId },
      {
        contents: request.contents,
        generationConfig: request.generationConfig,
        jsonHint: request.jsonHint,
        timeoutMs,
        tokenCounts: claim.tokenCounts,
      },
    ),
    savePauses: saveAiSlotPauses,
    parse: request.parse,
  });
}
