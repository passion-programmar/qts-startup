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

test('job-detection URL rules normalize domains and paths safely', () => {
  const rules = loadRules();
  assert.equal(rules.normalizeJobDetectionUrlRule('WWW.Example.com/Jobs/'), 'example.com/Jobs');
  assert.equal(rules.normalizeJobDetectionUrlRule('https://example.com'), 'example.com');
  assert.equal(rules.normalizeJobDetectionUrlRule('example.com/jobs?query=1'), null);
  assert.equal(rules.normalizeJobDetectionUrlRule('javascript:alert(1)'), null);
});

test('job-detection blocking rules match only the configured host and path descendants', () => {
  const rules = loadRules();
  assert.equal(rules.jobDetectionUrlRuleMatches('https://jobs.example.com/openings/123', 'example.com/openings'), true);
  assert.equal(rules.jobDetectionUrlRuleMatches('https://example.com/jobs-old', 'example.com/jobs'), false);
  assert.equal(rules.jobDetectionUrlRuleMatches('https://notexample.com/jobs', 'example.com'), false);
});
