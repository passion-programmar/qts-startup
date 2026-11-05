const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
require('./apply-pdf.js');
const localPdfs = require('./apply-local-pdfs.js');
const source = fs.readFileSync(path.join(__dirname, '../background/apply-runner.js'), 'utf8');
const paths = { resumePath: 'QTS_Resume/Run/Resume (1).pdf', coverLetterPath: 'QTS_Resume/Run/Letter (2).pdf' };
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ permission = 'granted', missing = false, documents = paths, failure = null, noFolder = false } = {}) {
  const stored = { status: 'apply' }, listeners = [], calls = [], panels = [];
  const state = { permission, missing, documents, failure, noFolder, pokes: [], fillCalls: 0 };
  const event = { addListener() {}, removeListener() {} };
  const directory = {
    queryPermission: async () => state.permission,
    getDirectoryHandle: async () => directory,
    getFileHandle: async (filename) => {
      if (state.missing) throw Object.assign(new Error(`The saved file "${filename}" is missing.`), { name: 'NotFoundError' });
      return { getFile: async () => ({ size: 12, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7\nlocal').buffer }) };
    },
  };
  const context = vm.createContext({ Error, Map, Set, URL, console: { debug() {}, error() {} },
    EXTENSION_STATUS_KEY: 'status', setInterval: () => 1, clearInterval() {},
    chrome: {
      runtime: { id: 'fixture', getURL: (path) => `chrome-extension://fixture/${path}`, onMessage: { addListener: (fn) => listeners.push(fn) } },
      notifications: { onClicked: event, onButtonClicked: event },
      tabs: { create: async (options) => { state.opened = options; }, onUpdated: event, onRemoved: event, onCreated: event, onActivated: event },
      storage: { onChanged: event, local: { get: async () => stored, set: async (values) => Object.assign(stored, values) }, session: { remove: async () => {} } },
    },
    self: {
      __qtsApplyLocalPdfs: localPdfs,
      __qtsScannerDocumentStore: { getSetting: async (key) => ({ value: key === localPdfs.SETTING_KEY && !state.noFolder ? directory : null }) },
      __qtsChromePdf: { printDocuments: async () => { throw new Error('Must never render'); } },
    },
    workerApiRequest: async (method, url, body) => {
      calls.push({ method, url, ...(body ? { body } : {}) });
      return state.failure || { success: true, documents: state.documents };
    },
  });
  vm.runInContext(`${source}\nglobalThis.testApi = { ApplyStop, activeReviews, fillVisibleAssistForm, retryAssistedAutofill, resumeApplySessions, rememberApplySession };`, context);
  const api = context.testApi;
  const application = { attemptId: 'attempt', job: { id: 'job', company: 'Fixture', title: 'Engineer' } };
  const assistant = { stopped: false, fillError: null, status: '', problems: [],
    formSignatures: new Map(), filledFields: new Map([[10, new Set(['manager-answer'])]]), fillingTabs: new Set(),
    navigationRuns: new Map(), navigationAttempts: new Map(), pendingNavigation: new Set(),
    show: async () => panels.push({ status: assistant.status, problems: assistant.problems, paused: Boolean(assistant.fillError) }),
    poke: (tabId) => { state.pokes.push(tabId); state.work = api.fillVisibleAssistForm(tabId, application, assistant, async () => {}); },
  };
  const review = { attemptId: application.attemptId, job: application.job, assist: true, tabIds: new Set([10]), assistant };
  api.activeReviews.set(application.attemptId, review);
  context.inForm = async () => 'form-signature';
  context.fillFormPage = async (_tabId, _application, _keepAlive, _step, options) => {
    state.fillCalls++;
    assert.equal(options.skip({ id: 'manager-answer' }), true, 'retry must retain previously filled fields');
    await context.fetchApplyDocuments('attempt');
    return { used: { Name: { fieldId: 'name' } }, problems: [] };
  };
  return { api, context, state, stored, calls, panels, application, assistant, review,
    fill: () => api.fillVisibleAssistForm(10, application, assistant, async () => {}),
    message: (action, tabId = 10) => new Promise((resolve) => listeners[0]({ type: 'QTS_APPLY_PANEL', assist: true, attemptId: 'attempt', action }, { id: 'fixture', tab: { id: tabId } }, resolve)),
    recovery: (action, input, override = {}) => new Promise((resolve) => {
      const msg = { type: 'QTS_APPLY_PDF_RECOVERY', action, attemptId: 'attempt', input };
      const sender = { id: 'fixture', frameId: 0, url: 'chrome-extension://fixture/settings/apply-pdfs.html?attemptId=attempt', ...override };
      for (const listener of listeners) if (listener(msg, sender, resolve)) return;
      resolve({ ok: false });
    }),
  };
}

test('missing paths, missing files, absent folder and revoked read access retain actionable ApplyStop errors', async () => {
  for (const [options, message] of [
    [{ documents: { resumePath: paths.resumePath, coverLetterPath: null } }, /saved PDF paths.*QTS administrator/i],
    [{ failure: { success: false, _httpStatus: 404, message: 'Run Generation again.' } }, /saved PDF paths.*QTS administrator/i],
    [{ missing: true }, /saved file.*missing.*Apply PDFs folder/i],
    [{ permission: 'prompt' }, /permission is unavailable.*Apply PDFs folder/i],
    [{ noFolder: true }, /Choose the QTS_Resume folder.*Apply PDFs folder/i],
    [{ failure: { success: false, _httpStatus: 403, message: 'Apply was turned off for your account.' } }, /Apply was turned off for your account/],
  ]) {
    const f = fixture(options);
    await assert.rejects(f.context.fetchApplyDocuments('attempt'), (error) => {
      assert.equal(error instanceof f.api.ApplyStop, true);
      assert.equal(error.skip, false);
      assert.equal(error.keepTab, true);
      assert.match(error.message, message);
      return true;
    });
    await f.fill();
    assert.match(f.assistant.status, /Autofill paused.*Retry autofill/);
    assert.match(f.assistant.problems[0].message, message);
    assert.equal(f.assistant.fillError, f.assistant.problems[0].message);
    assert.equal(f.stored.qtsApplySessions.attempt.fillError, f.assistant.fillError);
    const count = f.calls.length;
    for (let i = 0; i < 3; i++) await f.fill();
    assert.equal(f.calls.length, count, 'page events cannot retry a paused PDF load');
    assert.equal(f.calls.every((r) => r.method === 'GET' && r.url.startsWith('/api/extension/apply/documents?')), true);
  }
});

test('only an explicit retry by an owned active page retries, and success clears persisted errors without clearing filled fields', async () => {
  const f = fixture({ missing: true });
  await f.fill();
  const error = f.assistant.fillError;
  assert.equal((await f.message('retry_fill', 99)).ok, false);
  assert.equal(f.assistant.fillError, error);
  assert.equal((await f.message('retry_fill')).ok, true);
  await f.state.work;
  assert.equal(f.assistant.fillError, error, 'an unresolved failure pauses again');
  assert.equal(f.state.fillCalls, 2);
  f.state.missing = false;
  assert.equal((await f.message('retry_fill')).ok, true);
  await f.state.work;
  assert.equal(f.assistant.fillError, null);
  assert.deepEqual(f.assistant.problems, []);
  assert.match(f.assistant.status, /Filled 1 saved answer/);
  assert.equal(f.stored.qtsApplySessions.attempt.fillError, undefined);
  assert.equal(f.assistant.filledFields.get(10).has('manager-answer'), true);
  assert.equal((await f.message('retry_fill')).ok, false, 'no duplicate retry after recovery');
});

test('retry is refused while stopping, after Cancel, after ownership is lost, and while Apply is off', async () => {
  for (const stop of [
    (f) => f.assistant.navigationRuns.set(10, Promise.resolve()),
    (f) => { f.assistant.stopped = true; },
    (f) => f.api.activeReviews.delete('attempt'),
    (f) => { f.stored.status = null; },
    (f) => { f.review.assist = false; },
  ]) {
    const f = fixture({ missing: true });
    await f.fill();
    stop(f);
    assert.equal((await f.message('retry_fill')).ok, false);
    assert.deepEqual(f.state.pokes, []);
    assert.equal(f.state.fillCalls, 1);
  }
});

test('concurrent retry requests start only one fill, and Cancel during retry persistence prevents that fill', async () => {
  const f = fixture({ missing: true });
  await f.fill();
  let release;
  f.context.workerApiRequest = () => new Promise((resolve) => { release = resolve; });
  const replies = await Promise.all([f.message('retry_fill'), f.message('retry_fill')]);
  assert.equal(replies.filter((r) => r.ok).length, 1);
  await settle();
  assert.deepEqual(f.state.pokes, [10]);
  release({ success: true, documents: paths });
  f.state.missing = false;
  await f.state.work;
  const stopped = fixture({ missing: true });
  await stopped.fill();
  stopped.context.rememberApplySession = async () => { stopped.assistant.stopped = true; };
  assert.equal((await stopped.message('retry_fill')).ok, false);
  assert.deepEqual(stopped.state.pokes, []);
});

test('an error resolving after Cancel or lost ownership cannot restore the panel or persist a retry', async () => {
  for (const stop of [(f) => { f.assistant.stopped = true; }, (f) => f.api.activeReviews.delete('attempt')]) {
    const f = fixture();
    let reject;
    f.context.fillFormPage = () => new Promise((_resolve, fail) => { reject = fail; });
    const work = f.fill();
    await settle();
    stop(f);
    const shown = f.panels.length;
    reject(new f.api.ApplyStop('PDF unavailable.', { skip: false }));
    await work;
    assert.equal(f.panels.length, shown);
    assert.equal(f.assistant.fillError, null);
    assert.equal(f.stored.qtsApplySessions, undefined);
    assert.equal(f.assistant.fillingTabs.size, 0);
  }
});

test('a lifecycle ApplyStop remains a stop and cannot become a PDF retry', async () => {
  const f = fixture();
  f.context.fillFormPage = async () => { throw new f.api.ApplyStop('Stopped.', { skip: false, keepTab: false }); };
  await f.fill();
  assert.equal(f.assistant.fillError, null);
  assert.equal(f.stored.qtsApplySessions, undefined);
  assert.equal((await f.message('retry_fill')).ok, false);
});

test('worker recovery passes the saved pause to the resumed application without losing its original error', async () => {
  const f = fixture({ permission: 'denied' });
  await f.fill();
  const error = f.assistant.fillError;
  f.api.activeReviews.clear();
  f.context.getTab = async () => ({ id: 10 });
  f.context.workerApiRequest = async () => ({ success: true, application: f.application });
  let resumed;
  f.context.runAssistedApplication = (application, options) => { resumed = { application, options }; return Promise.resolve(); };
  await f.api.resumeApplySessions(1);
  assert.equal(resumed.options.fillError, error);
  assert.deepEqual([...resumed.options.resumeTabIds], [10]);
});


test('only an explicitly recoverable owned pause can open the existing extension recovery page', async () => {
  const f = fixture({ failure: { success: false, _httpStatus: 404, code: 'PDF_RELINK_REQUIRED', message: 'Link both original PDFs.' } });
  await f.fill();
  assert.equal(f.assistant.relinkRequired, true);
  assert.equal(f.stored.qtsApplySessions.attempt.relinkRequired, true);
  assert.equal((await f.message('link_pdfs', 99)).ok, false);
  assert.equal((await f.message('link_pdfs')).ok, true);
  assert.equal(f.state.opened.url, 'chrome-extension://fixture/settings/apply-pdfs.html?attemptId=attempt');
  assert.equal(f.calls.length, 1, 'opening the page does not itself save or resume');
  const ordinary = fixture({ failure: { success: false, _httpStatus: 404 } });
  await ordinary.fill();
  assert.equal((await ordinary.message('link_pdfs')).ok, false);
});

test('recovery messages require the extension page and live normal Apply ownership; only metadata reaches the API', async () => {
  const f = fixture({ failure: { success: false, code: 'PDF_RELINK_REQUIRED', message: 'Link PDFs.' } });
  await f.fill();
  const before = f.calls.length;
  for (const sender of [{ id: 'foreign' }, { frameId: 1 }, { url: 'https://employer.test/settings/apply-pdfs.html?attemptId=attempt' }, { url: 'chrome-extension://foreign/settings/apply-pdfs.html?attemptId=attempt' }, { url: 'chrome-extension://fixture/popup/popup.html?attemptId=attempt' }]) {
    assert.equal((await f.recovery('context', null, sender)).ok, false);
  }
  assert.equal(f.calls.length, before);
  f.state.failure = { success: true, recovery: { attemptId: 'attempt' } };
  assert.equal((await f.recovery('context')).ok, true);
  assert.match(f.calls.at(-1).url, /recovery=1/);
  const input = { attemptId: 'attempt', generationId: 'run', expectedResumePath: paths.resumePath,
    expectedCoverLetterPath: null, resumePath: paths.resumePath, coverLetterPath: paths.coverLetterPath };
  assert.equal((await f.recovery('save', { ...input, bytes: '%PDF-' })).ok, false);
  assert.equal((await f.recovery('save', input)).ok, true);
  assert.deepEqual(f.calls.at(-1), { method: 'POST', url: '/api/extension/apply/documents/relink', body: input });
  assert.ok(f.assistant.fillError, 'saving never clears the pause');
  assert.deepEqual(f.state.pokes, []);
  f.context.self.__qtsAutoApply = { isOn: async () => true };
  assert.equal((await f.recovery('save', input)).ok, false, 'unattended Auto Apply cannot relink');
  f.context.self.__qtsAutoApply = null;
  let finish; f.state.failure = new Promise(resolve => { finish = resolve; });
  const pending = f.recovery('save', input);
  await settle(); f.assistant.stopped = true; finish({ success: true });
  const late = await pending;
  assert.equal(late.ok, false); assert.match(late.error, /Apply stopped/);
  assert.deepEqual(f.state.pokes, []);
});
