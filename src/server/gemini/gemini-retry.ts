// Gemini overload errors (5xx, for example 503 "model is experiencing high demand")
// usually clear within seconds, so a request is retried once after a short pause.
// Quota (429) and key or request errors (other 4xx) are not retried: retrying
// would not help and would spend the key's per-minute request limit.

export const GEMINI_RETRY_DELAY_MS = 2000;

export function isRetryableGeminiStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withGeminiRetry<T extends { ok: boolean; status: number }>(
  request: () => Promise<T>,
  options: {
    wait?: (ms: number) => Promise<void>;
    /** Runs right before the retry, for example to count it against the key's limits. */
    beforeRetry?: () => Promise<void>;
  } = {},
): Promise<T> {
  const first = await request();
  if (first.ok || !isRetryableGeminiStatus(first.status)) return first;
  await (options.wait ?? pause)(GEMINI_RETRY_DELAY_MS);
  await options.beforeRetry?.();
  return request();
}
