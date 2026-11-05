const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../background/service-worker.js'), 'utf8');
function fixture(mode) {
  let result = { evaluationMode: mode, pageUrl: 'https://example.test/job', profiles: [{ id: 'one', state: 'available' }], classification: { isJobPage: true, isRemote: true, job: { title: 'Original', company: 'Original company', location: '', jobUrl: 'https://example.test/job' } }, jobDescription: 'Original JD' };
  const calls = []; const doneCalls = []; const closeCalls = [];
  const context = { URL, Date, self: { __qtsGetJdSavePayload: require('./get-jd-save-payload'), __qtsAccountAuth: { getWorkerAuthToken: async () => 'token' }, __qtsIdlePacing: { noteActivity: async () => {} } },
    updateGetJdSelection: async (_id, ids) => ({ ok: true, selectedProfileIds: ids }), readGetJdResultForTab: async () => structuredClone(result),
    saveGetJdResult: async (_id, next) => { result = next; }, getJdProfileState: p => p.state,
    tabOpenedFrom: async () => null, showGetJdDone: async (...args) => { doneCalls.push(args); },
    scheduleGetJdTabClose: async (...args) => { closeCalls.push(args); return 123; },
    workerApiRequest: async (_method, _path, body) => { calls.push(body); return { success: true, results: [{ profileId: 'one', status: 'saved' }] }; }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function saveGetJdSelection('), source.indexOf('const GET_JD_AUTO_CLOSE_KEY')), context);
  return { context, calls, doneCalls, closeCalls };
}
const edited = { title: 'Correct title', company: 'Correct company', jobUrl: 'https://example.test/correct', description: 'Correct JD' };
test('manual save sends corrected URL, title, company and JD', async () => {
  const f = fixture('manual');
  const response = await f.context.saveGetJdSelection(1, ['one'], edited);
  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'saved');
  assert.equal(response.result.saveResponse.savedCount, 1);
  assert.equal(response.result.closeAfterSeconds, 2);
  assert.equal(f.closeCalls[0][0], 1);
  assert.equal(f.closeCalls[0][1], 'https://example.test/job');
  assert.equal(f.closeCalls[0][2], 2);
  assert.equal(f.closeCalls[0][3].force, true);
  assert.equal(f.doneCalls.length, 0, 'manual save does not show the top-left launcher alert');
  for (const key of Object.keys(edited)) assert.equal(f.calls[0].job[key], edited[key]);
});
test('Gemini ignores manual edits and preserves original extracted details', async () => {
  const f = fixture('gemini');
  const response = await f.context.saveGetJdSelection(1, ['one'], edited);
  assert.equal(response.ok, true);
  assert.equal(response.result.status, 'saved');
  assert.equal(response.result.closeAfterSeconds, 0);
  assert.equal(f.closeCalls.length, 0);
  assert.equal(f.doneCalls.length, 1, 'Gemini keeps its existing completion alert');
  assert.equal(f.calls[0].job.title, 'Original'); assert.equal(f.calls[0].job.description, 'Original JD');
});
test('partial save returns the outcome for the review panel to display', async () => {
  const f = fixture('manual');
  f.context.workerApiRequest = async () => ({
    success: true,
    results: [{ profileId: 'one', status: 'failed', message: 'Save rejected.' }],
  });
  const response = await f.context.saveGetJdSelection(1, ['one'], edited);
  assert.equal(response.ok, false);
  assert.match(response.error, /could not be saved/i);
  assert.equal(response.result.status, 'complete');
  assert.equal(response.result.saveResponse.failedCount, 1);
});
test('invalid manual details never reach save API', async () => {
  for (const patch of [{ jobUrl: 'javascript:alert(1)' }, { title: ' ' }, { company: '' }, { description: 'x'.repeat(100001) }]) {
    const f = fixture('manual'); assert.equal((await f.context.saveGetJdSelection(1, ['one'], { ...edited, ...patch })).ok, false); assert.equal(f.calls.length, 0);
  }
});
