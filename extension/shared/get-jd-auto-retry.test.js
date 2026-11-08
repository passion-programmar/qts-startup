const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const retry = require('./get-jd-auto-retry.js');

const source = fs.readFileSync(require.resolve('../background/service-worker.js'), 'utf8');
const now = 1_000_000;

test('retries come after 30 s, 1 min, 2 min, then every 5 min', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map(retry.delayForAttempt), [30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
});

test('a busy server retries by itself, on the schedule', () => {
  const plan = retry.planRetry({ success: false, autoRetry: { kind: 'soon' }, _httpStatus: 503 }, 1, now);
  assert.deepEqual(plan, { at: now + 60_000, message: 'Waiting for Gemini, retrying automatically.' });
});

test('a used-up quota waits until just after the reset time', () => {
  const at = now + 3_600_000;
  const plan = retry.planRetry({ success: false, autoRetry: { kind: 'at', at }, _httpStatus: 429 }, 0, now);
  assert.equal(plan.at, at + 60_000);
  assert.match(plan.message, /midnight Pacific/);
});

test('server errors and a lost connection also retry, even from an older server reply', () => {
  for (const result of [
    { success: false, _httpStatus: 502 },
    { success: false, _httpStatus: 429 },
    { success: false, message: 'Cannot connect to the server.' },
    { success: false, message: 'The QTS server did not answer in time.' },
  ]) {
    assert.ok(retry.planRetry(result, 0, now), JSON.stringify(result));
  }
});

test('what a retry cannot fix is not retried', () => {
  for (const result of [
    { success: true },
    { success: false, diagnosticCode: 'ai_too_large', _httpStatus: 413 },
    { success: false, diagnosticCode: 'ai_bad_request', _httpStatus: 422 },
    { success: false, _httpStatus: 401, _sessionExpired: true },
    { success: false, _httpStatus: 400 },
    { success: false, _httpStatus: 409 },
    { success: false, message: 'Not logged in.' },
  ]) {
    assert.equal(retry.planRetry(result, 0, now), null, JSON.stringify(result));
  }
  assert.equal(retry.isFinalFailure({ diagnosticCode: 'ai_too_large' }), true);
  assert.equal(retry.isFinalFailure({ diagnosticCode: 'ai_busy' }), false);
});

test('another Chrome checking the job waits and retries', () => {
  assert.ok(retry.planRetry({ success: false, _httpStatus: 409, autoRetry: { kind: 'soon' } }, 0, now));
});

function worker({ tab = { id: 7, url: 'https://jobs.example/1' }, active = true } = {}) {
  const session = {};
  const calls = { alarms: [], cleared: [], runs: [], saved: [], notices: [] };
  const context = {
    Date,
    Number,
    self: { __qtsGetJdAutoRetry: retry },
    chrome: {
      alarms: { create: async (...args) => calls.alarms.push(args), clear: async (name) => calls.cleared.push(name), onAlarm: { addListener() {} } },
      storage: { session: {
        get: async (key) => ({ [key]: session[key] }),
        set: async (values) => Object.assign(session, values),
        remove: async (key) => { delete session[key]; },
      } },
      tabs: { onRemoved: { addListener() {} } },
    },
    getTab: async () => tab,
    isGetJdActive: async () => active,
    saveGetJdResult: async (...args) => calls.saved.push(args),
    showGetJdNotice: async (...args) => calls.notices.push(args),
    processGetJdPage: async (...args) => calls.runs.push(args),
  };
  vm.createContext(context);
  const start = source.indexOf('const GET_JD_RETRY_ALARM =');
  const end = source.indexOf('// End of Get JD automatic retries.');
  assert.ok(start > 0 && end > start, 'the retry block is in the service worker');
  vm.runInContext(source.slice(start, end), context);
  return { context, calls, session };
}

const initial = { tabId: 7, pageUrl: 'https://jobs.example/1', runId: 'run', status: 'processing' };
// Objects made inside the worker's own context, compared by their contents.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('waiting saves the plan, sets an alarm, and shows the wait with no button', async () => {
  const f = worker();
  await f.context.waitForGetJdAutoRetry(7, initial.pageUrl, initial, { at: now + 30_000, message: 'Waiting' }, { attempt: 2, force: true });
  assert.deepEqual(plain(f.calls.alarms[0]), ['qtsGetJdRetry:7', { when: now + 30_000 }]);
  assert.deepEqual(plain(f.session['qtsGetJdRetry:7']), { url: initial.pageUrl, attempt: 2, force: true, runId: 'run' });
  assert.equal(f.calls.saved[0][1].status, 'processing');
  assert.equal(f.calls.saved[0][1].runId, 'run');
  assert.equal(f.calls.saved[0][1].message, 'Waiting');
  assert.deepEqual(plain(f.calls.notices[0].slice(0, 4)), [7, initial.pageUrl, 'Waiting', []]);
});

test('the alarm re-runs the same page as the next attempt', async () => {
  const f = worker();
  f.session['qtsGetJdRetry:7'] = { url: initial.pageUrl, attempt: 2, force: false, runId: 'run' };
  await f.context.runGetJdAutoRetry(7);
  assert.equal(f.calls.runs.length, 1);
  const [tabId, url, documentId, options] = f.calls.runs[0];
  assert.deepEqual([tabId, url], [7, initial.pageUrl]);
  assert.match(documentId, /^retry:/);
  assert.equal(options.autoRetryAttempt, 3);
  assert.equal(options.autoRetryRunId, 'run');
  assert.equal(options.force, false);
  assert.equal(f.session['qtsGetJdRetry:7'], undefined);
});

test('nothing runs if the tab closed, moved on, or Get JD was turned off', async () => {
  for (const setup of [{ tab: null }, { tab: { id: 7, url: 'https://jobs.example/other' } }, { active: false }]) {
    const f = worker(setup);
    f.session['qtsGetJdRetry:7'] = { url: initial.pageUrl, attempt: 0, force: false };
    await f.context.runGetJdAutoRetry(7);
    assert.equal(f.calls.runs.length, 0);
    assert.equal(f.session['qtsGetJdRetry:7'], undefined);
  }
});

test('an alarm with no saved plan does nothing', async () => {
  const f = worker();
  await f.context.runGetJdAutoRetry(7);
  assert.equal(f.calls.runs.length, 0);
});

test('cancelling clears the alarm and the plan', async () => {
  const f = worker();
  f.session['qtsGetJdRetry:7'] = { url: initial.pageUrl, attempt: 0, force: false };
  await f.context.cancelGetJdAutoRetry(7);
  assert.deepEqual(plain(f.calls.cleared), ['qtsGetJdRetry:7']);
  assert.equal(f.session['qtsGetJdRetry:7'], undefined);
});
