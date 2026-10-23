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
