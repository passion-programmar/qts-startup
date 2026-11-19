// Yes/No questions answered by meaning and direction (apply-answers.js polarAnswer): many real
// wordings, each with the answer it must get, and the cases that must be left for the Manager.
const assert = require('node:assert/strict');
const test = require('node:test');
const { polarAnswer } = require('./apply-answers.js');

const yesNo = (label) => ({ id: 'q', label, kind: 'radio', options: ['Yes', 'No'] });
const saved = (questionText, answer, scope = 'candidate') => ({ questionText, answer, scope, questionKey: questionText.toLowerCase() });
const candidate = { firstName: 'Andrei', lastName: 'Sava', nationality: 'Romanian', country: 'Romania', birthday: '1990-05-01' };
const context = { today: new Date(2026, 10, 19), jobCompany: 'Akamai Technologies', experiences: [{ company: 'Endava' }, { company: 'UiPath SRL' }] };
const answerOf = (field, rows, who = candidate, ctx = context) => polarAnswer(field, rows, who, ctx)?.value ?? null;

const noSponsorship = [saved('Do you need visa sponsorship?', 'No')];
const authorised = [saved('Are you legally authorised to work in the EU?', 'Yes')];

test('sponsorship: the saved fact answers every wording, turned the way each question points', () => {
  for (const [label, expected] of [
    ['Do you require visa sponsorship?', 'No'],
    ['Will you need sponsorship to work for us?', 'No'],
    ['Do you NOT require sponsorship?', 'Yes'],
    ['Can you start without sponsorship?', 'Yes'],
    ['Are you able to work without a work visa?', 'Yes'],
    ['Czy potrzebujesz wizy?', 'No'],
    ['Do you require sponsorship (Yes/No)?', 'No'],
    ['Do you require sponsorship or not?', 'No'],
  ]) assert.equal(answerOf(yesNo(label), noSponsorship), expected, label);
});

test('a saved answer worded the other way round is read as its fact', () => {
  const rows = [saved('Can you work without sponsorship?', 'Yes')];
  assert.equal(answerOf(yesNo('Do you require visa sponsorship?'), rows), 'No');
  assert.equal(answerOf(yesNo('Can you work in this role without sponsorship?'), rows), 'Yes');
});

test('"now or in the future" is not answered from a saved "no sponsorship now"', () => {
  const now = [saved('Do you currently need sponsorship?', 'No')];
  assert.equal(answerOf(yesNo('Will you now or in the future require sponsorship?'), now), null);
  const always = [saved('Will you now or in the future require sponsorship?', 'No')];
  assert.equal(answerOf(yesNo('Will you now or in the future require visa sponsorship?'), always), 'No');
  // Needing it now means needing it now-or-later.
  const needs = [saved('Do you need sponsorship?', 'Yes')];
  assert.equal(answerOf(yesNo('Will you now or in the future require sponsorship?'), needs), 'Yes');
});

test('work permit: the same region only', () => {
  assert.equal(answerOf(yesNo('Are you authorized to work in the European Union?'), authorised), 'Yes');
  assert.equal(answerOf(yesNo('Do you have the right to work in the EU?'), authorised), 'Yes');
  assert.equal(answerOf(yesNo('Are you NOT eligible to work in the EU?'), authorised), 'No');
  assert.equal(answerOf(yesNo('Are you legally authorized to work in the United States?'), authorised), null, 'another country is never assumed');
});

test('authorised to work without sponsorship: both facts together', () => {
  const both = [...authorised, ...noSponsorship];
  assert.equal(answerOf(yesNo('Are you legally authorized to work in the EU without sponsorship?'), both), 'Yes');
  assert.equal(answerOf(yesNo('Are you legally authorized to work in the EU without sponsorship?'), noSponsorship), null, 'one fact missing: left');
});

test('relocation, travel, remote and on-site', () => {
  const rows = [saved('Are you willing to relocate?', 'No'), saved('Are you willing to travel?', 'Yes'), saved('Are you open to working on-site?', 'No')];
  assert.equal(answerOf(yesNo('Would you relocate for this role?'), rows), 'No');
  assert.equal(answerOf(yesNo('Are you unable to relocate?'), rows), 'Yes');
  assert.equal(answerOf(yesNo('Is business travel OK for you?'), rows), 'Yes');
  assert.equal(answerOf(yesNo('Can you work in the office 3 days a week?'), rows), 'No');
});

test('the candidate level wins over the default for every candidate; same-level disagreement is left', () => {
  const rows = [saved('Willing to relocate?', 'No', 'manager'), saved('Are you willing to relocate?', 'Yes', 'candidate')];
  assert.equal(answerOf(yesNo('Would you relocate?'), rows), 'Yes');
  assert.equal(answerOf(yesNo('Would you relocate?'), [saved('Willing to relocate?', 'No', 'manager')]), 'No');
  const clash = [saved('Willing to relocate?', 'Yes'), saved('Are you open to relocation?', 'No')];
  assert.equal(answerOf(yesNo('Would you relocate?'), clash), null);
});

