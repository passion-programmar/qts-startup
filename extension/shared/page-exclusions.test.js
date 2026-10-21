const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPageExclusions() {
  const context = vm.createContext({});
  context.self = context;
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
