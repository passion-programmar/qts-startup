const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPageExclusions() {
  const context = vm.createContext({});
  context.self = context;
  context.URL = URL;
  const source = fs.readFileSync(path.join(__dirname, 'page-exclusions.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'page-exclusions.js' });
  return context.__qtsPageExclusions;
}

test('excluded page URLs are blocked case-insensitively', () => {
  const exclusions = loadPageExclusions();
  for (const url of [
    'https://qts-job-system.vercel.app/users',
    'https://www.linkedin.com/jobs/view/123',
    'https://justjoin.it/job-offers/example',
    'https://docs.google.com/document/d/123',
    'https://chatgpt.com/c/123',
  ]) {
    assert.equal(exclusions.shouldSkipPage(url), true, url);
  }
  assert.equal(exclusions.shouldSkipPage('https://jobs.example.com/role'), false);
});

test('Manager excluded URL job-page rules normalize valid domains and paths', () => {
  const exclusions = loadPageExclusions();
  assert.equal(exclusions.normalizePageExclusion('WWW.Example.com/Jobs/'), 'example.com/Jobs');
  assert.equal(exclusions.normalizePageExclusion('https://example.com'), 'example.com');
  assert.equal(exclusions.normalizePageExclusion('https://user:password@example.com'), null);
  assert.equal(exclusions.normalizePageExclusion('example.com/jobs?query=1'), null);
  assert.equal(exclusions.normalizePageExclusion('javascript:alert(1)'), null);
});

test('Manager excluded URL job-page rules match subdomains and path descendants only', () => {
  const exclusions = loadPageExclusions();
  assert.equal(exclusions.pageMatchesExclusion('https://www.example.com/jobs/123', 'example.com'), true);
  assert.equal(exclusions.pageMatchesExclusion('https://jobs.example.com/openings/123', 'example.com/openings'), true);
  assert.equal(exclusions.pageMatchesExclusion('https://example.com/jobs-old', 'example.com/jobs'), false);
  assert.equal(exclusions.pageMatchesExclusion('https://notexample.com/jobs', 'example.com'), false);
});
