const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(records = {}) {
  const saved = { qtsAutoApplyRuns: records };
  const calls = [];
  let response = { success: true };
  const session = {};
  const context = vm.createContext({ self: {}, EXTENSION_STATUS_KEY: 'qtsExtensionStatus', console, crypto: require('node:crypto').webcrypto,
    chrome: { storage: { local: { get: async key => ({ [key]: saved[key] }), set: async values => Object.assign(saved, structuredClone(values)) }, session: { get: async key => ({ [key]: session[key] }), set: async values => Object.assign(session, values) }, onChanged: { addListener() {} } }, tabs: { get: async () => { throw Error('No such tab'); } } },
    notifyApply: async () => {},
    giveBackChatTab: async () => {}, workerApiRequest: async (method, url, body) => { calls.push({ method, url, body }); return response; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'auto-apply-runner.js'), 'utf8'), context);
  return { api: context.self.__qtsAutoApply, saved, calls, reply: value => { response = value; } };
}

test('failed Auto Apply release is persisted, retried, and cleared automatically after success', async () => {
  const f = fixture();
  f.reply({ success: false, _httpStatus: 503 });
  assert.equal(await f.api.releaseRun({ attemptId: 'a', jobId: 'j' }, 'Tab closed'), false);
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, true);
  await assert.rejects(f.api.resumeRuns(), /retrying cleanup/);
  assert.equal(f.saved.qtsAutoApplyRuns.a.jobId, 'j');
  f.reply({ success: true });
  await f.api.resumeRuns();
  assert.equal(Object.keys(f.saved.qtsAutoApplyRuns).length, 0);
  assert.ok(f.calls.every(c => c.url.endsWith('/release') && c.body.mode === 'later'));
});

test('Cancel recovery releases unfinished saved runs but never releases or resubmits a submitted run', async () => {
  const f = fixture({ before: { attemptId: 'before', jobId: 'j1' }, after: { attemptId: 'after', jobId: 'j2', submitted: true } });
  assert.equal(await f.api.recoverStoppedRuns(), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.attemptId, 'before');
  assert.equal(f.saved.qtsAutoApplyRuns.after.submitted, true);
  assert.equal(f.saved.qtsAutoApplyRuns.before, undefined);
});

test('a missing application tab is released automatically, with its record kept while offline', async () => {
  const f = fixture({ a: { attemptId: 'a', jobId: 'j', tabId: 999 } });
  f.reply({ success: false, _httpStatus: 503 });
  await assert.rejects(f.api.resumeRuns(), /retrying cleanup/);
  assert.equal(f.saved.qtsAutoApplyRuns.a.pendingRelease, true);
  f.reply({ success: false, _httpStatus: 409 });
  await f.api.resumeRuns();
  assert.equal(Object.keys(f.saved.qtsAutoApplyRuns).length, 0, 'already released or no longer owned does not block recovery');
  assert.ok(f.calls.every(c => c.url.endsWith('/release')));
});

test('after a Chrome restart a submitted application is never replayed and cannot block the queue', async () => {
  const f = fixture({ a: { attemptId: 'a', jobId: 'j', tabId: 1, browserSession: 'old-chrome-session', submitted: true } });
  const runs = await f.api.resumeRuns();
  assert.equal(runs.length, 0);
  assert.equal(f.calls.length, 0, 'no release, Submit or confirmation request');
  assert.equal(Object.keys(f.saved.qtsAutoApplyRuns).length, 0, 'the existing server confirmation remains on Jobs, not in the work slot');
});
