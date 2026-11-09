const assert = require('node:assert/strict');
const test = require('node:test');
const answers = require('./apply-answers.js');

const CANDIDATE = {
  candidateId: 'c1', firstName: 'Ana', lastName: 'Popescu', email: 'ana@example.com', phone: '+40 264 484 948',
  city: 'Cluj-Napoca', country: 'Romania', nationality: 'Romanian', gender: 'woman', yearsOfExperience: 6,
};
const field = (id, label, extra = {}) => ({ id, label, kind: 'text', required: true, ...extra });
const plan = (fields, candidate = CANDIDATE, saved = []) => answers.planApiFields(fields, candidate, saved, { today: new Date('2026-11-08'), coverLetterText: 'Dear team,\nHello.' });
const idsOf = (list) => list.map((entry) => entry.field.id);

test('personal questions go to the AI, with the profile as the check', () => {
  const result = plan([field('a', 'Email'), field('b', 'First name'), field('c', 'What motivates you?')]);
  assert.deepEqual(idsOf(result.ai), ['a', 'b', 'c']);
  assert.equal(result.ai[0].check.value, 'ana@example.com');
  assert.equal(result.ai[1].check.value, 'Ana');
  assert.equal(result.ai[2].check, undefined);
});

test('documents, required agreements and the cover letter are not sent to the AI', () => {
  const result = plan([
    field('cv', 'Resume', { kind: 'file' }),
    field('terms', 'I agree to the privacy policy', { kind: 'checkbox' }),
    field('letter', 'Cover letter', { kind: 'textarea' }),
  ]);
  assert.deepEqual(result.ai, []);
  assert.deepEqual(idsOf(result.uploads), ['cv']);
  assert.deepEqual(idsOf(result.code).sort(), ['letter', 'terms']);
});

test('diversity answers are filled by QTS and never asked of the AI', () => {
  const options = ['Female', 'Male', 'Prefer not to say'];
  const known = plan([field('g', 'Gender', { kind: 'select', options })]);
  assert.deepEqual(known.ai, []);
  assert.deepEqual(idsOf(known.code), ['g']);
  const lacking = plan([field('r', 'Race or ethnicity', { kind: 'select', options: ['A', 'B'] })], { ...CANDIDATE, gender: null });
  assert.deepEqual(lacking.ai, []);
  assert.deepEqual(idsOf(lacking.manager), ['r']);
});

test('legal declarations wait for the Manager, required or not asked at all', () => {
  const result = plan([
    field('crime', 'Have you ever been convicted of a felony?', { kind: 'radio', options: ['Yes', 'No'] }),
    field('optional', 'Will you take a drug test?', { kind: 'radio', options: ['Yes', 'No'], required: false }),
  ]);
  assert.deepEqual(result.ai, []);
  assert.deepEqual(idsOf(result.manager), ['crime']);
  assert.match(result.manager[0].message, /yourself/);
});

test('a marketing opt-in is left alone', () => {
  const result = plan([field('news', 'Send me job alerts', { kind: 'checkbox', required: false })]);
  assert.deepEqual([result.ai, result.code, result.manager], [[], [], []]);
});

test('a fact the profile lacks goes without a made-up hint', () => {
  const result = plan([field('dob', 'Date of birth')], { ...CANDIDATE, birthday: null });
  assert.equal(result.ai[0].lacking, 'birthday');
  assert.equal(result.ai[0].field.hint, undefined);
});

test('an AI answer that keeps the fact is used as the AI wrote it', () => {
  const entry = { field: field('p', 'Phone'), check: { value: '+40264484948', source: 'profile', fact: 'phone' } };
  assert.deepEqual(answers.verifyApiAnswer(entry, { value: '264 484 948', source: 'ai' }), { answer: { value: '264 484 948', source: 'ai' } });
});

test('an AI answer that changes a profile fact is replaced, and says so', () => {
  const entry = { field: field('e', 'Email'), check: { value: 'ana@example.com', source: 'profile', fact: 'email' } };
  const verdict = answers.verifyApiAnswer(entry, { value: 'someone.else@example.com', source: 'ai' });
  assert.equal(verdict.answer.value, 'ana@example.com');
  assert.equal(verdict.answer.source, 'profile');
  assert.deepEqual(verdict.corrected, { said: 'someone.else@example.com', used: 'ana@example.com' });
});

