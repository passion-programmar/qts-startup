const assert = require('node:assert/strict');
const test = require('node:test');
const { createSnapshot, formatText, mergeSnapshot, storageKey } = require('./scanner-job-context');

test('job context snapshots use saved job and selected Account identifiers', () => {
  const snapshot = createSnapshot({
    job: {
      id: 42,
      title: 'Program Coordinator',
      company: 'Resource Innovations',
      url: 'https://apply.workable.com/example/job/42',
      application_type: 'workable',
      description: 'Coordinate programs and reporting.',
    },
    account: { id: 101 },
    managerId: 7,
  });

  assert.equal(snapshot.jobId, 42);
  assert.equal(snapshot.accountId, 101);
  assert.equal(storageKey(snapshot), 'qtsScannerJobContext:7:101:42');
  assert.match(formatText(snapshot), /Job title: Program Coordinator/);
  assert.match(formatText(snapshot), /Company: Resource Innovations/);
  assert.match(formatText(snapshot), /Coordinate programs and reporting\./);
});

test('new job-context snapshots preserve a saved description when the current step has none', () => {
  const merged = mergeSnapshot(
    { title: 'Engineer', description: 'Saved job description' },
    { title: 'Engineer', description: '' }
  );
  assert.equal(merged.description, 'Saved job description');
});

test('job-context snapshots require persisted job and Account identifiers', () => {
  assert.throws(() => createSnapshot({ job: {}, account: {} }), /requires a saved job/);
});
