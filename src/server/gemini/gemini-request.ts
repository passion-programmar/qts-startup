export const geminiModel = "gemini-3.5-flash-lite";

// Calibrated against production Gemini 3.5 Flash-Lite CountTokens samples.
// Prose averaged substantially more than Google's broad four-character rule.
const asciiCharactersPerToken = 6.5;
const wordsPerToken = 0.75;
const nonAsciiTokensPerCharacter = 1;
const estimationSafetyMultiplier = 1.15;
const requestOverheadTokens = 16;

/**
 * Estimates Gemini input usage locally for capacity limiting.
 *
 * We take the larger calibrated character or word estimate, count non-ASCII
 * code points conservatively, add the response configuration because schemas
 * also consume input context, and reserve enough headroom to target roughly
 * twenty percent above observed Google counts. This is intentionally an
 * estimate; the provider tokenizer remains the only source of an exact count.
 */
export function estimateGeminiInputTokens(
  prompt: string,
  generationConfig: Record<string, unknown>,
): number {
  const modelInput = `${prompt}\n${JSON.stringify(generationConfig)}`;
  let asciiCharacters = 0;
  let nonAsciiCharacters = 0;

  for (const character of modelInput) {
    if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
    else nonAsciiCharacters += 1;
  }

  const characterEstimate = Math.ceil(
    asciiCharacters / asciiCharactersPerToken +
      nonAsciiCharacters * nonAsciiTokensPerCharacter,
  );
  const wordCount = modelInput.match(/\S+/gu)?.length ?? 0;
  const wordEstimate = Math.ceil(wordCount / wordsPerToken);
  const baseEstimate = Math.max(characterEstimate, wordEstimate);

  return Math.max(
    1,
    Math.ceil(baseEstimate * estimationSafetyMultiplier) + requestOverheadTokens,
  );
}
