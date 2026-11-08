import "server-only";

import { runAiRequest } from "@/server/gemini/ai-request";
import type { GeminiContent } from "@/server/gemini/gemini-keys";

// Apply's answers in Gemini mode: the same prompt the extension would type into ChatGPT, sent by
// the server through the shared key and model rules. A follow-up for rejected answers carries the
// earlier turns, like ChatGPT's same chat.

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

/** The model's reply text (the answers JSON) for the turns. Throws an AiJobError when it can't answer. */
export function askGeminiForApplyAnswers(turns: ApplyGeminiTurn[]): Promise<string> {
  const contents: GeminiContent[] = turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
  return runAiRequest({
    contents,
    generationConfig,
    parse: (text) => {
      if (!text || Buffer.byteLength(text, "utf8") > MAX_REPLY_BYTES) throw new Error("The answer was empty or too large.");
      return text;
    },
  });
}
