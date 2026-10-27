const assert = require('node:assert/strict');
const test = require('node:test');
const pacing = require('./idle-pacing.js');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const now = Date.parse('2026-10-27T12:00:00Z');

test('an idle Chrome checks less and less often, never less than every 2 minutes', () => {
  assert.equal(pacing.checkEveryMs(0), 30 * SECOND);
  assert.equal(pacing.checkEveryMs(90 * SECOND), 30 * SECOND);
  assert.equal(pacing.checkEveryMs(2 * MINUTE), MINUTE);
  assert.equal(pacing.checkEveryMs(10 * MINUTE), 2 * MINUTE);
  assert.equal(pacing.checkEveryMs(5 * 60 * MINUTE), 2 * MINUTE);
});

test('a check is due by idle time, always while busy, and at the first tick', () => {
  const idleHour = now - 60 * MINUTE;
  // Every 2 minutes after an hour idle: a 30-second tick is not enough, a 2-minute one is.
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: now - 30 * SECOND, busy: false }), false);
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: now - 2 * MINUTE, busy: false }), true);
  // An alarm a little early still counts.
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: now - 2 * MINUTE + 3 * SECOND, busy: false }), true);
  // Just active: every 30 seconds.
  assert.equal(pacing.isDue({ now, activityAt: now - 10 * SECOND, checkedAt: now - 30 * SECOND, busy: false }), true);
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: now - 5 * SECOND, busy: true }), true);
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: 0, busy: false }), true);
});

test('modes turn off after two idle hours, never while work runs', () => {
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 119 * MINUTE, busy: false }), false);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 120 * MINUTE, busy: false }), true);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 5 * 60 * MINUTE, busy: true }), false);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: 0, busy: false }), false);
});

test('a held application is renewed four times per hold, at least every 30 seconds otherwise', () => {
  // Waiting for the Manager's review: the server holds it 10 minutes.
  assert.equal(pacing.renewEveryMs(600), 150 * SECOND);
  // Filling, or a wait the server holds only 2 minutes (a CAPTCHA): as before.
  assert.equal(pacing.renewEveryMs(120), 30 * SECOND);
  // An older server that does not say.
  assert.equal(pacing.renewEveryMs(undefined), 30 * SECOND);
  assert.equal(pacing.renewEveryMs('x'), 30 * SECOND);
});

test('stored pacing: activity resets the back-off, and each kind is paced on its own', async () => {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (values) => Object.assign(store, values),
      },
    },
  };
  try {
    const start = now;
    // First ticks: due, and activity starts counting from now.
    assert.equal(await pacing.claimCheck('heartbeat', false, start), true);
    assert.equal(await pacing.claimCheck('apply', false, start), true);
    assert.equal(await pacing.claimCheck('heartbeat', false, start + 30 * SECOND), true);
    // An hour later with no activity: one check per 2 minutes.
    const later = start + 60 * MINUTE;
    assert.equal(await pacing.claimCheck('heartbeat', false, later), true);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 30 * SECOND), false);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 2 * MINUTE), true);
    // Activity: back to every 30 seconds.
    await pacing.noteActivity(later + 11 * MINUTE);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 11 * MINUTE), true);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 11 * MINUTE + 30 * SECOND), true);
    assert.equal(await pacing.idleTooLong(false, later + 11 * MINUTE + 119 * MINUTE), false);
    assert.equal(await pacing.idleTooLong(false, later + 11 * MINUTE + 120 * MINUTE), true);
  } finally {
    delete global.chrome;
  }
});
