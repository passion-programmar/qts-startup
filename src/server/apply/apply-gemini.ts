import "server-only";

import { geminiModel, getGeminiApiKeys, getGeminiApiLimits, recordGeminiApiCall, releaseGeminiKey, requestGeminiApi } from "@/lib/gemini-usage";
import {
  type GeminiContent,
  geminiError,
  readGeminiErrorMessage,
  readGeminiText,
  selectAvailableGeminiApiKey,
} from "@/server/gemini/gemini-keys";
import { withGeminiRetry } from "@/server/gemini/gemini-retry";
import { getGeminiTokenCountMode } from "@/server/gemini/token-count-mode";

// Apply's answers in Gemini mode: the same prompt the extension would type into ChatGPT, sent by
// the server to Gemini with the shared key pool and limits (the Gemini usage page counts them).
// A follow-up for rejected answers carries the earlier turns, like ChatGPT's same chat.

const generationConfig = { responseMimeType: "application/json", temperature: 0.2 };
const MAX_TURNS = 3;
const MAX_TURN_LENGTH = 150_000;
const MAX_REPLY_BYTES = 200_000;

export type ApplyGeminiTurn = { role: "user" | "model"; text: string };

/** The turns as the extension sent them, checked; a string is why they are refused. */
export function parseApplyGeminiTurns(value: unknown): ApplyGeminiTurn[] | string {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TURNS) return "Send one to three prompt turns.";
  const turns: ApplyGeminiTurn[] = [];
  for (const entry of value) {
    const turn = entry as { role?: unknown; text?: unknown } | null;
    if (!turn || (turn.role !== "user" && turn.role !== "model") || typeof turn.text !== "string" || !turn.text.trim()) {
      return "Each turn needs a role (user or model) and its text.";
    }
    if (turn.text.length > MAX_TURN_LENGTH) return "A prompt turn is too long.";
    turns.push({ role: turn.role, text: turn.text });
  }
  if (turns[0].role !== "user" || turns[turns.length - 1].role !== "user") return "The turns must start and end with the question.";
  return turns;
}

/** Gemini's reply text (the answers JSON) for the turns. Throws a coded error when it cannot answer. */
export async function askGeminiForApplyAnswers(turns: ApplyGeminiTurn[]): Promise<string> {
  const apiKeys = getGeminiApiKeys();
  if (!apiKeys.length) throw geminiError("gemini_not_configured", "Gemini is not set up. Ask your Super Admin.");
  const contents: GeminiContent[] = turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
  const selected = await selectAvailableGeminiApiKey(apiKeys, contents, generationConfig, await getGeminiTokenCountMode(), await getGeminiApiLimits());
  if (!selected) {
    throw geminiError("gemini_local_capacity_unavailable", "Every Gemini key is busy or at its QTS limit. Try again shortly.");
  }
  const { apiKey, leaseId, tokenCounts } = selected;
  try {
    // One 60-second budget covers the first attempt and a possible retry.
    const signal = AbortSignal.timeout(60_000);
    const response = await withGeminiRetry(
      () => requestGeminiApi(
        apiKey,
        "generate_content",
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents, generationConfig }),
          signal,
          cache: "no-store",
        },
        tokenCounts,
      ),
      { beforeRetry: () => recordGeminiApiCall(apiKey, "generate_content") },
    );
    if (!response.ok) {
      throw geminiError(`gemini_http_${response.status}`, `Gemini returned HTTP ${response.status}.`, readGeminiErrorMessage(response.body, apiKey));
    }
    let data: unknown;
    try {
      data = JSON.parse(response.body) as unknown;
    } catch {
      throw geminiError("gemini_invalid_http_response", "Gemini returned an invalid response.");
    }
    const text = readGeminiText(data);
    if (!text || Buffer.byteLength(text, "utf8") > MAX_REPLY_BYTES) throw geminiError("gemini_empty_response", "Gemini's answer was empty or too large.");
    return text;
  } finally {
    await releaseGeminiKey(apiKey, leaseId);
  }
}
