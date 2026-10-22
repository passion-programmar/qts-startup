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
      jobUrl: 'https://example.com/jobs/123',
    },
  }, 'Build reliable services.');

  assert.equal(savedJob.description, 'Build reliable services.');
});

test('Get JD save payload rejects a missing description', () => {
  assert.equal(createGetJdSaveJob({ job: { title: 'Senior Engineer' } }, ''), null);
});
