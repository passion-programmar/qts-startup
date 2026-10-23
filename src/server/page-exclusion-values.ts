export function normalizePageDetectionKeyword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (normalized.length < 2 || normalized.length > 200) {
    return null;
  }
  return normalized;
}
