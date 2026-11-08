// Get JD's automatic retries: when the AI providers are busy, a job waits and tries again by itself
// instead of asking the Manager to press Try again. Loaded by the service worker and by its tests.
(function initGetJdAutoRetry(root) {
  const DELAYS_MS = [30_000, 60_000, 120_000];
  const REPEAT_DELAY_MS = 300_000;
  const AFTER_RESET_MS = 60_000;
  const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
  // api-worker's messages when the request never got an HTTP reply.
  const NO_REPLY_MESSAGES = new Set(['Cannot connect to the server.', 'The QTS server did not answer in time.']);
  // Retrying can't fix these, so the page shows the server's reason with no button.
  const FINAL_CODES = new Set(['ai_too_large', 'ai_bad_request']);

  const WAITING_MESSAGE = 'Waiting for Gemini, retrying automatically.';
  const QUOTA_MESSAGE = "Today's quota is used up. QTS will retry after midnight Pacific.";

  /** 30 s, 1 min, 2 min, then every 5 min. */
  function delayForAttempt(attempt) {
    return DELAYS_MS[attempt] ?? REPEAT_DELAY_MS;
  }

  /** When to try again and what to say meanwhile, or null when a retry can't help. */
  function planRetry(result, attempt, nowMs) {
    if (!result || result.success === true || result._sessionExpired) return null;
    if (FINAL_CODES.has(result.diagnosticCode)) return null;
    const hint = result.autoRetry;
    if (hint?.kind === 'at' && Number(hint.at) > nowMs) {
      return { at: Number(hint.at) + AFTER_RESET_MS, message: QUOTA_MESSAGE };
    }
    const noReply = result._httpStatus === undefined && NO_REPLY_MESSAGES.has(result.message);
    if (hint?.kind === 'soon' || RETRYABLE_STATUSES.has(result._httpStatus) || noReply) {
      return { at: nowMs + delayForAttempt(attempt), message: WAITING_MESSAGE };
    }
    return null;
  }

  /** True when the server's reason is all there is to say: retrying the same page can't help. */
  function isFinalFailure(result) {
    return FINAL_CODES.has(result?.diagnosticCode);
  }

  const api = { delayForAttempt, planRetry, isFinalFailure };
  root.__qtsGetJdAutoRetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
