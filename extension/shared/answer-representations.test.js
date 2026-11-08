const assert = require('node:assert/strict');
const test = require('node:test');
const r = require('./answer-representations.js');
const answers = require('./apply-answers.js');
const field = (label, more = {}) => ({ id: 'field', kind: 'text', label, ...more });
const normal = (f, profile = {}, rows = [], context = {}) => answers.resolveField(f, profile, rows, { normalApply: true, ...context });
const saved = (questionText, answer, representation, kind = 'text') => ({ id: 'saved', scope: 'candidate', questionText, questionKey: answers.normalizeQuestionKey(questionText), answer,
  variants: [{ kind, options: [], answer, ...(representation ? { representation } : {}) }] });

test('operations declare source, target, requirements and manual failure behavior', () => {
  for (const op of r.operations) { assert.ok(op.source && op.target && op.requires.length); assert.equal(op.failure, 'manual'); }
});

test('composition/extraction use known components and never split arbitrary names/addresses', () => {
  const source = { type: 'components', value: { first: 'Ana', last: 'Pop' } };
  assert.equal(r.convert(source, { kind: 'text' }, { layout: [['last'], ['first']], required: ['first', 'last'], separator: ', ' }).value, 'Pop, Ana');
  assert.equal(r.convert(source, { kind: 'text', component: 'last' }).value, 'Pop');
  assert.equal(r.convert(source, { kind: 'text' }, { layout: [['first', 'middle']], required: ['first', 'middle'] }).ok, false);
  assert.equal(normal(field('Full name'), { firstName: 'Ana' }).value, undefined);
  assert.equal(normal(field('Full name', { placeholder: 'Last, First' }), { firstName: 'Ana', lastName: 'Pop' }).value, 'Pop, Ana');
  assert.equal(normal(field('Complete address', { kind: 'textarea' }), { addressLine1: 'Main 1', city: 'Cluj', postalCode: '400000', country: 'Romania' }).value, 'Main 1\n400000 Cluj\nRomania');
  assert.equal(normal(field('Complete address'), { addressLine1: 'Main 1', city: 'Cluj' }).value, undefined);
  assert.equal(normal(field('First name'), {}, [saved('Full name', 'Ana Maria Pop')]).value, undefined);
  assert.equal(normal(field('First name'), {}, [saved('Full name (last, first)', 'Pop, Ana Maria')]).value, 'Ana Maria');
  assert.equal(normal(field('Last name'), {}, [saved('Full name', 'Pop, Ana Maria', { nameOrder: 'family-given' })]).value, 'Pop');
  assert.equal(normal(field('First name'), {}, [saved('Full name (last, first)', 'Pop, Ana, Jr')]).value, undefined);
});

test('phone formatting preserves digits, validates code association and rejects unproven trunk conversion', () => {
  const source = { type: 'phone', value: '+40 711 222 333' };
  assert.equal(r.convert(source, { kind: 'tel', representation: 'national' }, { callingCode: '+40' }).value, '711222333');
  assert.equal(r.convert(source, { kind: 'tel', representation: 'national' }, { callingCode: '+49' }).ok, false);
  assert.equal(r.convert(source, { kind: 'text', representation: 'calling-code' }).ok, false);
  assert.equal(r.convert({ type: 'phone', value: '0711222333', context: { national: true, callingCode: '+40' } }, { kind: 'tel' }).ok, false);
  assert.equal(r.convert({ type: 'phone', value: '711222333', context: { national: true, callingCode: '+40', nationalSignificant: true } }, { kind: 'tel' }).value, '+40711222333');
  assert.equal(normal(field('Local phone number', { phoneCallingCode: '+40' }), { phone: '+40 711222333' }).value, '711222333');
  assert.equal(normal(field('Local phone number'), { phone: '+40 711222333' }).value, undefined);
  assert.equal(normal(field('Phone number'), {}, [saved('Phone country code', '+40')]).value, undefined);
  assert.equal(normal(field('Local phone number'), {}, [saved('National phone number', '711222333')]).value, '711222333');
});

