// Manager-level reusable answers are defaults for all of a Manager's candidates (decision 2026-11-06):
// Normal Apply uses them when the candidate and the application have no answer of their own; the
// candidate's or application's answer always wins; identity facts never take one.
const assert = require('node:assert/strict');
const test = require('node:test');
const answers = require('./apply-answers.js');

const field = (label, extra = {}) => ({ id: 'field', kind: 'text', label, ...extra });
const row = (questionText, answer, scope = 'manager', id = `${scope}:${questionText}`) => ({ id, scope, questionText, questionKey: answers.normalizeQuestionKey(questionText), answer });
const yesNo = (label) => field(label, { kind: 'radio', options: ['Yes', 'No'] });
const fill = (target, rows, candidate = {}) => answers.resolveField(target, candidate, rows, { normalApply: true });

test('a Manager default fills relocation, sponsorship and work rights when the candidate has none', () => {
  assert.equal(fill(yesNo('Are you open to relocation?'), [row('Are you open to relocation?', 'No')]).value, 'No');
  assert.equal(fill(yesNo('Will you now or in the future require visa sponsorship?'), [row('Will you now or in the future require visa sponsorship?', 'No')]).value, 'No');
  assert.equal(fill(yesNo('Are you legally authorized to work in this country?'), [row('Are you legally authorized to work in this country?', 'Yes')]).value, 'Yes');
});

test('the candidate and the application win over the Manager default', () => {
  const rows = [row('Are you open to relocation?', 'Yes', 'candidate'), row('Are you open to relocation?', 'No')];
  assert.equal(fill(yesNo('Are you open to relocation?'), rows).value, 'Yes');
  const sponsorship = [row('Will you now or in the future require visa sponsorship?', 'No'),
    row('Will you now or in the future require visa sponsorship?', 'Yes', 'application')];
  assert.equal(fill(yesNo('Will you now or in the future require visa sponsorship?'), sponsorship).value, 'Yes');
});

test('work rights and sponsorship apply whatever country or employer the wording names, only to choice boxes', () => {
  const saved = [row('Will you now or in the future require visa sponsorship?', 'No')];
  // Ashby (Kraken), Greenhouse (Reddit), Ashby (Oyster) wordings from the real-site tests.
  for (const label of ['Will you now or in the future need sponsorship to work in your location?',
    'Do you now, or will you in the future, require immigration sponsorship to work at Reddit?',
    'Do you currently need, or will you need in the future, employer sponsorship?']) {
    assert.equal(fill(yesNo(label), saved).value, 'No', label);
  }
  // "No sponsorship now or in the future" also answers "currently"; a Yes does not.
  assert.equal(fill(yesNo('Do you currently require visa sponsorship?'), saved).value, 'No');
  assert.notEqual(fill(yesNo('Do you currently require visa sponsorship?'), [row('Will you now or in the future require visa sponsorship?', 'Yes')]).value, 'Yes');
  // A free-text box about the visa never gets a Yes/No.
  assert.equal(fill(field('If you require sponsorship, which visa type do you need?'), saved).value, undefined);
  const rights = [row('Are you legally authorized to work in this country?', 'Yes')];
  assert.equal(fill(yesNo('Are you currently authorized to work in this country?'), rights).value, 'Yes');
  assert.equal(fill(yesNo('Are you authorized to work in Germany?'), rights).value, 'Yes');
});

test('identity facts never take a Manager default', () => {
  for (const [label, kind] of [['Email', 'email'], ['First name', 'text'], ['Phone', 'tel'], ['Nationality', 'text'], ['City', 'text']]) {
    assert.equal(fill(field(label, { kind }), [row(label, 'manager-value')]).value, undefined, label);
  }
  // The profile always wins.
  assert.equal(fill(field('Email', { kind: 'email' }), [row('Email', 'manager@example.test')], { email: 'alex@example.test' }).value, 'alex@example.test');
});

test('the fill result marks where the candidate or job answer differs from the Manager default (shown in the panel)', () => {
  const relocation = yesNo('Are you open to relocation?');
  const notice = field('Notice period', { id: 'notice' });
  const rows = [row('Are you open to relocation?', 'No'), row('Are you open to relocation?', 'Yes', 'candidate'),
    row('Notice period', '1 month'), row('Notice period', '1 month', 'candidate')];
  const { answers: filled } = answers.resolveFields([{ ...relocation, id: 'relocation' }, notice], {}, rows, { normalApply: true });
  assert.equal(filled.relocation.value, 'Yes');
  assert.equal(filled.relocation.managerDefault, 'No');
  assert.equal(filled.relocation.level, 'candidate');
  // Same value as the default: nothing to show.
  assert.equal(filled.notice.managerDefault, undefined);
  // Only the Manager default: used, nothing to show.
  const only = answers.resolveFields([{ ...relocation, id: 'relocation' }], {}, [row('Are you open to relocation?', 'No')], { normalApply: true }).answers;
  assert.equal(only.relocation.value, 'No'); assert.equal(only.relocation.managerDefault, undefined);
});

test('Ashby (Oyster): "employer sponsorship to work in your country of residence" is the candidate\'s own work right', () => {
  const saved = [row('Will you now or in the future require visa sponsorship?', 'No')];
  assert.equal(fill(yesNo('Do you currently need, or will you need in the future, employer sponsorship to work in your country of residence?'), saved).value, 'No');
  // Still about someone else: an employer's name or address.
  assert.equal(fill(field('Employer name'), [row('Employer name', 'X')]).value, undefined);
});
