const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'apply-pdfs.js'), 'utf8');
const { SETTING_KEY } = require('../shared/apply-local-pdfs.js');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ access = { ok: true, canUseApply: true }, saved, pickerError, supported = true } = {}) {
  const events = [], button = {}, status = { dataset: {} }, windowEvents = {};
  let click, restoreClick, storageChanged;
  const restore = {};
  restore.addEventListener = (_type, handler) => { restoreClick = handler; };
  button.addEventListener = (_type, handler) => { click = handler; };
  const state = { access, saved, writes: [], selected: null };
  const context = {
    document: { getElementById: (id) => id === 'choose-folder' ? button : id === 'restore-access' ? restore : status },
    window: { addEventListener: (type, handler) => { windowEvents[type] = handler; } },
    chrome: {
      runtime: { sendMessage: async (message) => {
        events.push(['access', message]);
        if (state.accessError) throw state.accessError;
        return state.access;
      } },
      storage: { onChanged: { addListener: (handler) => { storageChanged = handler; } } },
    },
    __qtsApplyLocalPdfs: { SETTING_KEY },
    __qtsScannerDocumentStore: {
      getSetting: async (key) => {
        assert.equal(key, SETTING_KEY);
        if (state.readError) throw state.readError;
        return { value: state.saved };
      },
      putSetting: async (key, value) => {
        assert.equal(key, SETTING_KEY);
        if (state.writeError) throw state.writeError;
        state.saved = value;
        state.writes.push(value);
      },
    },
  };
  if (supported) context.window.showDirectoryPicker = (options) => {
    events.push(['picker', JSON.parse(JSON.stringify(options))]);
    return pickerError ? Promise.reject(pickerError) : Promise.resolve(state.selected);
  };
  vm.runInNewContext(source, context);
  return { state, button, restore, status, events, click: () => click(), restoreAccess: () => restoreClick(), focus: () => windowEvents.focus(),
    sessionChanged: () => storageChanged({ qtsSessionUser: {} }, 'local') };
}

function directory(permission = 'granted', requested = 'granted') {
  const calls = [];
  return { name: 'QTS_Resume', calls,
    queryPermission: async (options) => { calls.push(['query', options.mode]); return permission; },
    requestPermission: async (options) => { calls.push(['request', options.mode]); return requested; },
  };
}

test('folder setup fails closed for signed-out, unauthorized and failed Manager access checks', async () => {
  for (const access of [{ ok: false, error: 'Sign in as a Manager.' }, { ok: true, canUseApply: false }, { ok: false }]) {
    const f = fixture({ access });
    await settle();
    assert.equal(f.button.disabled, true);
    assert.equal(f.status.dataset.state, 'denied');
    await f.click();
    assert.equal(f.events.some(([event]) => event === 'picker'), false);
    assert.equal(f.state.writes.length, 0);
  }
});

test('authorized setup invokes a read-only picker immediately and rechecks Manager access before persisting the shared handle', async () => {
  const f = fixture();
  await settle();
  assert.equal(f.button.disabled, false);
  assert.equal(f.status.dataset.state, 'unconfigured');
  const selected = directory();
  f.state.selected = selected;
  const work = f.click();
  assert.equal(f.events.at(-1)[0], 'picker', 'no async access request before the user-gesture picker');
  await work;
  assert.deepEqual(f.events.map(([event]) => event), ['access', 'picker', 'access']);
  assert.deepEqual(f.events[1][1], { mode: 'read', startIn: 'downloads' });
  assert.equal(f.state.saved, selected);
  assert.equal(f.status.dataset.state, 'ready');
  assert.equal(selected.calls.some(([event]) => event === 'request'), false);
  assert.equal(f.events.filter(([event]) => event === 'access').every(([, request]) => request.refresh === true), true);
});

test('reopening checks the persisted permission and never prompts automatically when a grant is revoked', async () => {
  const saved = directory();
  const reopened = fixture({ saved });
  await settle();
  assert.equal(reopened.status.dataset.state, 'ready');
  const revoked = directory('prompt');
  const f = fixture({ saved: revoked });
  await settle();
  assert.equal(f.status.dataset.state, 'revoked');
  assert.match(f.status.textContent, /Allow saved folder access/);
  assert.equal(f.button.disabled, false);
  assert.deepEqual(revoked.calls, [['query', 'read']]);
  f.state.selected = directory('granted');
  await f.click();
  assert.equal(f.status.dataset.state, 'ready');
});

