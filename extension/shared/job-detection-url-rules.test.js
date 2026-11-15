const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRules() {
  const context = vm.createContext({ URL });
  context.self = context;
  const source = fs.readFileSync(path.join(__dirname, 'job-detection-url-rules.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'job-detection-url-rules.js' });
  return context.__qtsJobDetectionUrlRules;
}

test('blocked URL rules normalize literal fragments safely', () => {
  const rules = loadRules();
  assert.equal(rules.normalizeJobDetectionUrlRule(' Example.COM/Jobs?remote=true '), 'example.com/jobs?remote=true');
  assert.equal(rules.normalizeJobDetectionUrlRule(''), null);
  assert.equal(rules.normalizeJobDetectionUrlRule('bad\nfragment'), null);
});

test('blocked URL rules use case-insensitive substring matching', () => {
  const rules = loadRules();
  assert.equal(rules.jobDetectionUrlRuleMatches('https://jobs.example.com/openings/123', 'example.com/openings'), true);
  assert.equal(rules.jobDetectionUrlRuleMatches('https://example.com/jobs-old', '/JOBS-'), true);
  assert.equal(rules.jobDetectionUrlRuleMatches('https://notexample.com/jobs', 'jobs.example.com'), false);
});

test('Get JD skip sites match the exact host (www ignored) and an optional path start', () => {
  const rules = loadRules();
  const skips = (url, site) => rules.skipSiteMatches(url, site);
  assert.equal(skips('https://www.youtube.com/watch?v=1', 'youtube.com'), true);
  assert.equal(skips('https://YOUTUBE.com/', 'youtube.com'), true);
  assert.equal(skips('https://www.linkedin.com/feed/', 'linkedin.com/feed'), true);
  assert.equal(skips('https://www.linkedin.com/in/someone', 'linkedin.com/in/'), true);
  // A job on the same site is not skipped when only part of the site is listed.
  assert.equal(skips('https://www.linkedin.com/jobs/view/123', 'linkedin.com/feed'), false);
  assert.equal(skips('https://www.linkedin.com/jobs/view/123', 'linkedin.com/in/'), false);
  // Other subdomains are separate sites: a careers subdomain is never caught.
  assert.equal(skips('https://careers.x.com/job/1', 'x.com'), false);
  assert.equal(skips('https://jobs.netflix.com/jobs/1', 'netflix.com/browse'), false);
  assert.equal(skips('https://notyoutube.com/', 'youtube.com'), false);
  assert.equal(skips('chrome://settings', 'settings'), false);
  assert.equal(skips('not a url', 'youtube.com'), false);
  assert.equal(skips('https://youtube.com/', ''), false);
});
