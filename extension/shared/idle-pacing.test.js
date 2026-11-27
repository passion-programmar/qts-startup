const assert = require('node:assert/strict');
const test = require('node:test');
const pacing = require('./idle-pacing.js');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const now = Date.parse('2026-10-27T12:00:00Z');

/** A chrome.* stand-in: session storage, alarms, and the PC's presence ('active', 'idle' or 'locked'). */
function fakeChrome({ presence = null } = {}) {
  const store = {};
  const alarms = new Map();
  const created = [];
  // Session storage: local storage would send every check to every open tab's page scripts.
  const notLocal = async () => { throw new Error('Idle pacing must not use local storage.'); };
  const chrome = {
    storage: {
      session: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (values) => Object.assign(store, values),
      },
      local: { get: notLocal, set: notLocal },
    },
    alarms: {
      get: async (name) => alarms.get(name),
      create: async (name, info) => { created.push([name, info]); alarms.set(name, { name, ...info }); },
    },
  };
  if (presence) {
    chrome.idle = {
      queryState: async (seconds) => {
        assert.equal(seconds, pacing.AWAY_AFTER_SECONDS);
        return presence.state;
      },
    };
  }
  return { chrome, alarms, created };
}

test('an idle Chrome checks less and less often, never less than every 2 minutes', () => {
  assert.equal(pacing.checkEveryMs(0), 30 * SECOND);
  assert.equal(pacing.checkEveryMs(90 * SECOND), 30 * SECOND);
  assert.equal(pacing.checkEveryMs(2 * MINUTE), MINUTE);
  assert.equal(pacing.checkEveryMs(10 * MINUTE), 2 * MINUTE);
  assert.equal(pacing.checkEveryMs(5 * 60 * MINUTE), 2 * MINUTE);
});

test('a check is due by idle time, always while busy, never while away, and at the first tick', () => {
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
  // Away from the PC: no check at all, however long ago the last one was; work running here goes on.
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: now - 60 * MINUTE, busy: false, away: true }), false);
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: 0, busy: false, away: true }), false);
  assert.equal(pacing.isDue({ now, activityAt: idleHour, checkedAt: now - 5 * SECOND, busy: true, away: true }), true);
});

test('modes turn off after an idle hour at the PC or 2 hours away, never while work runs', () => {
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 59 * MINUTE, busy: false }), false);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 60 * MINUTE, busy: false }), true);
  // Away (a lunch break): still on after an hour, off after two.
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 90 * MINUTE, busy: false, away: true }), false);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 120 * MINUTE, busy: false, away: true }), true);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 5 * 60 * MINUTE, busy: true }), false);
  assert.equal(pacing.shouldTurnOff({ now, activityAt: now - 5 * 60 * MINUTE, busy: true, away: true }), false);
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
  global.chrome = fakeChrome().chrome;
  try {
    const start = now;
    // First ticks: due, and activity starts counting from now.
    assert.equal(await pacing.claimCheck('heartbeat', false, start), true);
    assert.equal(await pacing.claimCheck('apply', false, start), true);
    assert.equal(await pacing.claimCheck('heartbeat', false, start + 30 * SECOND), true);
    // Half an hour later with no activity: one check per 2 minutes.
    const later = start + 30 * MINUTE;
    assert.equal(await pacing.claimCheck('heartbeat', false, later), true);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 30 * SECOND), false);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 2 * MINUTE), true);
    // A heartbeat sent outside the alarm (the Manager opened QTS) counts as that check.
    await pacing.noteCheck('heartbeat', later + 3 * MINUTE);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 4 * MINUTE), false);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 5 * MINUTE), true);
    // Activity: back to every 30 seconds.
    await pacing.noteActivity(later + 11 * MINUTE);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 11 * MINUTE), true);
    assert.equal(await pacing.claimCheck('heartbeat', false, later + 11 * MINUTE + 30 * SECOND), true);
    assert.equal(await pacing.idleTooLong(false, later + 11 * MINUTE + 59 * MINUTE), false);
    assert.equal(await pacing.idleTooLong(false, later + 11 * MINUTE + 60 * MINUTE), true);
  } finally {
    delete global.chrome;
  }
});

test('away from the PC: no checks, a slow alarm, and the modes stay on through a lunch break', async () => {
  const presence = { state: 'active' };
  const fake = fakeChrome({ presence });
  global.chrome = fake.chrome;
  try {
    fake.alarms.set('qts-browser-heartbeat', { name: 'qts-browser-heartbeat', periodInMinutes: 0.5 });
    await pacing.noteActivity(now);
    assert.equal(await pacing.claimCheck('heartbeat', false, now), true);
    // No keyboard or mouse for 10 minutes (or the screen locked): nothing is due, not even the first time.
    presence.state = 'idle';
    assert.equal(await pacing.claimCheck('heartbeat', false, now + 15 * MINUTE), false);
    assert.equal(await pacing.claimCheck('generation', false, now + 15 * MINUTE), false);
    presence.state = 'locked';
    assert.equal(await pacing.claimCheck('apply', false, now + 16 * MINUTE), false);
    // Work running here goes on while away.
    assert.equal(await pacing.claimCheck('apply', true, now + 16 * MINUTE), true);
    // The alarm only wakes the worker every 10 minutes (to turn the modes off in time).
    assert.equal(await pacing.checkIntervalMs(false, now + 16 * MINUTE), 10 * MINUTE);
    assert.equal(await pacing.checkIntervalMs(true, now + 16 * MINUTE), 30 * SECOND);
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 16 * MINUTE);
    assert.deepEqual(fake.created.at(-1), ['qts-browser-heartbeat', { delayInMinutes: 10, periodInMinutes: 10 }]);
    // A lunch break: still on after 90 minutes away, off after 2 hours.
    assert.equal(await pacing.idleTooLong(false, now + 90 * MINUTE), false);
    assert.equal(await pacing.idleTooLong(false, now + 120 * MINUTE), true);
    // Back at the PC: due at once, and the alarm follows the idle steps again.
    presence.state = 'active';
    assert.equal(await pacing.claimCheck('heartbeat', false, now + 90 * MINUTE), true);
    await pacing.pacePeriodicAlarm('qts-browser-heartbeat', false, now + 90 * MINUTE);
    assert.deepEqual(fake.created.at(-1), ['qts-browser-heartbeat', { delayInMinutes: 2, periodInMinutes: 2 }]);
    // At the PC, an hour with nothing to do turns the modes off.
    assert.equal(await pacing.idleTooLong(false, now + 60 * MINUTE), true);
  } finally {
    delete global.chrome;
  }
});

test('a paced alarm ticks only as often as its check is due, and activity brings it back to 30 seconds', async () => {
  const fake = fakeChrome();
  const { alarms, created } = fake;
  global.chrome = fake.chrome;
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
