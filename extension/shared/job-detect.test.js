const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyJobPageUrl,
  isValidGetJdCheckJob,
  mergeJobExtractionSamples,
  mergeMissingJobDetails,
  usablePartialJobDetails,
} = require('./job-detect');

test('job URL detail mode comes only from the configured Manager job-page match rules', () => {
  assert.equal(
    classifyJobPageUrl('https://www.sentinelone.com/jobs/?gh_jid=7731266003'),
    'unknown',
  );
  assert.equal(
    classifyJobPageUrl('https://jobs.anyoneai.com/?ashby_jid=e80c2c62-6895-41f5-bf9d-89ae5207d2bf'),
    'unknown',
  );
  assert.equal(classifyJobPageUrl('https://jobs.example.com/search'), 'unknown');
  assert.equal(classifyJobPageUrl('https://jobs.example.com/search', true), 'detail');
  assert.equal(classifyJobPageUrl('not-a-url', true), 'unknown');
});

test('Get JD check requires complete API-ready extracted job details', () => {
  const job = {
    title: 'Senior Engineer',
    company: 'Example',
    description: 'A'.repeat(80),
    url: 'https://example.com/jobs/123',
  };

  assert.equal(isValidGetJdCheckJob(job), true);
  assert.equal(isValidGetJdCheckJob({ ...job, company: '' }), false);
  assert.equal(isValidGetJdCheckJob({ ...job, company: 'x'.repeat(501) }), false);
  assert.equal(isValidGetJdCheckJob({ ...job, title: 'x'.repeat(501) }), false);
  assert.equal(isValidGetJdCheckJob({ ...job, url: `https://example.com/${'x'.repeat(2048)}` }), false);
  assert.equal(isValidGetJdCheckJob({ ...job, description: 'Too short' }), false);
});

test('missing extracted job details are filled without replacing saved values', () => {
  const merged = mergeMissingJobDetails({
    title: 'Saved title',
    company: 'Saved company',
    description: '',
    location: '',
    country: '',
    employmentType: '',
    workplaceType: '',
    salary: '',
    url: 'https://apply.workable.com/example/j/123',
    source: 'workable',
  }, {
    title: 'Detected title',
    company: 'Detected company',
    description: 'Description extracted from the page.',
    location: 'Riga, Latvia',
    country: 'Latvia',
    employmentType: 'Full-time',
    workplaceType: 'Hybrid',
    salary: 'EUR 60,000-80,000 per year',
    url: 'https://apply.workable.com/example/j/456',
    source: 'other',
  });

  assert.deepEqual(merged, {
    title: 'Saved title',
    company: 'Saved company',
    description: 'Description extracted from the page.',
    location: 'Riga, Latvia',
    country: 'Latvia',
    employmentType: 'Full-time',
    workplaceType: 'Hybrid',
    salary: 'EUR 60,000-80,000 per year',
    url: 'https://apply.workable.com/example/j/123',
    source: 'workable',
  });
});

test('missing extracted values stay empty when the page did not provide them', () => {
  const merged = mergeMissingJobDetails({
    title: '',
    company: '',
    description: '',
    location: '',
    country: '',
    employmentType: '',
    workplaceType: '',
    salary: '',
    url: 'https://apply.workable.com/example/j/123',
    source: '',
  }, {
    title: '   ',
    company: '',
    description: '',
    location: '',
    country: '',
    employmentType: '',
    workplaceType: '',
    salary: '',
    url: '',
    source: 'workable',
  });

  assert.deepEqual(merged, {
    title: '',
    company: '',
    description: '',
    location: '',
    country: '',
    employmentType: '',
    workplaceType: '',
    salary: '',
    url: 'https://apply.workable.com/example/j/123',
    source: 'workable',
  });
});

test('progressive page captures retain the most complete job details', () => {
  const first = mergeJobExtractionSamples(null, {
    title: 'Jobs',
    company: '',
    description: '',
    location: '',
    country: '',
    employmentType: '',
    workplaceType: '',
    salary: '',
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
  assert.equal(merged.location, '');
  assert.equal(merged.country, '');
  assert.equal(merged.employmentType, '');
  assert.equal(merged.workplaceType, '');
  assert.equal(merged.salary, '');
  assert.equal(merged.url, 'https://apply.workable.com/example/j/123');
  assert.equal(merged.source, 'workable');
});

test('partial extraction exposes useful details but filters generic page headings', () => {
  assert.deepEqual(usablePartialJobDetails({
    title: 'Careers',
    company: 'Resource Innovations',
    description: '',
    location: '',
    country: '',
    employmentType: '',
    workplaceType: '',
    salary: '',
    url: 'https://apply.workable.com/example/j/123',
  }), {
    data: {
      title: '',
      company: 'Resource Innovations',
      description: '',
      location: '',
      country: '',
      employmentType: '',
      workplaceType: '',
      salary: '',
      url: 'https://apply.workable.com/example/j/123',
      source: '',
    },
    hasDetails: true,
  });
  assert.equal(usablePartialJobDetails({
    title: 'Jobs',
    company: '',
    description: '',
    location: '',
  }).hasDetails, false);
});

test('location-only extraction is retained as useful partial job data', () => {
  const partial = usablePartialJobDetails({
    title: '',
    company: '',
    description: '',
    location: 'Latvia',
  });

  assert.equal(partial.data.location, 'Latvia');
  assert.equal(partial.hasDetails, true);
});
