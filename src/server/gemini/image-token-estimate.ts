// Local estimate of Gemini input tokens for one image, following Google's documented
// rule: an image with both sides at most 384 px counts as 258 tokens; a larger image
// is cut into 768 x 768 px tiles of 258 tokens each. The calibration form compares
// this with Google's CountTokens result.

export const GEMINI_IMAGE_TILE_TOKENS = 258;
const SMALL_IMAGE_MAX_SIDE = 384;
const TILE_SIDE = 768;

export function estimateGeminiImageTokens(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return GEMINI_IMAGE_TILE_TOKENS;
  }
  if (width <= SMALL_IMAGE_MAX_SIDE && height <= SMALL_IMAGE_MAX_SIDE) return GEMINI_IMAGE_TILE_TOKENS;
  return Math.ceil(width / TILE_SIDE) * Math.ceil(height / TILE_SIDE) * GEMINI_IMAGE_TILE_TOKENS;
}
