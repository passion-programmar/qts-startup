const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const helpers = require('./apply-answers.js');
const source = fs.readFileSync(require.resolve('../background/apply-runner.js'), 'utf8');

function fixture() {
  const state = { on: true, calls: [], shows: 0, pokes: 0 };
  const application = { candidate: { candidateId: 'candidate', email: 'old@example.test' }, savedAnswers: [] };
  const assistant = { manualPaused: true, stopped: false, navigationRuns: new Map(), fillingTabs: new Set(), show: async () => { state.shows++; }, poke: () => { state.pokes++; } };
  const review = { assist: true, attemptId: 'attempt', application, assistant, tabIds: new Set([10]) };
  const reviews = new Map([['attempt', review]]);
  const fields = [{ id: 'field', label: 'Additional details', value: 'Current value', kind: 'text', options: [] }];
  const context = { chrome: { runtime: { id: 'fixture' } }, self: { __qtsApplyAnswers: helpers, __qtsAutoApply: { isOn: async () => state.auto === true } },
    activeReviews: reviews, tabsOf: (r) => r.tabIds, isApplyOn: async () => state.on,
    inForm: async () => fields,
    workerApiRequest: async (...args) => { state.calls.push(args); if (state.gate) await state.gate; return state.response || { success: true, savedAnswers: [{ id: 'saved', scope: 'manager', questionText: 'Additional details', answer: 'Shared' }], editableAnswers: [{ id: 'saved', version: '123.000001', scope: 'manager', questionText: 'Additional details', answer: 'Shared' }] }; },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function editAssistedAnswer('), source.indexOf('async function fillVisibleAssistForm(')), context);
  const sender = { id: 'fixture', frameId: 0, tab: { id: 10 } };
  return { state, application, assistant, review, reviews, fields, sender,
    run: (action = 'load_answers', input = {}, from = sender) => context.editAssistedAnswer({ attemptId: 'attempt', action, input }, from) };
}

test('explicit Save uses live field metadata, refreshes shared snapshots and never resumes or fills', async () => {
  const f = fixture();
  const other = { ...f.review, attemptId: 'other', application: { candidate: { candidateId: 'different', email: 'other@example.test' }, savedAnswers: [{ scope: 'application', answer: 'Keep this job' }, { scope: 'manager', answer: 'Old shared' }] } };
  f.reviews.set('other', other);
  f.state.response = { success: true, savedAnswers: [{ scope: 'manager', questionText: 'Additional details', answer: 'New shared' }], editableAnswers: [], profileUpdate: { field: 'candidateEmail', value: 'new@example.test' } };
  assert.equal((await f.run('save_answer', { fieldId: 'field', question: 'Additional details', answer: 'New shared', kind: 'password', options: ['forged'] })).ok, true);
  assert.equal(f.state.calls[0][2].answer.kind, 'text');
  assert.equal(f.state.calls[0][2].answer.options.length, 0);
  assert.equal(f.application.candidate.email, 'new@example.test');
  assert.equal(other.application.candidate.email, 'other@example.test');
  assert.equal(other.application.savedAnswers[0].answer, 'Keep this job');
  assert.equal(other.application.savedAnswers[1].answer, 'New shared');
  assert.equal(f.state.pokes, 0);
  assert.equal(f.assistant.manualPaused, true);
});

test('save/delete require an owned top frame, paused normal Apply and drained work', async () => {
  for (const change of [
    (f) => { f.sender.frameId = 1; }, (f) => { f.sender.id = 'foreign'; }, (f) => { f.sender.tab.id = 99; },
    (f) => { f.assistant.manualPaused = false; }, (f) => { f.assistant.navigationRuns.set(10, true); },
    (f) => { f.assistant.stopped = true; }, (f) => { f.state.on = false; }, (f) => { f.state.auto = true; },
  ]) for (const action of ['save_answer', 'delete_answer']) {
    const f = fixture(); change(f);
    assert.equal((await f.run(action)).ok, false);
    assert.equal(f.state.calls.length, 0);
  }
});

test('stale questions, conflicts, concurrent edits and Cancel cannot trigger another save or fill', async () => {
  const f = fixture();
  assert.equal((await f.run('save_answer', { fieldId: 'gone', question: 'Additional details' })).ok, false);
  assert.equal(f.state.calls.length, 0);
  f.state.response = { success: false, message: 'Changed; reload answers.' };
  assert.match((await f.run('delete_answer', { id: 'saved' })).error, /reload/);
  let release; f.state.gate = new Promise((resolve) => { release = resolve; });
  const pending = f.run('save_answer', { question: 'Additional details', answer: 'Value' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await f.run('save_answer')).ok, false);
  f.reviews.clear(); release();
  assert.equal((await pending).ok, false);
  assert.equal(f.state.pokes, 0);
  assert.equal(f.state.shows, 0);
});

test('Reload answers refreshes current candidate facts from Profile without changing other candidates or resuming', async () => {
  const f = fixture();
  const other = { ...f.review, attemptId: 'other', application: { candidate: { candidateId: 'other', phone: 'Other phone' }, savedAnswers: [] } };
  f.reviews.set('other', other);
  f.state.response = { success: true, savedAnswers: [], editableAnswers: [], candidateProfile: { phone: 'Updated in Profile', email: 'new@example.test' } };
  assert.equal((await f.run()).ok, true);
  assert.equal(f.application.candidate.phone, 'Updated in Profile');
  assert.equal(other.application.candidate.phone, 'Other phone');
  assert.equal(f.state.pokes, 0);
});