test('a name with extra words is not the profile name', () => {
  const entry = { field: field('n', 'First name'), check: { value: 'Ana', source: 'profile', fact: 'first name' } };
  assert.equal(answers.verifyApiAnswer(entry, { value: 'Anna Maria', source: 'ai' }).answer.value, 'Ana');
  assert.equal(answers.verifyApiAnswer(entry, { value: 'ANA', source: 'ai' }).corrected, undefined);
});

test('a different city in the same country is a changed fact', () => {
  const entry = { field: field('l', 'Current location'), check: { value: 'Cluj-Napoca, Romania', source: 'profile', fact: 'location' } };
  assert.equal(answers.verifyApiAnswer(entry, { value: 'Bucharest, Romania', source: 'ai' }).answer.value, 'Cluj-Napoca, Romania');
  assert.equal(answers.verifyApiAnswer(entry, { value: 'Cluj-Napoca, RO', source: 'ai' }).corrected, undefined);
});

test('a yes stays a yes', () => {
  const entry = { field: field('v', 'Do you need sponsorship?'), check: { value: 'No', source: 'profile' } };
  assert.equal(answers.verifyApiAnswer(entry, { value: 'No, I do not', source: 'ai' }).corrected, undefined);
  assert.equal(answers.verifyApiAnswer(entry, { value: 'Yes', source: 'ai' }).answer.value, 'No');
});

test('a personal fact the profile lacks must show in the résumé or the prompt', () => {
  const entry = { field: field('p', 'Phone'), lacking: 'phone' };
  const said = { value: '0711 222 333', source: 'ai' };
  assert.ok(answers.verifyApiAnswer(entry, said, { evidence: 'CV. Call 0711222333.' }).answer);
  assert.ok(answers.verifyApiAnswer(entry, said, { evidence: 'CV.', instructions: 'Phone to give: 0711 222 333' }).answer);
  assert.match(answers.verifyApiAnswer(entry, said, { evidence: 'CV.' }).refused, /no phone/);
});

test('sponsorship, relocation, notice and salary are taken when the prompt covers them', () => {
  const prompt = 'Visa sponsorship needed: No; willing to relocate: No; notice period: Immediately; expected salary: 5,000 - 6000 EUR/month';
  for (const [lacking, label, value] of [
    ['visa sponsorship', 'Do you need sponsorship?', 'No'],
    ['relocation', 'Willing to relocate?', 'No'],
    ['notice period', 'Notice period', 'Within 2 weeks'],
    ['salary expectation', 'Expected salary', '5500'],
  ]) {
    const entry = { field: field('x', label), lacking };
    const answer = { value, source: 'ai' };
    assert.deepEqual(answers.verifyApiAnswer(entry, answer, { instructions: prompt }), { answer }, lacking);
    assert.match(answers.verifyApiAnswer(entry, answer, { instructions: 'Answer the questions.' }).refused, /prompt and résumé do not give it/, lacking);
  }
});

test('with no saved answers those facts are lacking, not made up', () => {
  const result = plan([field('s', 'Do you need visa sponsorship?', { kind: 'select', options: ['Yes', 'No'] }), field('m', 'Expected salary'), field('n', 'Notice period')]);
  assert.deepEqual(result.ai.map((entry) => entry.lacking), ['visa sponsorship', 'salary expectation', 'notice period']);
  assert.deepEqual(result.ai.map((entry) => entry.field.hint), [undefined, undefined, undefined]);
});

test('a cover letter box too small for the letter is a question of its own: the letter is not sent', () => {
  const result = answers.planApiFields([field('l', 'Cover letter', { kind: 'textarea', maxLength: 10 })], CANDIDATE, [], { today: new Date('2026-11-08'), coverLetterText: 'A letter that is longer than ten characters.' });
  assert.equal(result.ai.length, 1);
  assert.equal(result.ai[0].field.hint, undefined);
  assert.equal(result.ai[0].field.intended, undefined);
});

test('an AI value picked for a list the profile can only hint at must keep the meaning', () => {
  const entry = { field: field('s', 'Visa status', { fact: 'answer', intended: 'No' }) };
  assert.ok(answers.verifyApiAnswer(entry, { value: 'Yes', source: 'ai' }).refused);
  assert.ok(answers.verifyApiAnswer(entry, { value: 'No, I do not', source: 'ai' }).answer);
});

