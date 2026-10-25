const test = require('node:test');
const assert = require('node:assert/strict');
const { createGetJdSaveJob } = require('./get-jd-save-payload');

test('Get JD save payload restores the description returned beside the classification', () => {
  const savedJob = createGetJdSaveJob({
    job: {
      title: 'Senior Engineer',
      company: 'Example',
      location: 'Remote',
      employmentType: 'Full-time',
      workplaceType: 'Hybrid',
      salary: '$120,000 per year',
      country: 'Romania',
      reason: 'The posting allows remote work.',
      jobUrl: 'https://example.com/jobs/123',
    },
  }, 'Build reliable services.');

  assert.equal(savedJob.description, 'Build reliable services.');
  assert.equal(savedJob.country, 'Romania');
  assert.equal(savedJob.reason, 'The posting allows remote work.');
});

test('Get JD save payload keeps a job without a description so page text can be sent', () => {
  assert.equal(createGetJdSaveJob({ job: { title: 'Senior Engineer' } }, '').description, '');
  assert.equal(createGetJdSaveJob({}, 'Build services.'), null);
});
