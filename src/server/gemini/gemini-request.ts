export const geminiModel = "gemini-3.5-flash-lite";

const asciiCharactersPerToken = 4;
const wordsPerToken = 0.75;
const nonAsciiTokensPerCharacter = 1;
const estimationSafetyMultiplier = 1.1;
const requestOverheadTokens = 16;

/**
 * Estimates Gemini input usage locally for capacity limiting.
 *
 * Google documents roughly four characters or 0.75 English words per token.
 * We take the larger estimate, count non-ASCII code points conservatively, add
 * the response configuration because schemas also consume input context, and
 * reserve a ten-percent safety margin. This is intentionally an estimate; the
 * provider tokenizer remains the only source of an exact token count.
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
