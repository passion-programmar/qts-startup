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

test('keywords match whole words and phrases, with plurals, across languages', () => {
  const exclusions = loadPageExclusions();
  const count = (text, keywords) => exclusions.countPageDetectionKeywordMatches(text, keywords.map((url) => ({ url })));
  assert.equal(count('Open jobs at Acme', ['job']), 1);
  assert.equal(count('Jobless claims rose', ['job']), 0);
  assert.equal(count('International sales', ['intern']), 0);
  assert.equal(count('We hire interns', ['intern']), 1);
  assert.equal(count('5+ years\nof   experience', ['years of experience']), 1);
  assert.equal(count('What you’ll do', ["what you'll do"]), 1);
  assert.equal(count('Wymagania: doświadczenie', ['doświadczenie']), 1);
  assert.equal(count('Benefit: remote-first', ['remote']), 1);
});
