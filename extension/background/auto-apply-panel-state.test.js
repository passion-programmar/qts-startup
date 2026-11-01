const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('the Auto Apply sidebar receives complete answer and profile display values', () => {
  const source = fs.readFileSync(path.join(__dirname, 'apply-runner.js'), 'utf8');
  const start = source.indexOf('  const reviewState = (mode, extra = {}) => ({', source.indexOf('async function runApplication('));
  const code = source.slice(start, source.indexOf('  const report =', start)).replace('const reviewState =', 'globalThis.reviewState =');
  const value = 'Complete engineering answer. '.repeat(40), intended = 'Original profile fact. '.repeat(30);
  for (const auto of [true, false]) {
    const context = vm.createContext({ auto, application: { candidate: {}, job: {} }, review: {},
      answersUsed: { Question: { value, intended, fact: 'location' } }, unresolved: new Map(), provisional: new Map(),
      aiName: () => 'Test AI', panelProfile: p => p, answerText: String, simpleText: String });
    vm.runInContext(code, context);
    const answer = context.reviewState('review').answers[0];
    assert.equal(answer.answer, auto ? value : value.slice(0, 400));
    assert.equal(answer.profileValue, auto ? intended : intended.slice(0, 200));
  }
});
