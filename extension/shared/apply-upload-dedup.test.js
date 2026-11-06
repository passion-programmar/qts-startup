const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require.resolve('../background/apply-runner.js'), 'utf8');
const body = source.slice(source.indexOf('async function fillFormPageBody('), source.indexOf('async function browserName('));
function fixture({ fields, manualUpload = false, verification = [], missing = [], inspectError = false } = {}) {
  const state = { calls: [], contexts: [], verificationCount: 0 };
  const list = fields || [{ id: 'cv', kind: 'file', label: 'Resume', required: true }];
  const helpers = {
    isAutofillUpload: field => field.id === 'parser',
    resolveFields: fields => ({ answers: Object.fromEntries(fields.filter(field => field.id !== 'parser').map(field => [field.id, { file: field.id === 'cover' ? 'coverLetter' : 'resume', source: 'documents' }])), open: [] }),
  };
  const context = {
    self: { __qtsApplyAnswers: helpers }, APPLY_FILL_ROUNDS: 2, NORMAL_APPLY_SOURCES: new Set(['documents']),
    HAS_WORDS: /[a-z]/i, CHOICE_KINDS: new Set(), applyDebug: false, sleep: async () => {}, diag() {},
    readComboboxOptions: async () => [], waitForSiteFill: async () => {},
    fillAndCheck: async (_tabId, field, _answer, file) => { state.calls.push({ id: field.id, filename: file.filename }); return manualUpload ? { ok: false, manualUpload: true, error: 'Already sent; check attachments and attach manually if missing.' } : { ok: true }; },
    __qtsApplyForm: {
      scanForAssist: () => list,
      setUploadContext: context => state.contexts.push(context),
      uploadHolds: () => { throw Error('Runner must check the expected PDF, not merely any attachment.'); },
      emptyRequired: () => [], emptyRequiredUploads: () => missing,
      verifyUploads: async () => { state.verificationCount++; if (inspectError) throw Error('Page unavailable'); return verification; },
    },
  };
  vm.createContext(context);
  context.inForm = async (_tabId, fn, args = []) => vm.runInContext('(' + fn.toString() + ')(...' + JSON.stringify(args) + ')', context);
  vm.runInContext(body, context);
  const application = { attemptId: 'attempt', job: {}, candidate: {}, savedAnswers: [], applyDocuments: { resume: { filename: 'Resume.pdf', base64: 'resume' }, coverLetter: { filename: 'Cover.pdf', base64: 'letter' } } };
  return { state, run: () => context.fillFormPageBody(1, application, () => {}, 1, { assist: true }, []) };
}

test('every normal Apply pass delegates document-specific verification with application context', async () => {
 const f = fixture(); await f.run(); await f.run();
 assert.equal(f.state.calls.length, 2);
 assert.equal(f.state.contexts.length, 2);
 assert.equal(f.state.contexts[0].attemptId, 'attempt');
 assert.equal(f.state.verificationCount, 2);
});
test('resume parser does not suppress separate resume and cover attachments', async () => {
 const f = fixture({ fields: [
  { id: 'parser', kind: 'file', label: 'Autofill from resume' },
  { id: 'cv', kind: 'file', label: 'Resume', required: true },
  { id: 'cover', kind: 'file', label: 'Cover letter', required: true },
 ] });
 await f.run();
 assert.deepEqual(f.state.calls, [{ id: 'parser', filename: 'Resume.pdf' }, { id: 'cv', filename: 'Resume.pdf' }, { id: 'cover', filename: 'Cover.pdf' }]);
});
test('uncertain optional uploads are reported for review', async () => {
 const f = fixture({ manualUpload: true, fields: [{ id: 'cv', kind: 'file', label: 'Resume', required: false }] });
 const result = await f.run();
 assert.equal(result.problems.length, 1);
 assert.match(result.problems[0].message, /check attachments.*manually/);
});
test('normal Apply reports final rejection, missing attachments, and failed inspection', async () => {
 for (const options of [
  { verification: [{ id: 'cv', label: 'Resume', message: 'File rejected' }] },
  { missing: [{ id: 'cv', label: 'Resume' }] }, { inspectError: true },
 ]) {
  const f = fixture(options); const result = await f.run();
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].kind, 'upload');
 }
});
