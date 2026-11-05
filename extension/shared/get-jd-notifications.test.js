const assert = require('node:assert/strict');
const test = require('node:test');
const { recordResult, summarizeBatch, recentResults, launcherBatch, resultDetails, sessionKey } = require('./get-jd-notifications.js');

const result = (runId, status, extra = {}) => ({
  runId, status, evaluationMode: 'gemini', pageUrl: `https://jobs.example/${runId}`, updatedAt: 1000, ...extra,
});

test('distinct results within two seconds share one accurately counted batch', () => {
  let state;
  for (const [tabId, runId, status] of [
    [1, 'one', 'complete'],
    [2, 'two', 'error'],
    [3, 'three', 'duplicate'],
  ]) {
    state = recordResult(state, result(runId, status, status === 'complete' ? { evaluationMode: 'manual' } : {}), tabId, 1000 + (tabId * 400)).state;
  }

  assert.equal(state.batch.items.length, 3);
  assert.deepEqual(summarizeBatch(state.batch), { success: 0, failed: 1, skipped: 1, processing: 0, cancelled: 0, review: 1, partial: 0 });
});

test('processing and terminal updates replace one operation instead of double counting', () => {
  let state = recordResult(undefined, result('same-run', 'processing'), 1, 1000).state;
  const updated = recordResult(state, result('same-run', 'saved'), 1, 1400);
  state = updated.state;

  assert.equal(updated.changed, true);
  assert.equal(state.history.length, 1);
  assert.equal(state.batch.items.length, 1);
  assert.deepEqual(summarizeBatch(state.batch), { success: 1, failed: 0, skipped: 0, processing: 0, cancelled: 0, review: 0, partial: 0 });
  assert.equal(recordResult(state, result('same-run', 'saved'), 1, 1500).changed, false);
});

test('failed automatic or manual saves count as failed despite a complete extraction status', () => {
  const manual = recordResult(undefined, result('manual-run', 'complete', { saveError: 'Save failed.' }), 1, 1000).state;
  const automatic = recordResult(manual, result('auto-run', 'complete', { autoSaveFailureCount: 1 }), 2, 1200).state;

  assert.deepEqual(summarizeBatch(automatic.batch), {
    success: 0, failed: 2, skipped: 0, processing: 0, cancelled: 0, review: 0, partial: 0,
  });
});

test('cancelled operations replace processing state without being counted as skipped', () => {
  let state = recordResult(undefined, result('cancelled-run', 'processing'), 1, 1000).state;
  state = recordResult(state, result('cancelled-run', 'cancelled'), 1, 1200).state;

  assert.equal(state.batch.items[0].status, 'cancelled');
  assert.deepEqual(summarizeBatch(state.batch), {
    success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 1, review: 0, partial: 0,
  });
});

test('history is bounded to the last twenty operations and unsupported states are ignored', () => {
  let state;
  for (let index = 0; index < 22; index += 1) {
    state = recordResult(state, result(`run-${index}`, 'complete'), index, 1000 + index * 10).state;
  }
  const unchanged = recordResult(state, result('unknown-run', 'unknown'), 99, 2000);

  assert.equal(state.history.length, 20);
  assert.equal(state.history[0].runId, 'run-2');
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.state, state);
});

test('new results after the aggregation window begin a fresh batch', () => {
  let state = recordResult(undefined, result('first', 'complete'), 1, 1000).state;
  const firstBatchId = state.batch.id;
  state = recordResult(state, result('second', 'error'), 2, 3000).state;

  assert.notEqual(state.batch.id, firstBatchId);
  assert.equal(state.batch.items.length, 1);
  assert.deepEqual(summarizeBatch(state.batch), {
    success: 0, failed: 1, skipped: 0, processing: 0, cancelled: 0, review: 0, partial: 0,
  });
});

