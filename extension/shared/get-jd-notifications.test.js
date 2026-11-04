const assert = require('node:assert/strict');
const test = require('node:test');
const { recordResult, summarizeBatch } = require('./get-jd-notifications.js');

const result = (runId, status, extra = {}) => ({
  runId, status, pageUrl: `https://jobs.example/${runId}`, updatedAt: 1000, ...extra,
});

test('distinct results within two seconds share one accurately counted batch', () => {
  let state;
  for (const [tabId, runId, status] of [
    [1, 'one', 'complete'],
    [2, 'two', 'error'],
    [3, 'three', 'duplicate'],
  ]) {
    state = recordResult(state, result(runId, status), tabId, 1000 + (tabId * 400)).state;
  }

  assert.equal(state.batch.items.length, 3);
  assert.deepEqual(summarizeBatch(state.batch), { success: 1, failed: 1, skipped: 1, processing: 0, cancelled: 0 });
});

test('processing and terminal updates replace one operation instead of double counting', () => {
  let state = recordResult(undefined, result('same-run', 'processing'), 1, 1000).state;
  const updated = recordResult(state, result('same-run', 'saved'), 1, 1400);
  state = updated.state;

  assert.equal(updated.changed, true);
  assert.equal(state.history.length, 1);
  assert.equal(state.batch.items.length, 1);
  assert.deepEqual(summarizeBatch(state.batch), { success: 1, failed: 0, skipped: 0, processing: 0, cancelled: 0 });
  assert.equal(recordResult(state, result('same-run', 'saved'), 1, 1500).changed, false);
});

test('failed automatic or manual saves count as failed despite a complete extraction status', () => {
  const manual = recordResult(undefined, result('manual-run', 'complete', { saveError: 'Save failed.' }), 1, 1000).state;
  const automatic = recordResult(manual, result('auto-run', 'complete', { autoSaveFailureCount: 1 }), 2, 1200).state;

  assert.deepEqual(summarizeBatch(automatic.batch), {
    success: 0, failed: 2, skipped: 0, processing: 0, cancelled: 0,
  });
});

test('cancelled operations replace processing state without being counted as skipped', () => {
  let state = recordResult(undefined, result('cancelled-run', 'processing'), 1, 1000).state;
  state = recordResult(state, result('cancelled-run', 'cancelled'), 1, 1200).state;

  assert.equal(state.batch.items[0].status, 'cancelled');
  assert.deepEqual(summarizeBatch(state.batch), {
    success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 1,
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
    success: 0, failed: 1, skipped: 0, processing: 0, cancelled: 0,
  });
});
