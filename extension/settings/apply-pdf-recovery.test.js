const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'apply-pdf-recovery.js'), 'utf8');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const job = { attemptId: 'attempt', jobId: 'job', generationId: 'run', candidateName: 'Candidate', title: 'Engineer', company: 'Company',
  resumePath: 'QTS_Resume/Run/Old.pdf', coverLetterPath: null };

function fixture() {
  const nodes = {}, calls = [], events = {};
  let storageListener;
  const get = (id) => nodes[id] ||= { value: '', checked: false, disabled: false, hidden: false, handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
    replaceChildren(...options) { this.options = options; }, removeAttribute(key) { delete this[key]; } };
  const state = { owner: true, permission: 'granted', digest: 'original', reads: 0, response: { ok: true }, context: job };
  const root = { queryPermission: async () => state.permission, isSameEntry: async (other) => other === root };
  const context = { URL, Blob, location: { href: 'chrome-extension://fixture/settings/apply-pdfs.html?attemptId=attempt' },
    Option: function Option(label, value) { this.label = label; this.value = value; },
    document: { getElementById: get }, window: { addEventListener: (name, fn) => { events[name] = fn; } },
    chrome: { runtime: { sendMessage: async (msg) => {
      calls.push(msg);
      if (msg.action === 'check') return { ok: state.owner, error: 'Application stopped.' };
      if (msg.action === 'context') return state.context ? { ok: true, recovery: state.context } : { ok: false, error: 'Not authorized.' };
      return state.response;
    } }, storage: { onChanged: { addListener: (fn) => { storageListener = fn; } } } },
    __qtsApplyLocalPdfs: { SETTING_KEY: 'folder' },
    __qtsScannerDocumentStore: { getSetting: async () => ({ value: root }) },
    __qtsApplyPdfRelink: { parent: () => 'QTS_Resume/Run', list: async () => ['Old.pdf', 'Original (1).pdf', 'Letter (2).pdf'],
      read: async (_root, _context, resume, cover) => {
        state.reads++;
        if (state.permission !== 'granted') throw new Error('Read access unavailable.');
        if (state.gate) await state.gate;
        return [resume, cover].map((name) => ({ name, size: 12, digest: state.digest, file: new Blob(['%PDF-original']) }));
      },
    },
  };
  vm.runInNewContext(source, context);
  const select = async () => { get('resume-file').value = 'Original (1).pdf'; get('cover-file').value = 'Letter (2).pdf'; await get('cover-file').handlers.change(); };
  const confirm = () => { get('confirm-originals').checked = true; get('confirm-originals').handlers.change(); };
  return { state, get, calls, select, confirm, save: () => get('save-links').handlers.click(),
    reload: () => get('reload-recovery').handlers.click(), focus: () => events.focus(),
    sessionChanged: () => storageListener({ qtsSessionUser: {} }, 'local') };
}

test('recovery loads once with no defaults or writes; explicit confirmation sends only exact relative paths and stays paused', async () => {
  const f = fixture(); await settle();
  assert.equal(f.get('resume-file').value, ''); assert.equal(f.get('cover-file').value, '');
  assert.equal(f.get('save-links').disabled, true); assert.equal(f.state.reads, 0);
  assert.deepEqual(f.calls.map((call) => call.action), ['context']);
  await f.select(); assert.equal(f.get('save-links').disabled, true);
  assert.equal(f.get('preview-resume').hidden, false);
  assert.match(f.get('selected-files').textContent, /Original \(1\)\.pdf/);
  f.confirm(); await f.save();
  const saves = f.calls.filter((call) => call.action === 'save');
  assert.equal(saves.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].input)), { attemptId: 'attempt', generationId: 'run', expectedResumePath: job.resumePath,
    expectedCoverLetterPath: null, resumePath: 'QTS_Resume/Run/Original (1).pdf', coverLetterPath: 'QTS_Resume/Run/Letter (2).pdf' });
  assert.match(f.get('recovery-status').textContent, /still paused.*Retry autofill/);
  assert.equal(f.calls.some((call) => /retry|render|generation/.test(call.action)), false);
  await f.save(); assert.equal(f.calls.filter((call) => call.action === 'save').length, 1);
});

test('revoked permission, stopped ownership and changed bytes after review prevent Save and require review again', async () => {
  for (const change of [(f) => { f.state.permission = 'denied'; }, (f) => { f.state.owner = false; }, (f) => { f.state.digest = 'edited'; }]) {
    const f = fixture(); await settle(); await f.select(); f.confirm(); change(f); await f.save();
    assert.equal(f.calls.filter((call) => call.action === 'save').length, 0);
    assert.equal(f.get('confirm-originals').checked, false); assert.equal(f.get('save-links').disabled, true);
    assert.equal(f.get('recovery-fields').disabled, true);
  }
});

test('conflicts invalidate selections; only explicit reload/review permits another Save', async () => {
  const f = fixture(); await settle(); await f.select(); f.confirm();
  f.state.response = { ok: false, status: 409, error: 'Saved paths changed. Reload recovery.' };
  await f.save(); assert.match(f.get('recovery-status').textContent, /Reload recovery/);
  await f.save(); assert.equal(f.calls.filter((call) => call.action === 'save').length, 1);
  await f.reload(); assert.equal(f.get('resume-file').value, ''); assert.equal(f.get('confirm-originals').checked, false);
});

test('session changes invalidate pending local reads and focus detects lost ownership without a context request', async () => {
  const f = fixture(); await settle();
  let finish; f.state.gate = new Promise((resolve) => { finish = resolve; });
  const selecting = f.select(); await settle(); f.sessionChanged(); finish(); await selecting;
  assert.equal(f.get('confirm-originals').disabled, true); assert.equal(f.get('recovery-fields').disabled, true);
  f.state.owner = false; await f.focus(); assert.match(f.get('recovery-status').textContent, /stopped/);
  assert.equal(f.calls.filter((call) => call.action === 'context').length, 1);
  assert.equal(f.calls.some((call) => call.action === 'save'), false);
});
