const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const api = require('../shared/apply-file-access.js');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const config = api.configuration('C:\\Users\\Manager\\Downloads\\QTS_Resume');

function fixture({ access = true, permission = true, saved = null, search = '' } = {}) {
  const state = { access, permission, saved, writes: [], messages: [], events: [] };
  const elements = Object.fromEntries(['file-folder-path', 'save-file-access', 'use-picker-access', 'file-access-status', 'folder-picker-settings'].map((id) => [id, { value: '', dataset: {}, addEventListener(type, fn) { this[type] = fn; } }]));
  const events = {};
  let sessionChanged;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'apply-pdf-file-access.js'), 'utf8'), {
    document: { getElementById: (id) => elements[id] }, location: { search }, Event: class { constructor(type) { this.type = type; } },
    window: { addEventListener: (type, fn) => { events[type] = fn; }, dispatchEvent: (event) => state.events.push(event.type) },
    chrome: { runtime: { sendMessage: async (message) => { state.messages.push(message); if (state.wait) await state.wait; return { ok: state.access, canUseApply: state.access }; } }, storage: { onChanged: { addListener: (fn) => { sessionChanged = fn; } } } },
    __qtsApplyFileAccess: { ...api, permissionGranted: async () => state.permission },
    __qtsScannerDocumentStore: { getSetting: async (key) => { assert.equal(key, api.SETTING_KEY); return { value: state.saved }; }, putSetting: async (key, value) => { assert.equal(key, api.SETTING_KEY); state.saved = value; state.writes.push(value); } },
  });
  return { state, input: elements['file-folder-path'], folderPicker: elements['folder-picker-settings'], save: () => elements['save-file-access'].click(), picker: () => elements['use-picker-access'].click(), status: elements['file-access-status'], focus: () => events.focus(), sessionChanged: () => sessionChanged({ qtsSessionUser: {} }, 'local') };
}

test('signed-out or unauthorized Managers cannot configure local file access', async () => {
  const f = fixture({ access: false }); await settle();
  assert.equal(f.input.disabled, true); assert.equal(f.status.dataset.state, 'denied');
  await f.save(); await f.picker(); assert.equal(f.state.writes.length, 0);
});

test('explicit setup validates permission and freshly authorizes Manager before storing only local config', async () => {
  const f = fixture(); await settle(); f.input.value = config.rootPath;
  await f.save(); assert.deepEqual(f.state.saved, config);
  assert.equal(f.folderPicker.hidden, true, 'inactive picker permission warnings do not contradict direct setup');
  assert.equal(f.state.messages.length, 2); assert.equal(f.state.messages.every((message) => message.refresh === true && !JSON.stringify(message).includes(config.rootPath)), true);
  assert.match(f.status.textContent, /close settings.*Retry autofill/);
  assert.deepEqual(f.state.events, ['qts-pdf-folder-updated']);
  await f.picker(); assert.equal(f.state.saved, null); assert.match(f.status.textContent, /handle is unchanged/);
  assert.equal(f.folderPicker.hidden, false);
});

test('reopening and focus check revoked permission while retaining the saved path', async () => {
  const f = fixture({ saved: config }); await settle();
  assert.equal(f.status.dataset.state, 'ready'); assert.equal(f.input.value, config.rootPath);
  f.state.permission = false; f.focus(); await settle();
  assert.equal(f.status.dataset.state, 'revoked'); assert.match(f.status.textContent, /Allow access to file URLs.*path is saved/);
  await f.save(); assert.equal(f.state.writes.length, 0); assert.equal(f.state.saved, config);
});

test('invalid paths, missing permission and newly revoked Manager access never write settings', async () => {
  const f = fixture(); await settle(); f.input.value = 'C:/Downloads'; await f.save();
  assert.match(f.status.textContent, /end with QTS_Resume/);
  f.input.value = config.rootPath; f.state.permission = false; await f.save(); assert.match(f.status.textContent, /Enable Allow access/);
  f.state.permission = true; f.state.access = false; await f.save(); assert.match(f.status.textContent, /Manager with Apply/);
  assert.equal(f.state.writes.length, 0);
});

test('session changes invalidate setup while its authorization is pending', async () => {
  const f = fixture(); await settle(); f.input.value = config.rootPath;
  let release; f.state.wait = new Promise((resolve) => { release = resolve; });
  const write = f.save(); await settle(); f.state.access = false; f.sessionChanged(); release();
  await write; await settle(); assert.equal(f.state.writes.length, 0); assert.equal(f.input.disabled, true);
});

test('legacy relinking keeps explicit picker setup available even with direct mode configured', async () => {
  const f = fixture({ saved: config, search: '?attemptId=owned-attempt' }); await settle();
  assert.equal(f.folderPicker.hidden, false); assert.equal(f.status.dataset.state, 'ready');
});
