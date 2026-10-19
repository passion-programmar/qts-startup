const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeJobExtractionSamples,
  mergeMissingJobDetails,
  usablePartialJobDetails,
} = require('./job-detect');

test('missing extracted job details are filled without replacing saved values', () => {
  const merged = mergeMissingJobDetails({
    title: 'Saved title',
    company: 'Saved company',
    description: '',
    url: 'https://apply.workable.com/example/j/123',
    source: 'workable',
  }, {
    title: 'Detected title',
    company: 'Detected company',
    description: 'Description extracted from the page.',
    url: 'https://apply.workable.com/example/j/456',
    source: 'other',
  });

  assert.deepEqual(merged, {
    title: 'Saved title',
    company: 'Saved company',
    description: 'Description extracted from the page.',
    url: 'https://apply.workable.com/example/j/123',
    source: 'workable',
  });
});

test('missing extracted values stay empty when the page did not provide them', () => {
  const merged = mergeMissingJobDetails({
    title: '',
    company: '',
    description: '',
    url: 'https://apply.workable.com/example/j/123',
    source: '',
  }, {
    title: '   ',
    company: '',
    description: '',
    url: '',
    source: 'workable',
  });

  assert.deepEqual(merged, {
    title: '',
    company: '',
    description: '',
    url: 'https://apply.workable.com/example/j/123',
    source: 'workable',
  });
});

test('progressive page captures retain the most complete job details', () => {
  const first = mergeJobExtractionSamples(null, {
    title: 'Jobs',
    company: '',
    description: '',
    url: '',
    source: 'workable',
  }, 'https://apply.workable.com/example/j/123');
  const merged = mergeJobExtractionSamples(first, {
    title: 'Program Coordinator',
    company: 'Resource Innovations',
    description: 'A'.repeat(100),
    url: '',
    source: '',
  }, 'https://apply.workable.com/example/j/123');

  assert.equal(merged.title, 'Program Coordinator');
  assert.equal(merged.company, 'Resource Innovations');
  assert.equal(merged.description.length, 100);
  assert.equal(merged.url, 'https://apply.workable.com/example/j/123');
  assert.equal(merged.source, 'workable');
});

test('partial extraction exposes useful details but filters generic page headings', () => {
  assert.deepEqual(usablePartialJobDetails({
    title: 'Careers',
    company: 'Resource Innovations',
    description: '',
    url: 'https://apply.workable.com/example/j/123',
  }), {
    data: {
      title: '',
      company: 'Resource Innovations',
      description: '',
      url: 'https://apply.workable.com/example/j/123',
      source: '',
    },
    hasDetails: true,
  });
  assert.equal(usablePartialJobDetails({
    title: 'Jobs',
    company: '',
    description: '',
  }).hasDetails, false);
});
