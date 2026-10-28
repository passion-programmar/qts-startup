/** No Gemini key is called more than this many times in any minute (every call counts). */
export const maxGeminiRequestsPerMinute = 2;

export const defaultGeminiApiLimits = {
  requestsPerMinute: maxGeminiRequestsPerMinute,
  requestsPerDay: 200,
  inputTokensPerMinute: 25_000,
} as const;

export type GeminiApiLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
  inputTokensPerMinute: number;
};

const maximumGeminiApiLimits: GeminiApiLimits = {
  requestsPerMinute: 1_000,
  requestsPerDay: 100_000,
  inputTokensPerMinute: 10_000_000,
};

export function parseGeminiApiLimits(value: unknown): GeminiApiLimits | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const requestsPerMinute = parsePositiveInteger(
    record.requestsPerMinute,
    maximumGeminiApiLimits.requestsPerMinute,
  );
  const requestsPerDay = parsePositiveInteger(
    record.requestsPerDay,
    maximumGeminiApiLimits.requestsPerDay,
  );
  const inputTokensPerMinute = parsePositiveInteger(
    record.inputTokensPerMinute,
    maximumGeminiApiLimits.inputTokensPerMinute,
  );
  if (
    requestsPerMinute === null ||
    requestsPerDay === null ||
    inputTokensPerMinute === null
  ) {
    return null;
  }
  return { requestsPerMinute, requestsPerDay, inputTokensPerMinute };
}

function parsePositiveInteger(value: unknown, maximum: number): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^\d+$/.test(value))
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : null;
}