test('latest three completed job results persist while processing bursts cannot push them out', () => {
  let state;
  for (let index = 0; index < 5; index++) state = recordResult(state, result(`done-${index}`, 'saved'), index).state;
  assert.deepEqual(recentResults(state).map((entry) => entry.runId), ['done-4', 'done-3', 'done-2']);
  for (let index = 0; index < 25; index++) state = recordResult(state, result(`pending-${index}`, 'processing'), index + 10).state;
  assert.equal(state.history.length, 20);
  assert.deepEqual(recentResults(state).map((entry) => entry.runId), ['done-4', 'done-3', 'done-2']);
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(recentResults(restored), recentResults(state));
});

test('manual results are not shown as Get JD launcher sub-items', () => {
  let state = recordResult(undefined, result('gemini-run', 'saved'), 1, 1000).state;
  state = recordResult(state, result('manual-run', 'complete', { evaluationMode: 'manual' }), 2, 1100).state;
  state = recordResult(state, result('legacy-manual-run', 'complete', { evaluationMode: undefined }), 3, 1200).state;

  assert.deepEqual(recentResults(state).map((entry) => entry.runId), ['gemini-run']);
  assert.equal(state.history.find((entry) => entry.runId === 'manual-run').evaluationMode, 'manual');
  assert.equal(state.history.find((entry) => entry.runId === 'legacy-manual-run').evaluationMode, 'manual');
});

test('manual Get JD results are omitted from launcher alert batches', () => {
  const manual = recordResult(undefined, result('manual-run', 'processing', { evaluationMode: 'manual' }), 1, 1000).state;
  assert.equal(launcherBatch(manual.batch), null);

  const mixed = {
    ...manual.batch,
    items: [
      ...manual.batch.items,
      recordResult(undefined, result('gemini-run', 'processing'), 2, 1100).state.batch.items[0],
    ],
  };
  assert.deepEqual(launcherBatch(mixed).items.map((entry) => entry.runId), ['gemini-run']);
});

test('manual review, actual saves, partial saves and selection removals have honest labels', () => {
  assert.equal(resultDetails(result('review', 'complete', { evaluationMode: 'manual' })).outcome, 'review');
  assert.equal(resultDetails(result('saved', 'complete', { autoSavedProfileIds: ['a', 'b'] })).label, 'Saved for 2 accounts');
  const partial = result('partial', 'complete', { autoSavedProfileIds: ['a'], autoSaveFailureCount: 2 });
  const state = recordResult(null, partial, 1).state;
  assert.equal(state.history[0].outcome, 'partial');
  assert.deepEqual(summarizeBatch(state.batch), { success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 0, review: 0, partial: 1 });
  assert.equal(resultDetails(result('remove', 'saved', { autoSavedProfileIds: ['old'], saveResponse: { removedCount: 1, savedCount: 0 } })).label, 'Selection updated');
  assert.equal(resultDetails(result('none', 'complete', { evaluationMode: 'gemini' })).outcome, 'skipped');
  const retried = recordResult(state, result('partial', 'saved', { autoSaveFailureCount: 2, saveResponse: { savedCount: 1, failedCount: 0 } }), 1).state;
  assert.equal(recentResults(retried)[0].outcome, 'saved');
  assert.equal(summarizeBatch(retried.batch).success, 1);
});

test('one operation updates its card on saving and details changes are retained even if the message is unchanged', () => {
  let state = recordResult(null, result('run', 'complete'), 1).state;
  state = recordResult(state, result('run', 'complete', { autoSavedProfileIds: ['a'], classification: { job: { title: 'Engineer', company: 'Example' } } }), 1).state;
  assert.equal(state.history.length, 1);
  assert.equal(recentResults(state)[0].label, 'Saved for 1 account');
  assert.equal(recentResults(state)[0].company, 'Example');
  state = recordResult(state, result('run', 'complete', { saveError: 'Please retry saving.' }), 1).state;
  assert.equal(recentResults(state)[0].message, 'Please retry saving.');
});

test('history from another Manager session is not shown', () => {
  const auth = { authExpiresAt: 9999, qtsSessionUser: { id: 'manager' } };
  const state = { ...recordResult(null, result('run', 'saved'), 1).state, ownerKey: sessionKey(auth) };
  assert.equal(recentResults(state, auth).length, 1);
  assert.equal(recentResults(state, { ...auth, qtsSessionUser: { id: 'other' } }).length, 0);
});