test('denied read access and cancelling the picker preserve the existing folder', async () => {
  const saved = directory();
  const denied = fixture({ saved });
  await settle();
  denied.state.selected = directory('prompt', 'denied');
  await denied.click();
  assert.equal(denied.status.dataset.state, 'error');
  assert.match(denied.status.textContent, /Read access was not granted/);
  assert.equal(denied.state.saved, saved);
  assert.equal(denied.state.writes.length, 0);
  assert.deepEqual(denied.state.selected.calls, [['query', 'read'], ['request', 'read']]);
  const cancelled = fixture({ saved, pickerError: { name: 'AbortError' } });
  await settle();
  await cancelled.click();
  assert.equal(cancelled.status.dataset.state, 'ready');
  assert.equal(cancelled.state.saved, saved);
  assert.equal(cancelled.state.writes.length, 0);
});

test('permission revoked by Super Admin while choosing prevents saving the selection', async () => {
  const f = fixture();
  await settle();
  f.state.access = { ok: true, canUseApply: false };
  f.state.selected = directory();
  await f.click();
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.button.disabled, true);
  assert.equal(f.status.dataset.state, 'denied');
});

test('a session change invalidates an in-flight selection even if the new Manager also has Apply access', async () => {
  const f = fixture();
  await settle();
  f.state.selected = directory();
  const selecting = f.click();
  f.sessionChanged();
  await selecting;
  await settle();
  assert.equal(f.state.writes.length, 0);
});

test('an unavailable picker explains how to recover without enabling setup', async () => {
  const f = fixture({ supported: false });
  await settle();
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /Update Chrome and retry/);
});

test('rejects Downloads or a job subfolder without replacing the previous grant', async () => {
  const saved = directory();
  const f = fixture({ saved });
  await settle();
  for (const name of ['Downloads', 'Candidate', 'Run']) {
    f.state.selected = { ...directory(), name };
    await f.click();
    assert.match(f.status.textContent, /Select the QTS_Resume subfolder inside Downloads/);
    assert.equal(f.state.saved, saved);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.selected.calls.length, 0, 'wrong scope never requests filesystem permission');
  }
});

test('a persisted handle with prompt permission can be authorized directly without choosing it again', async () => {
  let permission = 'prompt';
  const saved = directory();
  saved.queryPermission = async () => permission;
  saved.requestPermission = (options) => {
    saved.calls.push(['request', options.mode]); permission = 'granted'; return Promise.resolve(permission);
  };
  const f = fixture({ saved });
  await settle();
  assert.equal(f.restore.hidden, false);
  const restoring = f.restoreAccess();
  assert.deepEqual(saved.calls, [['request', 'read']], 'permission request precedes asynchronous Manager access check');
  await restoring;
  assert.equal(f.status.dataset.state, 'ready');
  assert.equal(f.restore.hidden, true);
  assert.equal(f.events.some(([event]) => event === 'picker'), false);
  assert.equal(f.state.writes.length, 0, 'the persisted handle is reused');
  await f.focus();
  await settle();
  assert.equal(f.status.dataset.state, 'ready');
});

test('restoring saved read access still refuses revoked Manager permissions and invalidates session races', async () => {
  const f = fixture({ saved: directory('prompt') });
  await settle();
  f.state.access = { ok: true, canUseApply: false };
  await f.restoreAccess();
  assert.equal(f.button.disabled, true);
  assert.equal(f.restore.disabled, true);
  assert.match(f.status.textContent, /Apply access is no longer available/);
  const race = fixture({ saved: directory('prompt') });
  await settle();
  const work = race.restoreAccess();
  race.sessionChanged();
  await work;
  await settle();
  assert.equal(race.state.writes.length, 0);
});

test('storage and access-check failures give recovery instructions without replacing a saved grant', async () => {
  const saved = directory();
  const f = fixture({ saved });
  await settle();
  f.state.writeError = new Error('Could not save the folder.');
  f.state.selected = directory();
  await f.click();
  assert.equal(f.state.saved, saved);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.button.disabled, false);
  assert.match(f.status.textContent, /Choose the QTS_Resume folder again to retry/);
  f.state.readError = new Error('Saved folder unavailable.');
  f.focus();
  await settle();
  assert.match(f.status.textContent, /Saved folder unavailable/);
  assert.match(f.status.textContent, /Choose the QTS_Resume folder again/);
  f.state.accessError = new Error('Could not reach QTS.');
  f.focus();
  await settle();
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /Reopen this page to check Manager access again/);
});
