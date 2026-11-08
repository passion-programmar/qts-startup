// One saved salary ("5000 EUR monthly", B2B gross, typed once by the Manager) is converted for every
// site and box (decision 2026-11-06). Labels are the real ones from the visible real-site tests.
const assert = require('node:assert/strict');
const test = require('node:test');
const answers = require('./apply-answers.js');

const row = (questionText, answer, scope = 'manager') => ({ id: `${scope}:${questionText}`, scope, questionText, questionKey: answers.normalizeQuestionKey(questionText), answer });
const RATES = { base: 'EUR', rates: { EUR: 1, PLN: 4.3, USD: 1.08 } };
const fillAll = (fields, saved = [row('Salary expectations', '5000 EUR monthly')]) => {
  const plan = answers.resolveFields(fields, {}, saved, { normalApply: true, exchangeRates: RATES });
  return Object.fromEntries(fields.map((field) => [field.id, plan.answers[field.id]?.value]));
};

test('5000 EUR monthly fills every real salary box in the asked currency and period', () => {
  const values = fillAll([
    { id: 'oyster', kind: 'number', label: 'Salary Expectations', note: 'Gross annual base salary range (before tax)' },
    { id: 'lever', kind: 'text', label: 'What is your annual salary expectation? (Include currency)' },
    { id: 'workable', kind: 'textarea', label: 'What are your financial expectations on a B2B contract (monthly/PLN)?' },
    { id: 'hourly', kind: 'text', label: 'Expected hourly rate (EUR)' },
    { id: 'range', kind: 'select', label: 'Desired annual salary', options: ['Under 40k €', '40k – 55k €', '55k – 70k €', '70k+ €'] },
  ]);
  assert.deepEqual(values, {
    oyster: '60000', lever: '60000 EUR per year', workable: '21500 PLN per month', hourly: '28.85 EUR per hour', range: '55k – 70k €',
  });
});

test('Manatal: amount + currency + period choices are set together to the saved figure', () => {
  assert.deepEqual(fillAll([
    { id: 'amount', kind: 'number', label: 'Salary Expectation:' },
    { id: 'currency', kind: 'select', label: 'Salary Expectation', options: ['Barbados dollar', 'Euro', 'US Dollar', 'Polish Zloty'] },
    { id: 'period', kind: 'select', label: 'Salary Expectation', options: ['Hourly', 'Daily', 'Weekly', 'Monthly', 'Yearly'] },
  ]), { amount: '5000', currency: 'Euro', period: 'Monthly' });
});

test('a candidate\'s own salary wins; net is left for the Manager; a bare number with no period is left', () => {
  const saved = [row('Salary expectations', '5000 EUR monthly'), row('Salary expectations', '6000 EUR monthly', 'candidate')];
  assert.equal(fillAll([{ id: 's', kind: 'text', label: 'What is your annual salary expectation? (Include currency)' }], saved).s, '72000 EUR per year');
  assert.equal(fillAll([{ id: 's', kind: 'text', label: 'Expected net monthly salary (EUR)' }]).s, undefined);
  assert.equal(fillAll([{ id: 's', kind: 'number', label: 'Salary expectations' }]).s, undefined);
});
