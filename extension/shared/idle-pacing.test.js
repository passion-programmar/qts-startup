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
  // Session storage: local storage would send every check to every open tab's page scripts.
  const notLocal = async () => { throw new Error('Idle pacing must not use local storage.'); };
  global.chrome = {
    storage: {
      session: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (values) => Object.assign(store, values),
      },
      local: { get: notLocal, set: notLocal },
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

test('a paced alarm ticks only as often as its check is due, and activity brings it back to 30 seconds', async () => {
  const store = {};
  const alarms = new Map();
  const created = [];
  global.chrome = {
    storage: {
      session: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (values) => Object.assign(store, values),
      },
    },
    alarms: {
      get: async (name) => alarms.get(name),
      create: async (name, info) => { created.push([name, info]); alarms.set(name, { name, ...info }); },
    },
  };
  try {
    // A mode that is off has no alarm: pacing never turns it on.
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now);
    assert.deepEqual(created, []);

    alarms.set('qts-browser-heartbeat', { name: 'qts-browser-heartbeat', periodInMinutes: 0.5 });
    await pacing.noteActivity(now);
    // Just active: every 30 seconds, nothing to change.
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 30 * SECOND);
    assert.deepEqual(created, []);
    // Idle 3 minutes: every minute; idle 10 minutes: every 2 minutes.
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 3 * MINUTE);
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 10 * MINUTE);
    assert.deepEqual(created, [
      ['qts-browser-heartbeat', { delayInMinutes: 1, periodInMinutes: 1 }],
      ['qts-browser-heartbeat', { delayInMinutes: 2, periodInMinutes: 2 }],
    ]);
    // Still idle: the 2-minute alarm is left as it is.
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 30 * MINUTE);
    assert.equal(created.length, 2);
    // Busy (a job or a review running), or activity: back to every 30 seconds.
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', true, now + 31 * MINUTE);
    assert.deepEqual(created[2], ['qts-browser-heartbeat', { delayInMinutes: 0.5, periodInMinutes: 0.5 }]);
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 40 * MINUTE);
    await pacing.noteActivity(now + 41 * MINUTE);
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 41 * MINUTE);
    assert.deepEqual(created.slice(3), [
      ['qts-browser-heartbeat', { delayInMinutes: 2, periodInMinutes: 2 }],
      ['qts-browser-heartbeat', { delayInMinutes: 0.5, periodInMinutes: 0.5 }],
    ]);
    // Each tick of a paced alarm finds its check due (the slack covers an alarm firing on time).
    assert.equal(pacing.isDue({ now: now + 12 * MINUTE, activityAt: now, checkedAt: now + 10 * MINUTE, busy: false }), true);
  } finally {
    delete global.chrome;
  }
});
