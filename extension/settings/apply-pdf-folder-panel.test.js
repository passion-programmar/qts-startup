const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'apply-pdf-folder-panel.js'), 'utf8');
const { SETTING_KEY } = require('../shared/apply-local-pdfs.js');
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ access = { ok: true, canUseApply: true }, saved, supported = true, embedded = false } = {}) {
  const calls = [];
  const handlers = {};
  const button = { addEventListener: (_type, handler) => { handlers.choose = handler; } };
  const restore = { hidden: true, addEventListener: (_type, handler) => { handlers.restore = handler; } };
  const status = { dataset: {} };
  const state = { access, saved, selected: null, writes: [] };
  const windowObject = { dispatchEvent: () => {}, addEventListener: () => {} };
  windowObject.top = embedded ? {} : windowObject;
  const documentObject = { getElementById: (id) => ({ 'choose-folder': button, 'restore-access': restore, 'folder-status': status })[id],
    addEventListener: (_type, handler) => { handlers.visibility = handler; } };
  const context = {
    document: documentObject,
    window: windowObject,
    Event: function Event(type) { this.type = type; },
    chrome: {
      runtime: { sendMessage: async (message) => {
        calls.push([message.type === 'QTS_OPEN_APPLY_PDF_FOLDER_PICKER' ? 'open' : 'access', message]);
        if (message.type === 'QTS_OPEN_APPLY_PDF_FOLDER_PICKER') return { ok: true };
        return state.access;
      } },
      storage: { onChanged: { addListener: (handler) => { handlers.storage = handler; } } },
    },
    __qtsApplyLocalPdfs: { SETTING_KEY },
    __qtsScannerDocumentStore: {
      getSetting: async (key) => {
        assert.equal(key, SETTING_KEY);
        return { value: state.saved };
      },
      putSetting: async (key, value) => {
        assert.equal(key, SETTING_KEY);
        state.saved = value;
        state.writes.push(value);
      },
    },
  };
  if (supported) context.window.showDirectoryPicker = (options) => {
    calls.push(['picker', options]);
    return Promise.resolve(state.selected);
  };
  vm.runInNewContext(source, context);
  return { button, restore, status, state, calls, choose: () => handlers.choose(), restoreAccess: () => handlers.restore() };
}

function directory(permission = 'granted', requested = 'granted') {
  const calls = [];
  let currentPermission = permission;
  return {
    name: 'QTS_Resume',
    calls,
    queryPermission: async (options) => { calls.push(['query', options.mode]); return currentPermission; },
    requestPermission: async (options) => {
      calls.push(['request', options.mode]);
      currentPermission = requested;
      return requested;
    },
  };
}

test('folder control stays unavailable unless the Manager has Apply access', async () => {
  for (const access of [{ ok: false }, { ok: true, canUseApply: false }]) {
    const f = fixture({ access });
    await settle();
    assert.equal(f.button.disabled, true);
    assert.equal(f.status.dataset.state, 'denied');
    await f.choose();
    assert.equal(f.calls.some(([kind]) => kind === 'picker'), false);
    assert.equal(f.state.writes.length, 0);
  }
});

test('embedded panel opens the top-level chooser instead of requesting browser permissions in an iframe', async () => {
  const f = fixture({ embedded: true, saved: directory('prompt') });
  await settle();
  assert.equal(f.status.dataset.state, 'ready');
  assert.match(f.status.textContent, /Folder saved/);
  assert.equal(f.restore.hidden, true);
  await f.choose();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(([kind]) => kind === 'open').map(([, message]) => message))), [
    { type: 'QTS_OPEN_APPLY_PDF_FOLDER_PICKER' },
  ]);
  assert.equal(f.calls.some(([kind]) => kind === 'picker'), false);
  assert.equal(f.state.writes.length, 0);
});

test('authorized Manager saves a selected QTS_Resume handle to Apply shared storage', async () => {
  const f = fixture();
  await settle();
  assert.equal(f.button.disabled, false);
  assert.equal(f.status.dataset.state, 'unconfigured');
  const selected = directory();
  f.state.selected = selected;
  const choosing = f.choose();
  assert.equal(f.calls.at(-1)[0], 'picker');
  await choosing;
  assert.deepEqual(f.calls.map(([kind]) => kind), ['access', 'picker', 'access']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1][1])), { mode: 'read', startIn: 'downloads' });
  assert.equal(f.state.saved, selected);
  assert.equal(f.status.dataset.state, 'ready');
  assert.equal(f.state.writes.length, 1);
});

test('saved folder permission is displayed and can be restored by explicit user action', async () => {
  const saved = directory('prompt');
  const f = fixture({ saved });
  await settle();
  assert.equal(f.status.dataset.state, 'revoked');
  assert.equal(f.restore.hidden, false);
  await f.restoreAccess();
  assert.equal(f.status.dataset.state, 'ready');
  assert.deepEqual(saved.calls, [['query', 'read'], ['request', 'read'], ['query', 'read']]);
});

test('cancelling or denying access leaves the previously saved folder unchanged', async () => {
  const saved = directory();
  const f = fixture({ saved });
  await settle();
  f.state.selected = directory('prompt', 'denied');
  await f.choose();
  assert.equal(f.status.dataset.state, 'error');
  assert.equal(f.state.saved, saved);
  assert.equal(f.state.writes.length, 0);
  assert.deepEqual(f.state.selected.calls, [['query', 'read'], ['request', 'read']]);
});

test('unsupported directory picker reports an explicit error and stays disabled', async () => {
  const f = fixture({ supported: false });
  await settle();
  assert.equal(f.status.dataset.state, 'error');
  assert.equal(f.button.disabled, true);
});
