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

test('page matching has no built-in URL blocklist', () => {
  const exclusions = loadPageExclusions();
  assert.equal('excludedUrlParts' in exclusions, false);
  assert.equal('shouldSkipPage' in exclusions, false);
});

test('Manager job-page detection keywords normalize case and whitespace', () => {
  const exclusions = loadPageExclusions();
  assert.equal(exclusions.normalizePageDetectionKeyword('  Job   Description  '), 'job description');
  assert.equal(exclusions.normalizePageDetectionKeyword('a'), null);
  assert.equal(exclusions.normalizePageDetectionKeyword('bad\nkeyword'), null);
});

test('a job page requires two distinct configured keywords in visible text', () => {
  const exclusions = loadPageExclusions();
  const rules = [{ url: 'responsibilities' }, { url: 'qualifications' }, { url: 'apply now' }];
  assert.equal(exclusions.countPageDetectionKeywordMatches('Responsibilities and QUALIFICATIONS', rules), 2);
  assert.equal(exclusions.pageHasJobDetectionSignals('Responsibilities and qualifications', rules), true);
  assert.equal(exclusions.pageHasJobDetectionSignals('Responsibilities only', rules), false);
});
