const assert = require('node:assert/strict');
const test = require('node:test');
const detection = require('./job-page-detection.js');
const { countPageDetectionKeywordMatches } = require('./page-exclusions.js');

const keywords = ['responsibilities', 'qualifications', 'apply now', 'remote'].map((url) => ({ url }));
const evaluate = (snapshot, rules = keywords) => detection.evaluateJobPage(
  { url: 'https://example.com/article', text: '', headingMatches: 0, jobLinkCount: 0, ...snapshot },
  rules,
  countPageDetectionKeywordMatches,
);

test('two Manager keywords always pass, as before', () => {
  const result = evaluate({ text: 'Responsibilities and qualifications for this role' });
  assert.equal(result.isJobPage, true);
  assert.equal(result.reason, 'keywords');
});

test('structured JobPosting data passes even without keywords', () => {
  assert.equal(evaluate({ hasJobPostingData: true }, []).isJobPage, true);
});

test('job signals pass a page that has no Manager keywords', () => {
  const result = evaluate({
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    hasApplyControl: true,
  }, []);
  assert.equal(result.isJobPage, true);
  assert.equal(result.reason, 'score');
});

test('one strong signal plus one keyword passes', () => {
  assert.equal(evaluate({ text: 'Remote role', hasApplyControl: true }).isJobPage, true);
});

test('ordinary pages and a single weak signal are rejected', () => {
  assert.equal(evaluate({ text: 'Breaking news about remote work' }).isJobPage, false);
  assert.equal(evaluate({ url: 'https://acme.com/careers/' }, []).isJobPage, false);
});

test('closed or expired postings are rejected even with keywords', () => {
  const result = evaluate({
    text: 'Responsibilities, qualifications. No longer accepting applications.',
    hasJobPostingData: true,
  });
  assert.equal(result.isJobPage, false);
  assert.equal(result.reason, 'closed');
});

test('a closed notice that the page does not show does not reject it', () => {
  const result = evaluate({
    text: 'Responsibilities, qualifications. No longer accepting applications.',
    visibleText: 'Responsibilities, qualifications.',
    hasJobPostingData: true,
  });
  assert.equal(result.isJobPage, true);
});

test('job lists are penalized, but a list with a selected job is judged on that job', () => {
  const list = { url: 'https://www.linkedin.com/jobs/search/?keywords=engineer', hasApplyControl: true, headingMatches: 2, jobLinkCount: 25 };
  assert.equal(evaluate(list, []).isJobPage, true);
  assert.equal(evaluate({ ...list, headingMatches: 0 }, []).isJobPage, false);
  assert.equal(evaluate({ ...list, headingMatches: 0, url: `${list.url}&currentJobId=4012345678` }, []).isJobPage, true);
});

test('an embedded job board frame counts as a job signal', () => {
  const embeddingPage = { url: 'https://acme.com/careers?gh_jid=7781234', hasJobBoardFrame: true };
  assert.equal(evaluate(embeddingPage, []).isJobPage, true);
  assert.equal(evaluate({ url: 'https://acme.com/about', hasJobBoardFrame: true }, []).isJobPage, false);
});
