// When this Chrome has no work, it asks QTS less and less often, and after two quiet hours it turns
// its modes off: asking every 30 seconds all day spends the free Vercel and Neon allowances on empty
// answers, and each call wakes the database. Work, opening the extension, or Get JD on a page
// counts as activity and brings it back to every 30 seconds.
(function (global) {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  // Idle for at least `idleMs` → check every `everyMs`. A new job waits at most 2 minutes (the
  // Manager chose that over longer waits that would also let the database sleep between checks).
  const STEPS = [
    { idleMs: 0, everyMs: 30 * SECOND },
    { idleMs: 2 * MINUTE, everyMs: MINUTE },
    { idleMs: 5 * MINUTE, everyMs: 2 * MINUTE },
  ];
  const TURN_OFF_AFTER_MS = 2 * 60 * MINUTE;
  // Chrome's 30-second alarms fire a little early or late.
  const TICK_SLACK_MS = 5 * SECOND;
  const ACTIVITY_KEY = 'qtsIdleActivityAt';
  const CHECKED_KEY_PREFIX = 'qtsIdleCheckedAt.';

  function checkEveryMs(idleMs) {
    let every = STEPS[0].everyMs;
    for (const step of STEPS) if (idleMs >= step.idleMs) every = step.everyMs;
    return every;
  }

  /** Whether a check is due: always while busy or never checked, otherwise by how long this Chrome has been idle. */
  function isDue({ now, activityAt, checkedAt, busy }) {
    if (busy || !checkedAt) return true;
    const idleMs = Math.max(0, now - (activityAt || now));
    return now - checkedAt >= checkEveryMs(idleMs) - TICK_SLACK_MS;
  }

  function shouldTurnOff({ now, activityAt, busy }) {
    return !busy && Boolean(activityAt) && now - activityAt >= TURN_OFF_AFTER_MS;
  }

  /**
   * While Apply waits for the Manager, the server holds the application for `leaseSeconds`: it is
   * renewed four times per hold, and never less often than every 30 seconds when the hold is unknown.
   */
  function renewEveryMs(leaseSeconds) {
    const lease = Number(leaseSeconds);
    return Number.isFinite(lease) && lease > 0 ? Math.max(30 * SECOND, (lease * SECOND) / 4) : 30 * SECOND;
  }

  // ---- This Chrome's activity and last checks, kept in storage so a restarted worker remembers ----

  async function activityAt(now) {
    const stored = await global.chrome.storage.local.get(ACTIVITY_KEY);
    const at = Number(stored[ACTIVITY_KEY]) || 0;
    if (at) return at;
    // Never seen: idle from now, not since 1970.
    await global.chrome.storage.local.set({ [ACTIVITY_KEY]: now });
    return now;
  }

  async function noteActivity(now = Date.now()) {
    await global.chrome.storage.local.set({ [ACTIVITY_KEY]: now });
  }

  /** True when a check of this kind should run now, and records it; each kind is paced on its own. */
  async function claimCheck(kind, busy, now = Date.now()) {
    const key = CHECKED_KEY_PREFIX + kind;
    const stored = await global.chrome.storage.local.get(key);
    if (!isDue({ now, activityAt: await activityAt(now), checkedAt: Number(stored[key]) || 0, busy })) return false;
    await global.chrome.storage.local.set({ [key]: now });
    return true;
  }

  async function idleTooLong(busy, now = Date.now()) {
    return shouldTurnOff({ now, activityAt: await activityAt(now), busy });
  }

  const api = { checkEveryMs, isDue, shouldTurnOff, renewEveryMs, noteActivity, claimCheck, idleTooLong, TURN_OFF_AFTER_MS };
  global.__qtsIdlePacing = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
