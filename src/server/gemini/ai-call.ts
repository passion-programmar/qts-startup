import "server-only";

import { requestGeminiApi } from "@/lib/gemini-usage";
import type { AiProvider } from "@/server/gemini/ai-models";
import {
  buildGroqChatBody,
  classifyAiNetworkError,
  classifyGeminiReply,
  classifyGroqReply,
  type AiOutcome,
} from "@/server/gemini/ai-reply";
import type { GeminiContent } from "@/server/gemini/gemini-keys";

// One call to one key + model slot, for live requests and the Model test alike.

export type AiCallTarget = { provider: AiProvider; modelId: string; apiKey: string; slotId: string };

export type AiCallRequest = {
  contents: GeminiContent[];
  generationConfig: Record<string, unknown>;
  /** Extra wording for Groq, which can't be given Gemini's response schema. */
  jsonHint?: string;
  timeoutMs: number;
  tokenCounts?: { local?: number | null; gemini?: number | null };
};

const groqChatUrl = "https://api.groq.com/openai/v1/chat/completions";
const providerFailureNames = new Set(["TimeoutError", "AbortError", "TypeError"]);

export async function callAiModel(target: AiCallTarget, request: AiCallRequest): Promise<AiOutcome> {
  const { provider, modelId, apiKey, slotId } = target;
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(request.timeoutMs);
  try {
    if (provider === "groq") {
      const temperature = typeof request.generationConfig.temperature === "number" ? request.generationConfig.temperature : 0.2;
      const response = await requestGeminiApi(
        apiKey,
        "generate_content",
        groqChatUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildGroqChatBody(modelId, request.contents, temperature, request.jsonHint)),
          signal,
          cache: "no-store",
        },
        request.tokenCounts,
        slotId,
      );
      return classifyGroqReply(response.status, response.body.replaceAll(apiKey, "[redacted]"), Date.now() - startedAt, response.retryAfter);
    }
    const response = await requestGeminiApi(
      apiKey,
      "generate_content",
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: request.contents, generationConfig: request.generationConfig }),
        signal,
        cache: "no-store",
      },
      request.tokenCounts,
      slotId,
    );
    return classifyGeminiReply(response.status, response.body.replaceAll(apiKey, "[redacted]"), Date.now() - startedAt);
  } catch (error) {
    // Only a failure reaching the provider counts against the slot. A database error is not its fault.
    if (error instanceof Error && providerFailureNames.has(error.name)) {
      return classifyAiNetworkError(error.name, Date.now() - startedAt);
    }
    throw error;
  }
}
