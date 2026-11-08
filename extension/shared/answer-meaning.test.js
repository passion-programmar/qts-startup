// Answers by meaning and from the profile (decisions 2026-11-07): saved answers found whatever the
// wording, language levels from the Manager's "Language levels" answer, employer history, located in,
// EU work rights, names. Nothing here is a hard-coded answer: values come from profile or saved rows.
const test = require('node:test');
const assert = require('node:assert/strict');
global.__qtsSemanticFields = require('./semantic-fields.js');
const meaning = require('./answer-meaning.js');
const answers = require('./apply-answers.js');

const levels = { English: 7, '*': 1 };
const lang = (label, options = [], kind = options.length ? 'select' : 'text') => meaning.languageAnswer({ label, options, kind }, () => levels)?.value;

test('language questions in any wording and box type follow the saved levels', () => {
  assert.deepEqual(meaning.parseLanguageLevels('English: Native; Other languages: A1'), { English: 7, '*': 1 });
  assert.deepEqual(meaning.parseLanguageLevels('English (C1), Polish (native)'), { English: 5, Polish: 7 });
  assert.equal(lang('Określ swój poziom znajomości języka polskiego', ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']), 'A1');
  assert.equal(lang('English level', ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']), 'C2');
  assert.equal(lang('English level', ['Basic', 'Intermediate', 'Fluent', 'Native']), 'Native');
  assert.equal(lang('Englischkenntnisse', ['Grundkenntnisse', 'Gut', 'Fließend']), 'Fließend');
  assert.equal(lang('Rate your English proficiency', ['1', '2', '3', '4', '5']), '5');
  assert.equal(lang('Do you speak Russian fluently?', ['Yes', 'No']), 'No');
  assert.equal(lang('Are you a native English speaker?', ['Yes', 'No']), 'Yes');
  assert.equal(lang('Native or fluent English?', ['Yes', 'No']), 'Yes');
  assert.equal(lang('Do you speak German?', ['Yes', 'No']), 'No');
  assert.equal(lang('Is your German level B2 or higher?', ['Yes', 'No']), 'No');
  assert.equal(lang('What is your native language?'), 'English');
  assert.equal(lang('Languages and levels', [], 'textarea'), 'English – Native');
  assert.equal(lang('English level'), 'Native');
  // Not a human language, or no language named beside a level list: never answered.
  assert.equal(lang('Which programming languages do you use?'), undefined);
  assert.equal(lang('Additional questions', ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']), undefined);
  // No levels known at all: nothing is guessed.
  assert.equal(meaning.languageAnswer({ label: 'English level', options: ['B1', 'B2'], kind: 'select' }, () => ({})), null);
});

test('employer questions are answered from the work history, never from an empty one', () => {
  const history = [{ companyName: 'Initech Sp. z o.o.', isCurrent: true }, { companyName: 'Globex Inc.', endDate: '2018-12-31' }];
  const ask = (label, options, experiences = history) => meaning.employerAnswer({ label, options, kind: 'select' }, experiences, 'Exadel')?.value;
  assert.equal(ask('Are you currently employed or contracted to Exadel or any of its subsidiaries?', ['No', 'Yes - Exadel', 'Yes - Anthil', 'Yes - Other']), 'No');
  assert.equal(ask('Have you previously been employed by Globex?', ['Yes', 'No']), 'Yes');
  assert.equal(ask('Are you currently employed by Globex?', ['Yes', 'No']), 'No');
  assert.equal(ask('Are you currently employed or contracted to Initech or any of its subsidiaries?', ['No', 'Yes - Initech', 'Yes - Other']), 'Yes - Initech');
  assert.equal(ask('Are you currently or have you ever been an employee, temporary worker, or contingent worker at Initech?',
    ['I am currently an employee at Initech', 'I have previously been an employee at Initech', 'I have never been an employee at Initech']), 'I am currently an employee at Initech');
  assert.equal(ask('Have you ever worked for us?', ['Yes', 'No']), 'No');
  assert.equal(ask('Are you related to any current employees?', ['Yes', 'No']), undefined);
  assert.equal(ask('Have you previously been employed by Globex?', ['Yes', 'No'], []), undefined);
});

test('saved answers are found by meaning; similar words are only offered; negation and other people never match', () => {
  const rows = [
    { id: 'm', scope: 'manager', questionText: 'Are you willing to work remotely?', answer: 'Yes', variants: [] },
    { id: 'c', scope: 'candidate', questionText: 'Can you work remotely?', answer: 'No', variants: [] },
    { id: 'p', scope: 'manager', questionText: 'Years of experience with Python', answer: '6', variants: [] },
    { id: 'l', scope: 'manager', questionText: 'Do you hold an EU passport?', answer: 'Yes', variants: [{ kind: 'radio', options: [], answer: 'Yes', questionText: 'Are you an EU citizen?' }] },
  ];
  const match = meaning.matchSaved('Are you able and willing to work remotely?', rows);
  assert.equal(match.confidence, 'high');
  assert.equal(match.row.id, 'c', 'this candidate wins over all candidates');
  assert.equal(meaning.matchSaved('Are you NOT able to work remotely?', rows), null);
  assert.equal(meaning.matchSaved('Do you have experience with remote teams?', rows), null);
  assert.equal(meaning.matchSaved('How many years of experience do you have with Go?', rows), null);
  assert.equal(meaning.matchSaved('How many years of Python experience do you have?', rows)?.row.id, 'p');
  assert.equal(meaning.matchSaved('Are you an EU citizen?', rows)?.why, 'a wording you linked');
  assert.equal(meaning.matchSaved("Is your spouse willing to work remotely?", rows), null);
});

const candidate = { firstName: 'Alex', lastName: 'Tester', country: 'Poland', city: 'Warsaw', nationality: 'Polish', languages: '' };
const saved = [
  { id: 'r1', scope: 'manager', questionKey: 'are you willing to work remotely', questionText: 'Are you willing to work remotely?', answer: 'Yes', variants: [] },
  { id: 'r2', scope: 'manager', questionKey: 'language levels', questionText: 'Language levels', answer: 'English: Native; Other languages: A1', variants: [] },
  { id: 'r3', scope: 'manager', questionKey: 'salary expectations', questionText: 'Salary expectations', answer: '5000 EUR monthly', variants: [] },
];
const context = { normalApply: true, experiences: [{ companyName: 'Initech', isCurrent: true }], jobCompany: 'Exadel', jobLocation: 'Warsaw, Poland' };
const solve = (label, kind = 'select', options = ['Yes', 'No'], extra = {}) => answers.resolveFields([{ id: 'f', label, kind, options, required: true }], candidate, saved, { ...context, ...extra });

test('Normal Apply fills what the profile settles, before any saved answer', () => {
  const value = (...args) => solve(...args).answers.f?.value;
  assert.equal(value('Are you able and willing to work remotely?', 'radio'), 'Yes');
  assert.equal(value('Do you speak Russian fluently?'), 'No');
  assert.equal(value('Have you previously been employed or contracted by Exadel?'), 'No');
  assert.equal(value('Are you located in Spain, Portugal, Cyprus, Poland, Serbia, Georgia, Armenia, or Turkey?'), 'Yes');
  assert.equal(value('Are you based in Germany or Austria?'), 'No');
  assert.equal(value('Are you legally authorized to work in the country this position is posted?', 'text', []), 'Yes');
  assert.equal(value('Do you now or in the future require sponsorship from an employer in the country this position is posted?', 'text', []), 'No');
  assert.equal(value('What is your preferred name?', 'text', []), 'Alex');
  assert.equal(value('What is your Legal first and last name?', 'text', []), 'Alex Tester');
  assert.equal(solve('Are you legally authorized to work in the country this position is posted?').answers.f.provenance.operation, 'derived');
});

test('EU work rights only for an EU/EEA national and a job in the EU/EEA; never for combined questions', () => {
  const value = (label, extra = {}, who = candidate) => answers.resolveFields([{ id: 'f', label, kind: 'select', options: ['Yes', 'No'], required: true }], who, [], { ...context, ...extra }).answers.f?.value;
  assert.equal(value('Are you authorized to work in Germany?'), 'Yes');
  assert.equal(value('Are you eligible to work in the EU?'), 'Yes');
  assert.equal(value('Do you have the right to work in the United Kingdom?'), undefined);
  assert.equal(value('Are you legally authorized to work in the country this position is posted?', { jobLocation: 'Remote' }), undefined);
  assert.equal(value('Are you authorized to work in Germany or will you require sponsorship?'), undefined);
  assert.equal(value('Are you authorized to work in Germany without sponsorship?'), 'Yes');
  assert.equal(value('Are you authorized to work in Germany?', {}, { ...candidate, nationality: 'Indian' }), undefined);
});

test('similar wording is offered, not filled; guarded topics and code never answer', () => {
  const offered = answers.resolveFields([{ id: 'f', label: 'Remote working possible for you full week?', kind: 'select', options: ['Yes', 'No'], required: true }], candidate,
    [{ id: 'x', scope: 'manager', questionKey: 'full week remote working possible', questionText: 'Full week remote working possible', answer: 'Yes', variants: [] }], { ...context });
  assert.ok(offered.answers.f || offered.offers.length, 'answered or offered');
  // "How did you hear" has no saved answer: nothing is filled from code (no built-in "LinkedIn").
  assert.equal(solve('How did you hear about this job?', 'text', []).answers.f, undefined);
  // A personal fact missing in the profile: left for the Manager, never "Decline to self-identify".
  const gender = solve('What is your gender identity?', 'radio', ['Man', 'Woman', 'I prefer not to answer']);
  assert.equal(gender.answers.f, undefined);
  assert.match(gender.byHand[0].message, /profile has no answer/);
});
