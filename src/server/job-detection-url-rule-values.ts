export function normalizeJobDetectionUrlRule(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 2048 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}
