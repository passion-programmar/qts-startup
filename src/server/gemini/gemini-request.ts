export const geminiModel = "gemini-3.5-flash-lite";

export function buildGeminiCountTokensRequest(
  prompt: string,
  generationConfig: Record<string, unknown>,
): object {
  return {
    generateContentRequest: {
      model: `models/${geminiModel}`,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    },
  };
}
