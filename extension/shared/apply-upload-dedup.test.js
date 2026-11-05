const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../background/apply-runner.js'), 'utf8');
const body = source.slice(source.indexOf('async function fillFormPageBody('), source.indexOf('async function browserName('));

function fixture({ attached = false, autofill = false, manualUpload = false } = {}) {
  const state = { attached, uploads: [], scans: 0 };
  const helpers = {
    isAutofillUpload: () => autofill,
    resolveFields: (fields) => ({ answers: Object.fromEntries(fields.map((field) => [field.id, { file: 'resume', source: 'documents' }])), open: [] }),
  };
  const context = {
    self: { __qtsApplyAnswers: helpers }, APPLY_FILL_ROUNDS: 2, NORMAL_APPLY_SOURCES: new Set(['documents']),
    HAS_WORDS: /[a-z]/i, CHOICE_KINDS: new Set(), applyDebug: false, sleep: async () => {}, diag() {},
    readComboboxOptions: async () => [], waitForSiteFill: async () => {},
    fillAndCheck: async (_tabId, field) => { state.uploads.push(field.id); return manualUpload ? { ok: false, manualUpload: true, error: 'Already sent; check attachments and attach manually if missing.' } : { ok: true }; },
    __qtsApplyForm: {
      // A widget redraws its input after accepting the PDF, without retaining a native FileList.
      scanForAssist: () => [{ id: `cv-${state.scans++}`, kind: 'file', label: 'Resume', required: !manualUpload }],
      uploadHolds: () => state.attached, emptyRequired: () => [],
    },
  };
  vm.createContext(context);
  context.inForm = async (_tabId, fn, args = []) => vm.runInContext(`(${fn.toString()})(...${JSON.stringify(args)})`, context);
  vm.runInContext(body, context);
  const application = { job: {}, candidate: {}, savedAnswers: [], applyDocuments: { resume: { filename: 'Original.pdf', base64: 'original' } } };
  return { state, run: () => context.fillFormPageBody(1, application, () => {}, 1, { assist: true }, []) };
}

test('each normal Apply pass checks existing attachments before its first upload', async () => {
  const f = fixture({ attached: true });
  await f.run(); await f.run(); await f.run();
  assert.equal(f.state.uploads.length, 0);
});

test('redrawn file controls receive the same document only once in an autofill pass', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.state.uploads.length, 1);
  assert.ok(f.state.scans > 1);
});

test('resume parsing counts as the document upload when the widget redraws afterward', async () => {
  const f = fixture({ autofill: true });
  await f.run();
  assert.equal(f.state.uploads.length, 1);
});

test('an uncertain previously sent upload reports manual guidance even for an optional attachment', async () => {
  const f = fixture({ manualUpload: true });
  const result = await f.run();
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].message, /check attachments.*manually/);
  assert.equal(result.problems[0].kind, 'upload');
});
