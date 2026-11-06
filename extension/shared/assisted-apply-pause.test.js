const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../background/apply-runner.js'), 'utf8');

function fixture() {
  const state = { on: true, writes: [], pokes: [], shows: 0 };
  const assistant = { manualPaused: false, stopped: false, navigationRuns: new Map(), fillingTabs: new Set(),
    pendingNavigation: new Set([10]), formSignatures: new Map([[10, 'old']]), navigationAttempts: new Map([[10, 'old']]),
    filledFields: new Map([[10, new Set(['name'])]]),
    show: async () => { state.shows++; }, poke: (id) => state.pokes.push(id) };
  const review = { assist: true, attemptId: 'attempt', assistant, tabIds: new Set([10, 11]) };
  const reviews = new Map([['attempt', review]]);
  const context = { chrome: { runtime: { id: 'fixture' } }, activeReviews: reviews,
    self: { __qtsAutoApply: { isOn: async () => state.auto === true } }, isApplyOn: async () => state.on,
    tabsOf: (r) => r.tabIds,
    rememberApplySession: async () => { state.writes.push({ manualPaused: assistant.manualPaused }); if (state.gate) await state.gate; },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function setAssistedAutofillPaused('), source.indexOf('async function fillVisibleAssistForm(')), context);
  const sender = { id: 'fixture', frameId: 0, tab: { id: 10 } };
  return { state, assistant, review, reviews, sender,
    action: (action, from = sender) => context.setAssistedAutofillPaused({ attemptId: 'attempt', action }, from) };
}

test('Manager pause persists, drains pending work and resumes explicitly without clearing already filled fields', async () => {
  const f = fixture();
  assert.equal((await f.action('pause_fill')).ok, true);
  assert.equal(f.assistant.manualPaused, true);
  assert.equal(f.assistant.pendingNavigation.size, 0);
  assert.equal(f.state.pokes.length, 0);
  assert.equal(f.state.writes[0].manualPaused, true);
  assert.equal((await f.action('resume_fill', { ...f.sender, tab: { id: 11 } })).ok, true);
  assert.deepEqual(f.state.pokes, [11]);
  assert.equal(f.assistant.formSignatures.size, 0);
  assert.equal(f.assistant.filledFields.get(10).has('name'), true);
  assert.equal(f.state.writes[1].manualPaused, false);
});

test('resume waits for the current action to finish and cannot bypass a PDF error', async () => {
  const f = fixture(); await f.action('pause_fill');
  f.assistant.navigationRuns.set(10, Promise.resolve());
  assert.equal((await f.action('resume_fill')).ok, false);
  assert.equal(f.assistant.manualPaused, true);
  f.assistant.navigationRuns.clear(); f.assistant.fillError = 'Missing PDF';
  assert.equal((await f.action('resume_fill')).ok, true);
  assert.equal(f.state.pokes.length, 0);
  assert.equal(f.assistant.fillError, 'Missing PDF');
});

test('pause controls reject foreign tabs/frames, inactive Apply, Auto Apply and ended attempts', async () => {
  for (const mutate of [
    (f) => { f.sender.tab.id = 99; }, (f) => { f.sender.frameId = 1; }, (f) => { f.sender.id = 'foreign'; },
    (f) => { f.state.on = false; }, (f) => { f.state.auto = true; },
    (f) => { f.assistant.stopped = true; }, (f) => { f.reviews.clear(); },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal((await f.action('pause_fill')).ok, false);
    assert.equal(f.assistant.manualPaused, false);
    assert.equal(f.state.writes.length, 0);
  }
});

test('Cancel during resume persistence cannot restart filling', async () => {
  const f = fixture(); await f.action('pause_fill');
  let release; f.state.gate = new Promise((resolve) => { release = resolve; });
  const pending = f.action('resume_fill');
  await new Promise((resolve) => setImmediate(resolve));
  f.reviews.clear(); release();
  assert.equal((await pending).ok, false);
  assert.equal(f.state.pokes.length, 0);
});

test('only one concurrent Resume request starts work', async () => {
  const f = fixture(); await f.action('pause_fill');
  const replies = await Promise.all([f.action('resume_fill'), f.action('resume_fill')]);
  assert.equal(replies.filter((reply) => reply.ok).length, 1);
  assert.equal(f.state.pokes.length, 1);
});

test('pause between fields retains completed field IDs so resuming cannot overwrite Manager edits', async () => {
  const filled = new Set(), values = {}, calls = [];
  let paused = false, pauseOnFill = true;
  const fields = [{ id: 'first', kind: 'text', label: 'First name' }, { id: 'last', kind: 'text', label: 'Last name' }];
  const context = {
    self: { __qtsApplyAnswers: { isAutofillUpload: () => false, resolveFields: (items) => ({
      answers: Object.fromEntries(items.map((field) => [field.id, { value: field.id, source: 'profile' }])), open: [],
    }) } },
    NORMAL_APPLY_SOURCES: new Set(['profile']), APPLY_FILL_ROUNDS: 2, HAS_WORDS: /[a-z]/i,
    CHOICE_KINDS: new Set(), applyDebug: false, sleep: async () => {}, diag() {},
    readComboboxOptions: async () => [], usedKey: (_used, field) => field.label, fieldFacts: () => ({}),
    fillAndCheck: async (_tab, field, answer) => { calls.push(field.id); values[field.id] = answer.value; if (pauseOnFill) paused = true; return { ok: true }; },
    ApplyStop: class extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
    __qtsApplyForm: { setUploadContext() {}, verifyUploads: () => [], emptyRequiredUploads: () => [], scanForAssist: () => fields, emptyRequired: () => [] },
  };
  vm.createContext(context);
  context.inForm = async (_tab, fn, args = []) => vm.runInContext(`(${fn})(...${JSON.stringify(args)})`, context);
  vm.runInContext(source.slice(source.indexOf('async function fillFormPageBody('), source.indexOf('async function browserName(')), context);
  const options = { assist: true, stop: async () => paused, skip: (field) => filled.has(field.id), onFilled: (field) => filled.add(field.id) };
  const application = { job: {}, candidate: {}, savedAnswers: [] };
  await assert.rejects(context.fillFormPageBody(10, application, () => {}, 1, options, []), (error) => error.keepTab === false);
  assert.deepEqual(calls, ['first']);
  assert.equal(filled.has('first'), true);
  values.first = 'Manager correction'; paused = false; pauseOnFill = false;
  await context.fillFormPageBody(10, application, () => {}, 1, options, []);
  assert.deepEqual(calls, ['first', 'last']);
  assert.equal(values.first, 'Manager correction');
});

test('pausing dropdown discovery prevents fallback clicks and discovery of the next field', async () => {
  let paused = false, reads = 0, clicks = 0;
  const context = {
    diag() {}, inForm: async () => { reads++; paused = true; return null; },
    readChoicesWithRealClick: async () => { clicks++; return {}; },
    ApplyStop: class extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function readComboboxOptions('), source.indexOf('function answerPromptFor(')), context);
  await assert.rejects(context.readComboboxOptions(10, [{ id: 'city', kind: 'combobox' }, { id: 'country', kind: 'combobox' }], async () => paused), (error) => error.keepTab === false);
  assert.equal(reads, 1);
  assert.equal(clicks, 0);
});
