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

  // ---- This Chrome's activity and last checks, kept in session storage so a restarted worker
  // remembers. Only the worker reads them; unlike local storage, session storage is not sent to
  // every open tab's page scripts on each write (a check every 30 seconds while a mode is on, and
  // activity on every page Get JD reads). A Chrome restart starts the pacing afresh. ----
  const area = () => global.chrome.storage.session;
  const KINDS = ['heartbeat', 'generation', 'apply'];
  // Where versions before the move kept them; removed once after an update.
  const LEGACY_LOCAL_KEYS = Object.freeze([ACTIVITY_KEY, ...KINDS.map((kind) => CHECKED_KEY_PREFIX + kind)]);

  async function activityAt(now) {
    const stored = await area().get(ACTIVITY_KEY);
    const at = Number(stored[ACTIVITY_KEY]) || 0;
    if (at) return at;
    // Never seen: idle from now, not since 1970.
    await area().set({ [ACTIVITY_KEY]: now });
    return now;
  }

  async function noteActivity(now = Date.now()) {
    await area().set({ [ACTIVITY_KEY]: now });
  }

  /** True when a check of this kind should run now, and records it; each kind is paced on its own. */
  async function claimCheck(kind, busy, now = Date.now()) {
    const key = CHECKED_KEY_PREFIX + kind;
    const stored = await area().get(key);
    if (!isDue({ now, activityAt: await activityAt(now), checkedAt: Number(stored[key]) || 0, busy })) return false;
    await area().set({ [key]: now });
    return true;
  }

  async function idleTooLong(busy, now = Date.now()) {
    return shouldTurnOff({ now, activityAt: await activityAt(now), busy });
  }

  /** How often a check is due right now: every 30 seconds while busy, otherwise by idle time. */
  async function checkIntervalMs(busy, now = Date.now()) {
    if (busy) return STEPS[0].everyMs;
    return checkEveryMs(Math.max(0, now - await activityAt(now)));
  }

  /**
   * A heartbeat or queue alarm ticks as often as its check is due, so an idle Chrome is not woken
   * every 30 seconds only to skip the check (each wake-up starts the whole worker). Called after
   * each tick and on activity, which brings it back to every 30 seconds. An alarm that is off (its
   * mode is off) stays off.
   */
  async function pacePeriodicAlarm(name, busy, now = Date.now()) {
    const alarm = await global.chrome.alarms.get(name);
    if (!alarm) return;
    const minutes = (await checkIntervalMs(busy, now)) / MINUTE;
    if (alarm.periodInMinutes === minutes) return;
    await global.chrome.alarms.create(name, { delayInMinutes: minutes, periodInMinutes: minutes });
  }

  const api = {
    checkEveryMs, isDue, shouldTurnOff, renewEveryMs, noteActivity, claimCheck, idleTooLong, checkIntervalMs, pacePeriodicAlarm,
    TURN_OFF_AFTER_MS, LEGACY_LOCAL_KEYS, ACTIVITY_KEY,
  };
  global.__qtsIdlePacing = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