const prompt = (extra = {}) => answers.buildAnswerPrompt({
  template: 'Profile: {{candidate_profile}}\nDocs: {{resume_and_cover_letter}}\nSaved: {{saved_answers}}\nQ: {{questions}}',
  job: { title: 'Dev', company: 'Acme', description: 'A long job description.' },
  candidate: CANDIDATE,
  resumeText: 'My resume', coverLetterText: 'My letter',
  fields: [field('a', 'Email')],
  savedAnswers: [{ questionText: 'Earliest start', answer: 'Monday' }],
  today: new Date('2026-11-08'),
  ...extra,
});

test('the prompt holds what Super Admin wrote, the profile, and only the reply shape', () => {
  const text = prompt({ apiFlow: true });
  assert.match(text, /ana@example\.com/);
  assert.match(text, /\+40 264 484 948/);
  assert.match(text, /My resume/);
  assert.match(text, /Earliest start: Monday/);
  assert.match(text, /Reply with JSON only/);
  assert.match(text, /status "review"/);
  // No rules of its own about what to say, and no pressure to answer everything.
  assert.doesNotMatch(text, /Answer every question id/);
  assert.doesNotMatch(text, /recruiter screens/);
  assert.doesNotMatch(text, /Do not return "review"/);
  // Only what the prompt names is sent.
  assert.doesNotMatch(text, /A long job description/);
});

test('diversity answers never reach the prompt, and a notice nobody gave is not invented', () => {
  const text = prompt({ apiFlow: true });
  assert.doesNotMatch(text, /diversityAnswers/);
  assert.doesNotMatch(text, /noticePeriod/);
  assert.doesNotMatch(text, /earliestStartDate/);
});

test('the older prompts are as they were', () => {
  assert.match(prompt({ minimal: true }), /Answer every question id/);
  assert.match(prompt({}), /recruiter screens/);
  assert.doesNotMatch(prompt({ minimal: true }), /ana@example\.com/);
});

test("the browser's month and time boxes say their format", () => {
  const text = prompt({ apiFlow: true, fields: [field('m', 'Start month', { nativeType: 'month' }), field('t', 'Interview time', { nativeType: 'time' })] });
  assert.match(text, /"format":"YYYY-MM"/);
  assert.match(text, /"format":"HH:MM"/);
  assert.doesNotMatch(prompt({ fields: [field('m', 'Start month', { nativeType: 'month' })] }), /"format":"YYYY-MM"/);
});

test('a box with a required pattern says so', () => {
  assert.match(prompt({ apiFlow: true, fields: [field('z', 'Postcode', { pattern: '[0-9]{5}' })] }), /"pattern":"\[0-9\]\{5\}"/);
  assert.doesNotMatch(prompt({ fields: [field('z', 'Postcode', { pattern: '[0-9]{5}' })] }), /"pattern"/);
});

test('the whole job description goes to the AI; the older prompts keep their limits', () => {
  const description = 'x'.repeat(30000);
  const template = 'J: {{job_description}}\nQ: {{questions}}';
  const length = (extra) => (answers.buildAnswerPrompt({ template, job: { description }, candidate: CANDIDATE, fields: [field('a', 'Email')], savedAnswers: [], today: new Date('2026-11-08'), ...extra }).match(/x+/) || [''])[0].length;
  assert.equal(length({ apiFlow: true }), 30000);
  assert.equal(length({}), 12000);
  assert.equal(length({ minimal: true }), 6000);
});

test('the follow-up keeps the reply shape only', () => {
  const text = answers.buildFixPrompt([{ id: 'a', label: 'Email', reason: 'not taken' }], [field('a', 'Email')], { apiFlow: true });
  assert.match(text, /Reply with JSON only/);
  assert.doesNotMatch(text, /recruiter screens/);
});

test('the last check finds what differs from the profile and leaves the Manager\'s edits', () => {
  const shown = [
    field('e', 'Email', { kind: 'email', value: 'ben@example.com', answered: true }),
    field('p', 'Phone', { kind: 'tel', value: '(264) 484-948', answered: true }),
    field('c', 'City', { value: 'Cluj-Napoca, Cluj County, Romania', answered: true }),
    field('f', 'First name', { value: 'Bogdan', answered: true, managerChanged: true }),
    field('l', 'Last name', { value: '', answered: false }),
  ];
  const wrong = answers.personalMismatches(shown, CANDIDATE, [], { today: new Date('2026-11-08') });
  assert.deepEqual(wrong.map((entry) => entry.id), ['e']);
  assert.equal(wrong[0].profile, 'ana@example.com');
});
