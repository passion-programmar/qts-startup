const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const notifications = require('./get-jd-notifications.js');
const source = fs.readFileSync(require.resolve('../background/service-worker.js'), 'utf8');

function fixture() {
  const calls = [];
  const stored = { authExpiresAt: Date.now() + 60000, qtsSessionUser: { id: 'manager', role: 'manager' } };
  const entry = { operationId: '4:run', tabId: 4, pageUrl: 'https://jobs.example/job/1', status: 'success' };
  stored.history = { ownerKey: notifications.sessionKey(stored), history: [entry] };
  const context = {
    URL, Date, self: { __qtsGetJdNotifications: notifications }, GET_JD_NOTIFICATION_STATE_KEY: 'history', GET_JD_RESULTS_KEY: 'results',
    chrome: { runtime: { id: 'fixture' }, storage: { local: { get: async () => structuredClone(stored) } },
      windows: { update: async (...args) => calls.push(['window', ...args]) },
      tabs: { update: async (...args) => calls.push(['focus', ...args]), create: async (...args) => calls.push(['create', ...args]) } },
    getTab: async () => ({ id: 4, windowId: 2, url: entry.pageUrl }),
    saveGetJdResult: async (...args) => calls.push(['save', ...args]),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function finishAbandonedGetJdResult('), source.indexOf('// Mirrors the server')), context);
  return { context, stored, entry, calls, sender: { id: 'fixture', frameId: 0, tab: { id: 8 } } };
}

test('history opening focuses the exact existing page and otherwise reopens only the recorded URL', async () => {
  for (const samePage of [true, false]) {
    const f = fixture();
    if (!samePage) f.context.getTab = async () => ({ id: 4, url: 'https://jobs.example/other' });
    assert.equal((await f.context.openGetJdHistoryResult('4:run', f.sender)).ok, true);
    assert.equal(f.calls[0][0], samePage ? 'window' : 'create');
    if (samePage) assert.equal(f.calls[1][0], 'focus');
    else assert.equal(f.calls[0][1].url, f.entry.pageUrl);
  }
});

test('history opening rejects missing, unsafe, processing, foreign-session and unauthorized results', async () => {
  for (const mutation of [
    (f) => { f.entry.pageUrl = 'file:///private.pdf'; },
    (f) => { f.entry.status = 'processing'; },
    (f) => { f.stored.history.ownerKey = 'another-manager'; },
    (f) => { f.stored.authExpiresAt = 0; },
    (f) => { f.stored.qtsSessionUser.role = 'candidate'; },
    (f) => { f.sender.frameId = 1; },
    (f) => { f.sender.id = 'other-extension'; },
    (f) => { f.entry.operationId = 'another'; },
    (f) => { f.context.getTab = async () => { f.stored.authExpiresAt = 0; return null; }; },
  ]) {
    const f = fixture(); mutation(f);
    assert.equal((await f.context.openGetJdHistoryResult('4:run', f.sender)).ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test('abandoned processing finalizes only the same run and Manager session', async () => {
  for (const status of ['processing', 'success', 'new-run', 'old-session']) {
    const f = fixture();
    const initial = { runId: 'run', sessionOwner: notifications.sessionKey(f.stored) };
    f.stored.results = { 4: { runId: status === 'new-run' ? 'new' : 'run', status: status === 'success' ? 'complete' : 'processing' } };
    if (status === 'old-session') initial.sessionOwner = 'expired';
    await f.context.finishAbandonedGetJdResult(4, initial);
    assert.equal(f.calls.length, status === 'processing' ? 1 : 0);
    if (f.calls.length) assert.equal(f.calls[0][2].status, 'cancelled');
  }
});