test('the profile answers age, sanctions and a former employer without any saved answer', () => {
  assert.equal(answerOf(yesNo('Are you 18 years of age or older?'), []), 'Yes');
  assert.equal(answerOf(yesNo('Are you a citizen or permanent resident of any country subject to an embargo (including Cuba, Iran, North Korea, Sudan, Syria or Crimea)?'), []), 'No');
  assert.equal(answerOf(yesNo('Have you ever worked for Akamai?'), []), 'No');
  const akamai = { id: 'q', kind: 'radio', label: 'Are you currently or have you ever been an employee, temporary worker, or contingent worker at Akamai Technologies?', options: [
    'I am currently a contingent or temporary worker at Akamai Technologies', 'I am currently an employee at Akamai Technologies',
    'I have never worked for Akamai Technologies', 'I have previously worked as a contingent or temporary worker at Akamai Technologies',
    'I have previously worked as an employee at Akamai Technologies'] };
  assert.equal(answerOf(akamai, []), 'I have never worked for Akamai Technologies');
  // Worked there: which of the four "yes" choices is not known, so it is left.
  assert.equal(answerOf(akamai, [], candidate, { ...context, experiences: [{ company: 'Akamai' }] }), null);
  // No birthday or nationality in the profile: nothing is guessed.
  assert.equal(answerOf(yesNo('Are you over 18?'), [], { firstName: 'X' }), null);
});

test('options in the list\'s own words, a lone tick box, and what is never answered', () => {
  const worded = { id: 'q', kind: 'select', label: 'Do you require sponsorship?', options: ['Yes, I will require sponsorship', 'No, I do not require sponsorship'] };
  assert.equal(answerOf(worded, noSponsorship), 'No, I do not require sponsorship');
  assert.equal(answerOf({ id: 'q', kind: 'checkbox', label: 'I am authorised to work in the EU' }, authorised), true);
  // A text box, a criminal-record declaration, and a question about two things are left alone.
  assert.equal(answerOf({ id: 'q', kind: 'text', label: 'Do you need sponsorship?' }, noSponsorship), null);
  assert.equal(answerOf(yesNo('Have you ever been convicted of a criminal offence?'), []), null);
  assert.equal(answerOf(yesNo('Are you willing to relocate and travel?'), [saved('Willing to relocate?', 'Yes'), saved('Willing to travel?', 'Yes')]), null);
});

// ---- One answer, many forms (siteFormAnswer, siteKeyOf) ----
const { siteFormAnswer, siteKeyOf } = require('./apply-answers.js');
const notice = (variants = []) => [{ questionText: 'Notice period', answer: '1 month', scope: 'candidate', questionKey: 'notice period', variants }];
const wrap = (form) => ({ kind: 'normal-variation', options: [], answer: '1 month', normalVariation: form });

test('the job site key keeps companies on shared boards apart', () => {
  assert.equal(siteKeyOf('https://job-boards.greenhouse.io/akamai/jobs/123'), 'job-boards.greenhouse.io/akamai');
  assert.equal(siteKeyOf('https://jobs.lever.co/acme/abc/apply'), 'jobs.lever.co/acme');
  assert.equal(siteKeyOf('https://www.acme.wd3.myworkdayjobs.com/en-US/careers/job/1'), 'acme.wd3.myworkdayjobs.com');
  assert.equal(siteKeyOf('https://akamaicareers.inflightcloud.com/jobs/2682'), 'akamaicareers.inflightcloud.com');
});

test('this site\'s own form wins; a list takes the answer or another form; a number box takes the number', () => {
  const rows = notice([wrap({ kind: 'select', options: ['2 weeks', '4 weeks'], answer: '4 weeks', site: 'job-boards.greenhouse.io/akamai' }),
    wrap({ kind: 'alternative', options: [], answer: '30 days' }), wrap({ kind: 'alternative', options: [], answer: '30' })]);
  const list = { id: 'q', label: 'Notice period', kind: 'select', options: ['2 weeks', '4 weeks', '8 weeks'] };
  assert.equal(siteFormAnswer(list, rows, 'job-boards.greenhouse.io/akamai')?.value, '4 weeks', 'what this site took before');
  assert.equal(siteFormAnswer({ ...list, options: ['1 Month', '3 Months'] }, rows, 'jobs.lever.co/acme')?.value, '1 Month', 'main answer, the list\'s capitals');
  assert.equal(siteFormAnswer({ ...list, options: ['15 days', '30 days', '60 days'] }, rows, 'x.com')?.value, '30 days', 'another form fits the list');
  assert.equal(siteFormAnswer({ id: 'q', label: 'Notice period', kind: 'number' }, rows, 'x.com')?.value, '30', 'the form that is a number');
  assert.equal(siteFormAnswer({ ...list, options: ['Immediately', '3 months'] }, rows, 'x.com'), null, 'nothing fits: left, never guessed');
  // Another site's form is not used here.
  assert.equal(siteFormAnswer(list, notice([wrap({ kind: 'select', options: [], answer: '8 weeks', site: 'jobs.lever.co/acme' })]), 'x.com'), null);
});