test('false, zero and refusal remain distinct from missing/empty; choices must be unique and compatible', () => {
  assert.equal(r.convert({ type: 'boolean', value: false }, { kind: 'checkbox' }).value, false);
  assert.equal(r.convert({ type: 'boolean', value: false }, { kind: 'select', options: ['Yes, I do', 'No, I do not'] }).value, 'No, I do not');
  assert.equal(r.convert({ type: 'boolean', value: true }, { kind: 'select', options: ['Yes, including future sponsorship', 'No'] }).ok, false);
  assert.equal(r.convert({ type: 'number', value: 0 }, { kind: 'number', min: 0, step: 1 }).value, 0);
  assert.equal(normal(field('Years of experience', { kind: 'number' }), { yearsOfExperience: 0 }).value, 0);
  for (const value of [null, undefined, '']) assert.equal(r.convert({ type: 'number', value }, { kind: 'number' }).ok, false);
  assert.equal(r.convert({ type: 'string', value: 'Prefer not to say' }, { kind: 'select', options: ['Prefer not to say', 'Other'] }).value, 'Prefer not to say');
});

test('numbers require explicit decimal conventions and obey range, step and pattern constraints', () => {
  assert.equal(r.convert({ type: 'number', value: '1,234' }, { kind: 'number' }).ok, false);
  assert.equal(r.convert({ type: 'number', value: '1,25', context: { numberFormat: 'decimal-comma' } }, { kind: 'number', step: 0.25 }).value, 1.25);
  assert.equal(r.convert({ type: 'number', value: 1.25 }, { kind: 'number', step: 1 }).ok, false);
  assert.equal(r.convert({ type: 'number', value: 10 }, { kind: 'number', max: 5 }).ok, false);
  assert.equal(r.convert({ type: 'string', value: 'abc' }, { kind: 'text', pattern: '[0-9]+' }).ok, false);
});

test('calendar dates use declared formats and validate real dates and constraints before filling', () => {
  assert.equal(r.convert({ type: 'date', value: '2028-02-29' }, { kind: 'text' }, { dateFormat: 'DD/MM/YYYY' }).value, '29/02/2028');
  assert.equal(r.convert({ type: 'date', value: '2027-02-29' }, { kind: 'date' }).ok, false);
  assert.equal(r.convert({ type: 'date', value: '01/02/2028' }, { kind: 'date' }).ok, false);
  assert.equal(r.convert({ type: 'date', value: '01/02/2028', context: { dateFormat: 'DD/MM/YYYY' } }, { kind: 'date' }).value, '2028-02-01');
  assert.equal(r.convert({ type: 'date', value: '2028-02-01' }, { kind: 'date', minDate: '2028-03-01' }).ok, false);
  assert.equal(normal(field('Date of birth', { placeholder: 'DD/MM/YYYY' }), { birthday: '1990-12-31' }).value, '31/12/1990');
  assert.equal(normal(field('Available start date', { kind: 'date' }), {}, [saved('Earliest start date', '01/02/2028', { dateFormat: 'DD/MM/YYYY' })]).value, '2028-02-01');
});

test('durations and availability use calendar days/weeks; no assumed month/business-day length', () => {
  const source = { type: 'duration', value: 1, context: { unit: 'week' } };
  assert.equal(r.convert(source, { kind: 'number', unit: 'day' }).value, 7);
  assert.equal(r.convert(source, { kind: 'select', options: ['7 days', '14 days'] }).value, '7 days');
  assert.equal(r.convert(source, { kind: 'number', unit: 'month' }).ok, false);
  assert.equal(r.convert(source, { kind: 'date' }, { baseDate: '2026-01-01' }).value, '2026-01-08');
  assert.equal(r.convert(source, { kind: 'date' }).ok, false);
  assert.equal(r.convert({ type: 'duration', value: 1, context: { unit: 'month' } }, { kind: 'number', unit: 'month' }).value, 1);
  assert.equal(r.convert({ type: 'duration', value: 1, context: { unit: 'month' } }, { kind: 'date' }, { baseDate: '2026-01-01' }).ok, false);
  assert.equal(normal(field('Earliest start date', { kind: 'date' }), { noticePeriod: '1_week' }, [], { today: new Date('2026-01-01T12:00:00') }).value, '2026-01-08');
  assert.equal(normal(field('Notice period', { kind: 'number', unit: 'day', note: 'Working days' }), { noticePeriod: '1_week' }).value, undefined);
  assert.equal(normal(field('Notice period in days', { kind: 'number' }), {}, [saved('Notice period in weeks', '2')]).value, 14);
  assert.equal(normal(field('Earliest start date', { kind: 'date' }), {}, [saved('When can you start?', '1 month')]).value, undefined);
  assert.equal(normal(field('What notice period do you require?', { kind: 'number', unit: 'months' }), { noticeDays: 30 }).value, undefined);
});

