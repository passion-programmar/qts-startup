// Gemini overload errors (5xx, for example 503 "model is experiencing high demand"): the key that
// got one is paused for 5 minutes and the request goes to another free key, never the same key
// again. Quota (429) and key or request errors (other 4xx) are not retried: another try would not
// help and would spend the keys' per-minute requests.

/** A key Gemini answered "unavailable" (5xx) is left alone this long. */
export const GEMINI_UNAVAILABLE_PAUSE_MINUTES = 5;
/** At most this many keys are tried for one request, so a page waits seconds, not minutes. */
export const GEMINI_FAILOVER_KEYS = 3;

export function isRetryableGeminiStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/** An error thrown for a Gemini 5xx reply (code gemini_http_5xx). */
export function isGeminiUnavailableError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const status = /^gemini_http_(\d{3})$/.exec(code)?.[1];
  return Boolean(status) && isRetryableGeminiStatus(Number(status));
}

/**
 * Runs a request with a free key; when it fails with a Gemini 5xx, that key is paused and the
 * request runs again with another free key, up to GEMINI_FAILOVER_KEYS keys. Null when no key was
 * free at all; the last 5xx error when every key tried was unavailable. Each key is released
 * after its try (a paused key keeps its pause).
 */
export async function withGeminiKeyFailover<Key extends { apiKey: string }, T>(
  steps: {
    select: (excluded: Set<string>) => Promise<Key | null>;
    run: (key: Key) => Promise<T>;
    pause: (key: Key) => Promise<void>;
    release: (key: Key) => Promise<void>;
  },
): Promise<T | null> {
  const tried = new Set<string>();
  let lastError: unknown = null;
  while (tried.size < GEMINI_FAILOVER_KEYS) {
    const key = await steps.select(tried);
    if (!key) break;
    tried.add(key.apiKey);
    try {
      return await steps.run(key);
    } catch (error) {
      if (!isGeminiUnavailableError(error)) throw error;
      lastError = error;
      await steps.pause(key);
    } finally {
      await steps.release(key);
    }
  }
  if (lastError) throw lastError;
  return null;
}
