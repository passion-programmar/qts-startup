const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(records = {}, failWrites = false) {
  const saved = { qtsAutoApplyRuns: records };
  const calls = [];
  const setAside = [];
  const errors = [];
  let response = { success: true };
  const session = {};
  const context = vm.createContext({ self: {}, EXTENSION_STATUS_KEY: 'qtsExtensionStatus', console: { error: (...args) => errors.push(args) }, crypto: require('node:crypto').webcrypto,
    chrome: { storage: { local: { get: async key => ({ [key]: saved[key] }), set: async values => { if (failWrites) throw Error('Storage is unavailable.'); Object.assign(saved, structuredClone(values)); } }, session: { get: async key => ({ [key]: session[key] }), set: async values => Object.assign(session, values) }, onChanged: { addListener() {} } }, tabs: { get: async () => { throw Error('No such tab'); } } },
    notifyApply: async () => {}, noteCancelledJob: async jobId => { setAside.push(jobId); },
    giveBackChatTab: async () => {}, workerApiRequest: async (method, url, body) => { calls.push({ method, url, body }); return response; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'auto-apply-runner.js'), 'utf8'), context);
  return { api: context.self.__qtsAutoApply, saved, calls, errors, setAside, reply: value => { response = value; } };
}

test('Auto Apply recovery storage failures are reported and not shaped as a successful release', async () => {
  const f = fixture({}, true);
  await assert.rejects(f.api.releaseRun({ attemptId: 'a', jobId: 'j' }, 'Tab closed'), /Storage is unavailable/);
  assert.equal(f.calls.length, 0, 'do not release the claim before its checkpoint is safely stored');
  assert.equal(f.errors[0][0], 'Could not save Auto Apply recovery state.');
});

test('failed Auto Apply release is persisted, retried, and its checkpoint retained after success', async () => {
  const f = fixture();
  f.reply({ success: false, _httpStatus: 503 });
  assert.equal(await f.api.releaseRun({ attemptId: 'a', jobId: 'j', step: 2, used: { Question: { value: 'Saved answer' } } }, 'Tab closed'), false);
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, true);
  await assert.rejects(f.api.resumeRuns(), /retrying cleanup/);
  assert.equal(f.saved.qtsAutoApplyRuns.a.jobId, 'j');
  f.reply({ success: true });
  await f.api.resumeRuns();
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, false);
  assert.equal(f.saved.qtsAutoApplyRuns.a.paused, true);
  assert.equal(f.saved.qtsAutoApplyRuns.a.step, 2);
  assert.deepEqual(f.saved.qtsAutoApplyRuns.a.used, { Question: { value: 'Saved answer' } });
  assert.ok(f.calls.every(c => c.url.endsWith('/release') && c.body.mode === 'later'));
});

test('Cancel recovery releases and pauses unfinished runs with their checkpoint but never resubmits a submitted run', async () => {
  const checkpoint = { step: 3, used: { Question: { value: 'Saved answer' } }, checklist: [{ label: 'Question' }] };
  const f = fixture({ before: { attemptId: 'before', jobId: 'j1', ...checkpoint }, after: { attemptId: 'after', jobId: 'j2', submitted: true } });
  assert.equal(await f.api.recoverStoppedRuns(), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.attemptId, 'before');
  assert.equal(f.saved.qtsAutoApplyRuns.before.paused, true);
  assert.equal(f.saved.qtsAutoApplyRuns.before.pendingRelease, false);
  assert.equal(f.saved.qtsAutoApplyRuns.before.step, checkpoint.step);
  assert.deepEqual(f.saved.qtsAutoApplyRuns.before.used, checkpoint.used);
  assert.deepEqual(f.saved.qtsAutoApplyRuns.before.checklist, checkpoint.checklist);
  assert.equal(f.saved.qtsAutoApplyRuns.after.submitted, true);
  assert.equal(f.calls[0].body.mode, 'later');
});

test('a missing application tab is released automatically, keeping the checkpoint while offline and paused after release', async () => {
  const f = fixture({ a: { attemptId: 'a', jobId: 'j', tabId: 999, step: 2, used: { Question: { value: 'Saved answer' } } } });
  f.reply({ success: false, _httpStatus: 503 });
  await assert.rejects(f.api.resumeRuns(), /retrying cleanup/);
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, true);
  f.reply({ success: false, _httpStatus: 409 });
  await f.api.resumeRuns();
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, false);
  assert.equal(f.saved.qtsAutoApplyRuns.a.paused, true);
  assert.equal(f.saved.qtsAutoApplyRuns.a.step, 2);
  assert.deepEqual(f.saved.qtsAutoApplyRuns.a.used, { Question: { value: 'Saved answer' } });
  assert.ok(f.calls.every(c => c.url.endsWith('/release')));
});

const API_RUN = { attemptId: 'a', jobId: 'j', apiFlow: true, tabId: 999, step: 2, used: { Question: { value: 'An AI answer' } } };

test('Auto Apply with APIs: a job whose tab went while QTS restarted goes back unchanged and nothing of it stays here', async () => {
  const f = fixture({ a: structuredClone(API_RUN) });
  await f.api.resumeRuns();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.mode, 'drop');
  assert.equal(f.calls[0].body.appliedAnswers.length, 0);
  assert.deepEqual(f.saved.qtsAutoApplyRuns, {});
  assert.deepEqual(f.setAside, ['j'], 'this run goes on without it');
});

test('Auto Apply with APIs: stopped before Chrome restarted, the job goes back unchanged', async () => {
  const f = fixture({ a: structuredClone(API_RUN) });
  assert.equal(await f.api.recoverStoppedRuns(), true);
  assert.equal(f.calls[0].body.mode, 'drop');
  assert.deepEqual(f.saved.qtsAutoApplyRuns, {});
});

test('Auto Apply with APIs: a give-back that failed is retried the same way, then nothing stays', async () => {
  const f = fixture();
  f.reply({ success: false, _httpStatus: 503 });
  assert.equal(await f.api.releaseRun({ attemptId: 'a', jobId: 'j', apiFlow: true, releaseMode: 'drop' }, 'The tab was closed.', []), false);
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, true);
  f.reply({ success: true });
  assert.equal(await f.api.retryPendingReleases(), true);
  assert.deepEqual(f.calls.map(c => c.body.mode), ['drop', 'drop']);
  assert.deepEqual(f.saved.qtsAutoApplyRuns, {});
});

test('Auto Apply with APIs: a real failure still says why on the job', async () => {
  const f = fixture({ a: structuredClone(API_RUN) });
  assert.equal(await f.api.releaseRun({ attemptId: 'a', jobId: 'j', apiFlow: true, releaseMode: 'later' }, 'No way to the application form was found.', []), true);
  assert.equal(f.calls[0].body.mode, 'later');
  assert.equal(f.calls[0].body.reason, 'No way to the application form was found.');
  assert.deepEqual(f.saved.qtsAutoApplyRuns, {});
});

test('after a Chrome restart a submitted application is never replayed and cannot block the queue', async () => {
  const f = fixture({ a: { attemptId: 'a', jobId: 'j', tabId: 1, browserSession: 'old-chrome-session', submitted: true } });
  const runs = await f.api.resumeRuns();
  assert.equal(runs.length, 0);
  assert.equal(f.calls.length, 0, 'no release, Submit or confirmation request');
  assert.equal(Object.keys(f.saved.qtsAutoApplyRuns).length, 0, 'the existing server confirmation remains on Jobs, not in the work slot');
});
