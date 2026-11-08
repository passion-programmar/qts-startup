const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const semantics = require('./semantic-fields.js');
const answers = require('./apply-answers.js');
const field = (label, extra = {}) => ({ id: 'field', kind: 'text', label, ...extra });
const row = (questionText, answer, scope = 'candidate', id = 'saved') => ({ id, scope, questionText, questionKey: answers.normalizeQuestionKey(questionText), answer });

test('classic browser script and CommonJS use the identical versioned contract', () => {
  assert.equal(semantics.compatible('Prénom', 'Given name'), true);
  assert.equal(semantics.compatible('Téléphone', 'What’s your telephone number?'), true);
  const browser = { self: {} }; vm.createContext(browser);
  vm.runInContext(fs.readFileSync(require.resolve('./semantic-fields.js'), 'utf8'), browser);
  for (const label of ['What is your telephone number?', 'Please provide your given name', 'Country of citizenship', 'Preferred name', 'Email and phone']) {
    assert.equal(JSON.stringify(browser.self.__qtsSemanticFields.recognize(label)), JSON.stringify(semantics.recognize(label)));
  }
  assert.equal(browser.self.__qtsSemanticFields.version, 1);
});

test('Normal Apply recognizes saved question aliases through existing choice validators without writing records', () => {
  const saved = [row('Preferred interview format', 'Video')]; const before = JSON.stringify(saved);
  const result = answers.resolveField(field('What is your preferred interview channel?', { kind: 'select', options: ['Video', 'Phone'] }), {}, saved, { normalApply: true });
  assert.equal(result.value, 'Video'); assert.equal(result.provenance.meaning, 'candidate.interviewFormat');
  assert.equal(JSON.stringify(saved), before);
  assert.equal(answers.resolveField(field('Preferred interview channel', { kind: 'select', options: ['In person'] }), {}, saved, { normalApply: true }).value, undefined);
});

test('candidate authority, scope precedence and conflicting aliases remain conservative', () => {
  assert.equal(answers.resolveField(field('What is your contact email?'), { email: 'current@example.test' }, [row('Email address', 'stale@example.test')], { normalApply: true }).value, 'current@example.test');
  const records = [row('Preferred interview format', 'Phone', 'manager'), row('Preferred interview method', 'Video', 'candidate')];
  assert.equal(answers.resolveField(field('Preferred interview channel'), {}, records, { normalApply: true }).value, 'Video');
  records.push(row('Preferred interview channel', 'In person', 'candidate', 'second'));
  assert.match(answers.resolveField(field('Preferred interview channel'), {}, records, { normalApply: true }).byHand, /conflict/);
  // A Manager default applies when the candidate has no answer of their own (2026-11-06 decision).
  assert.equal(answers.resolveField(field('Preferred interview format'), {}, [row('Preferred interview channel', 'Video', 'manager')], { normalApply: true }).value, 'Video');
  assert.equal(answers.resolveField(field('Preferred interview format'), {}, [row('Preferred interview channel', 'Video', 'manager'), row('Preferred interview method', 'Phone', 'candidate')], { normalApply: true }).value, 'Phone', 'the candidate wins over the Manager default');
});

test('identity, geography, time, money and policy meanings never broaden automatically', () => {
  assert.equal(answers.resolveField(field('Email', { note: 'Contact email of the referee' }), { email: 'candidate@example.test' }, [], { normalApply: true }).value, undefined);
  assert.equal(semantics.compatible('Are you legally authorized to work in Romania?', 'Do you have the right to work in Romania?'), true);
  assert.equal(semantics.compatible('Do you currently require visa sponsorship?', 'Do you need sponsorship now?'), true);
  assert.equal(semantics.compatible('Expected annual salary EUR gross', 'Desired yearly compensation EUR gross'), true);
  assert.equal(semantics.compatible('Expected annual salary EUR gross', 'What is your desired yearly compensation EUR gross?'), true);
  assert.equal(answers.resolveField(field('Do you have the right to work in Romania?', { kind: 'select', options: ['Yes', 'No'] }), {},
    [row('Are you legally authorized to work in Romania?', 'Yes', 'application')], { normalApply: true }).value, 'Yes');
  assert.equal(answers.resolveField(field('Do you need sponsorship now?', { kind: 'checkbox' }), {},
    [row('Do you currently require visa sponsorship?', 'false', 'application')], { normalApply: true }).value, false);
  assert.equal(answers.resolveField(field('Phone country code', { kind: 'select', options: ['Romania (+40)', 'Germany (+49)'] }), { phone: '+40 711222333' }, [], { normalApply: true }).value, 'Romania (+40)');
  for (const [left, right] of [
    ['Legal name', 'Full name'], ['Preferred name', 'First name'], ['Nationality', 'Country of citizenship'],
    ['Country of residence', 'Country of citizenship'], ['Phone number', 'Phone country code'],
    ['Are you authorized to work in Romania?', 'Are you authorized to work in Germany?'],
    ['Do you need sponsorship now?', 'Will you need sponsorship in future?'],
    ['Expected annual salary EUR gross', 'Expected monthly salary EUR net'],
    ['I agree to the privacy policy', 'I accept the privacy policy'],
  ]) assert.equal(semantics.compatible(left, right), false, `${left} / ${right}`);
  // Decision 2026-11-07 (autofill as much as possible from the profile): a legal name is the profile's
  // first and last name; a passport name (below) is still never inferred.
  assert.equal(answers.resolveField(field('Legal name'), { firstName: 'Ana', lastName: 'Pop' }, [], { normalApply: true }).value, 'Ana Pop');
  for (const label of ['Full name as shown on passport', 'Employer email']) assert.equal(answers.resolveField(field(label), { firstName: 'Ana', lastName: 'Pop', email: 'candidate@example.test' }, [], { normalApply: true }).value, undefined);
  assert.equal(answers.resolveField(field('Email and phone'), { email: 'one@example.test', phone: '+40' }, [], { normalApply: true }).value, undefined);
  assert.equal(answers.resolveField(field('Are you authorized to work in Germany?'), { country: 'Romania' }, [], { normalApply: true }).value, undefined);
});

test('Auto Apply and legacy exact matching do not invoke semantic alias reuse', () => {
  const saved = [row('Preferred interview format', 'Video')];
  assert.equal(answers.resolveField(field('Preferred interview channel'), {}, saved, { autoApply: true })?.value, undefined);
  assert.equal(answers.resolveField(field('Custom legacy question'), {}, [row('Custom legacy question', 'Kept', 'application')], { normalApply: true }).value, 'Kept');
});