test('salary requires explicit units, basis and conversion evidence; zero is not missing', () => {
  const source = { type: 'money', value: 12000, context: { currency: 'EUR', period: 'year', basis: 'gross' } };
  const target = { kind: 'number', context: { currency: 'EUR', period: 'month', basis: 'gross' } };
  assert.equal(r.convert(source, target).ok, false);
  assert.equal(r.convert(source, target, { periodFactors: { year: 12, month: 1 } }).value, 1000);
  assert.equal(r.convert(source, { ...target, context: { ...target.context, basis: 'net' } }).ok, false);
  assert.equal(r.convert(source, { ...target, context: { ...target.context, period: 'year', currency: 'USD' } }, { rates: { EUR: 1, USD: 2 } }).value, 24000);
  assert.equal(normal(field('Expected annual salary EUR', { kind: 'number' }), { salaryExpectationAmount: 0, salaryExpectationCurrency: 'EUR', salaryExpectationPeriod: 'year' }).value, 0);
  // Periods convert with the standard hours (40 h/week, 8 h/day; decision 2026-11-06).
  assert.equal(normal(field('Expected monthly salary EUR', { kind: 'number' }), { salaryExpectationAmount: 12000, salaryExpectationCurrency: 'EUR', salaryExpectationPeriod: 'year' }).value, '1000');
  assert.equal(normal(field('Expected annual salary EUR', { kind: 'number', note: 'Net amount' }), { salaryExpectationAmount: 12000, salaryExpectationCurrency: 'EUR', salaryExpectationPeriod: 'year' }).value, undefined);
  assert.equal(normal(field('Expected annual salary EUR', { kind: 'number', note: 'USD required' }), { salaryExpectationAmount: 12000, salaryExpectationCurrency: 'EUR', salaryExpectationPeriod: 'year' }).value, undefined);
  assert.equal(normal(field('Salary currency', { kind: 'select', options: ['Euro (EUR)', 'US Dollar (USD)'] }), { salaryExpectationCurrency: 'EUR' }).value, 'Euro (EUR)');
  assert.equal(normal(field('Frequency', { kind: 'select', options: ['Annually', 'Monthly'] }), { salaryExpectationPeriod: 'year' }).value, 'Annually');
  assert.equal(normal(field('Desired hourly rate USD', { kind: 'number' }), { salaryExpectationAmount: 12000, salaryExpectationCurrency: 'USD', salaryExpectationPeriod: 'year' })?.value, '5.77');
});

test('typed sets map all values without flattening, guessing separators or selecting partial subsets', () => {
  const source = { type: 'set', value: ['JavaScript', 'Python'] }, target = { kind: 'select', multiple: true, options: ['Python', 'JavaScript'] };
  assert.deepEqual(r.convert(source, target).value, ['JavaScript', 'Python']);
  assert.equal(r.convert(source, { ...target, multiple: false }).ok, false);
  assert.equal(r.convert(source, { ...target, options: ['Python'] }).ok, false);
  assert.equal(r.convert({ type: 'set', value: [] }, target).ok, false);
  assert.deepEqual(normal(field('Programming languages', { kind: 'checkbox-group', options: ['Python', 'JavaScript'] }), {}, [saved('Languages you can program in', 'Python | JavaScript', undefined, 'checkbox-group')]).value, ['Python', 'JavaScript']);
});

test('metadata is whitelisted; resolution never persists representations or affects Auto Apply', () => {
  assert.deepEqual(r.metadata({ dateFormat: 'DD/MM/YYYY', run: 'code', numberFormat: 'guess' }), { dateFormat: 'DD/MM/YYYY' });
  const rows = [saved('Earliest start date', '01/02/2028')], before = JSON.stringify(rows);
  assert.equal(normal(field('Available start date', { kind: 'date' }), {}, rows).value, undefined);
  assert.equal(JSON.stringify(rows), before);
  const old = answers.resolveField(field('Full name'), { firstName: 'Ana' }, [], { autoApply: true });
  assert.equal(old.value, 'Ana', 'Auto Apply name behavior remains unchanged');
});
