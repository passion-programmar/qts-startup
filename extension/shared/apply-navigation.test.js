const assert = require('node:assert/strict');
const test = require('node:test');
const { hostedBoardApply, sameJobPage } = require('./apply-recipes.js');

test('a job board\'s own application is recognised', () => {
  for (const url of [
    'https://smartapply.indeed.com/beta/indeedapply/form/resume',
    'https://m5.apply.indeed.com/x',
    'https://uk.indeed.com/applystart?jk=1',
    'https://www.linkedin.com/jobs/view/123/apply/?openSDUIApplyFlow=true',
    'https://www.linkedin.com/job-apply/123',
    'https://www.glassdoor.com/job/easy-apply/x',
    'https://www.ziprecruiter.com/apply/1',
  ]) assert.equal(hostedBoardApply(url), true, url);
});

test('job pages and employer sites are not', () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/123',
    'https://www.indeed.com/viewjob?jk=1',
    'https://www.glassdoor.com/job-listing/x',
    'https://jobs.lever.co/acme/1/apply',
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply',
    '',
  ]) assert.equal(hostedBoardApply(url), false, url);
});

const job = { savedUrl: 'https://www.indeed.com/viewjob?jk=1', company: 'Globex GmbH', title: 'Senior Backend Engineer' };
const page = (url, title, text = '') => ({ url, title, text });

test('a page on the saved link\'s own site is the job', () => {
  assert.equal(sameJobPage({ ...job, page: page('https://uk.indeed.com/x', 'Anything') }), true);
});

test('another site must name the company or most of the title', () => {
  assert.equal(sameJobPage({ ...job, page: page('https://jobs.lever.co/globex/1/apply', 'Apply') }), true, 'company in the address');
  assert.equal(sameJobPage({ ...job, page: page('https://ats.example/1', 'Application', 'Join Globex today') }), true, 'company in the text');
  assert.equal(sameJobPage({ ...job, page: page('https://ats.example/1', 'Backend Engineer - Apply') }), true, 'the job title');
  assert.equal(sameJobPage({ ...job, page: page('https://ats.example/1', 'Accountant at Initech', 'Join our finance team') }), false);
});

test('generic words prove nothing', () => {
  const generic = { savedUrl: 'https://a.example/1', company: 'Global Solutions Group', title: 'Engineer' };
  assert.equal(sameJobPage({ ...generic, page: page('https://b.example/1', 'Global careers', 'solutions for every group') }), false);
});

test('an unreadable page is no evidence against it', () => {
  assert.equal(sameJobPage({ ...job, page: null }), true);
});
