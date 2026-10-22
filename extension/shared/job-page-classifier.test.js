const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyJobPageEvidence } = require('./job-page-classifier');

test('structured JobPosting data identifies job details without a Gemini request', () => {
  assert.deepEqual(classifyJobPageEvidence({ hasJobPosting: true, urlType: 'unknown' }), {
    isJobPage: true,
    reason: 'structured_job_posting',
  });
});

test('job detail URLs still require visible job content', () => {
  assert.equal(classifyJobPageEvidence({
    urlType: 'detail',
    title: 'Senior Product Designer',
    headings: ['About the role'],
    description: 'A'.repeat(120),
  }).isJobPage, true);
  assert.equal(classifyJobPageEvidence({
    urlType: 'detail',
    title: 'About our team',
    headings: ['Our story', 'Contact'],
    description: 'A'.repeat(120),
  }).isJobPage, false);
});

test('job-list URLs are rejected unless structured job data exists', () => {
  assert.equal(classifyJobPageEvidence({
    urlType: 'list',
    title: 'Senior Engineer',
    headings: ['What You Will Do'],
    description: 'A'.repeat(500),
  }).isJobPage, false);
});

test('manager-configured detail URL rules can classify custom URL shapes using job content', () => {
  assert.equal(classifyJobPageEvidence({
    urlType: 'list',
    configuredDetailUrl: true,
    title: 'Platform Engineer',
    headings: ['About the role'],
    description: 'A'.repeat(120),
  }).isJobPage, true);
  assert.equal(classifyJobPageEvidence({
    urlType: 'list',
    configuredDetailUrl: true,
    title: 'Platform Engineer',
    headings: ['About the role'],
    description: 'Too short',
  }).isJobPage, false);
});

test('custom job pages can be identified from title, description, and multiple signals', () => {
  assert.equal(classifyJobPageEvidence({
    urlType: 'unknown',
    title: 'Platform Engineer',
    headings: ['What You Will Do', 'Nice to Have', 'Benefits'],
    description: 'A'.repeat(280),
  }).isJobPage, true);
});

test('generic career pages do not qualify from a title and one vague section', () => {
  assert.equal(classifyJobPageEvidence({
    urlType: 'unknown',
    title: 'Careers',
    headings: ['Location'],
    description: 'A'.repeat(400),
  }).isJobPage, false);
});
