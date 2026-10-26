const assert = require('node:assert/strict');
const test = require('node:test');
const answers = require('./apply-answers.js');

const candidate = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  email: 'anna@example.com',
  phone: '+48 600 100 200',
  linkedinUrl: 'https://www.linkedin.com/in/anna',
  githubUrl: null,
  portfolioUrl: null,
  city: 'Warsaw',
  country: 'Poland',
  needsSponsorship: false,
  willingToRelocate: null,
  noticePeriod: '1_week',
  salaryExpectationAmount: 70000,
  salaryExpectationCurrency: 'EUR',
  salaryExpectationPeriod: 'year',
  yearsOfExperience: 8,
  eeoPreference: 'prefer_not_to_say',
};

const field = (label, extra = {}) => ({ id: label, label, kind: 'text', required: true, ...extra });

test('profile facts answer the common questions', () => {
  const { answers: resolved, open, missing } = answers.resolveFields([
    field('First name'),
    field('Last Name'),
    field('Email'),
    field('Phone'),
    field('LinkedIn Profile'),
    field('Current location'),
    field('Notice period'),
    field('Salary expectations'),
    field('Years of experience'),
  ], candidate, []);
  assert.deepEqual(missing, []);
  assert.deepEqual(open, []);
  assert.equal(resolved['First name'].value, 'Anna');
  assert.equal(resolved['Current location'].value, 'Warsaw, Poland');
  assert.equal(resolved['Salary expectations'].value, '70000 EUR per year');
  assert.equal(resolved['Notice period'].value, '1 week');
  assert.equal(resolved['Years of experience'].value, '8');
});

const monthly = { ...candidate, salaryExpectationAmount: 500, salaryExpectationCurrency: 'EUR', salaryExpectationPeriod: 'month' };
const exchangeRates = { base: 'EUR', date: '2026-10-23', rates: { EUR: 1, USD: 1.08, PLN: 4.3 } };

test('salary is worked out for the period and currency each question asks', () => {
  const { answers: resolved, open } = answers.resolveFields([
    field('Expected hourly rate', { kind: 'number' }),
    field('Annual salary expectation', { kind: 'number' }),
    field('Daily rate'),
    field('Expected monthly salary in USD', { kind: 'number' }),
    field('Salary expectation in PLN (gross, per year)'),
    field('Salary expectations'),
    field('Expected salary', { kind: 'number' }),
  ], monthly, [], { exchangeRates });
  assert.equal(resolved['Expected hourly rate'].value, '2.88');
  assert.equal(resolved['Annual salary expectation'].value, '6000');
  assert.equal(resolved['Daily rate'].value, '23.08 EUR per day');
  assert.equal(resolved['Expected monthly salary in USD'].value, '540');
  assert.equal(resolved['Salary expectation in PLN (gross, per year)'].value, '25800 PLN per year');
  assert.equal(resolved['Salary expectations'].value, '500 EUR per month');
  // A bare number with no period is left to the AI, which picks from the worked-out figures.
  assert.deepEqual(open.map((entry) => entry.id), ['Expected salary']);
});

test('salary ranges, period choices, and currency choices take the matching option', () => {
  const { answers: resolved } = answers.resolveFields([
    field('Annual salary expectation', { id: 'fits', kind: 'select', options: ['Under €5,000', '€5,000 - €7,000', '€7,000+'] }),
    field('Annual salary expectation', { id: 'nearest', kind: 'radio', options: ['€10k-20k', '€20k-30k'] }),
    field('Salary period', { kind: 'select', options: ['Per year', 'Per month', 'Per hour'] }),
    field('Currency', { kind: 'select', options: ['USD', 'EUR', 'GBP'] }),
    field('Salary currency'),
  ], monthly, [], { exchangeRates });
  assert.equal(resolved.fits.value, '€5,000 - €7,000');
  assert.equal(resolved.nearest.value, '€10k-20k');
  assert.equal(resolved['Salary period'].value, 'Per month');
  assert.equal(resolved.Currency.value, 'EUR');
  assert.equal(resolved['Salary currency'].value, 'EUR');
});

test('without exchange rates, another currency goes to the AI instead of a wrong figure', () => {
  const { answers: resolved, open } = answers.resolveFields([
    field('Expected monthly salary in CHF', { kind: 'number' }),
    field('Expected monthly salary', { kind: 'number' }),
  ], monthly, [], {});
  assert.deepEqual(open.map((entry) => entry.id), ['Expected monthly salary in CHF']);
  assert.equal(resolved['Expected monthly salary'].value, '500');
});

test('start questions answer immediately or in 1 week, as a choice, a date, or words', () => {
  const today = new Date(2026, 9, 26);
  const { answers: oneWeek } = answers.resolveFields([
    field('Earliest start date', { kind: 'date' }),
    field('Start date', { placeholder: 'DD/MM/YYYY' }),
    field('When can you start?'),
    field('Availability to start', { kind: 'select', options: ['Immediately', 'Within 2 weeks', '1 month'] }),
    field('When are you available to start?', { kind: 'radio', options: ['1 week', '2 weeks'] }),
    field('Notice period', { id: 'long', kind: 'select', options: ['2 weeks', '1 month', '3 months'] }),
  ], candidate, [], { today });
  assert.equal(oneWeek['Earliest start date'].value, '2026-11-02');
  assert.equal(oneWeek['Start date'].value, '02/11/2026');
  assert.equal(oneWeek['When can you start?'].value, 'In 1 week');
  assert.equal(oneWeek['Availability to start'].value, 'Immediately');
  assert.equal(oneWeek['When are you available to start?'].value, '1 week');
  assert.equal(oneWeek.long.value, '2 weeks');

  const { answers: now } = answers.resolveFields([
    field('Earliest start date', { kind: 'date' }),
    field('When can you start?'),
  ], { ...candidate, noticePeriod: 'immediately' }, [], { today });
  assert.equal(now['Earliest start date'].value, '2026-10-26');
  assert.equal(now['When can you start?'].value, 'Immediately');
});

test('the AI gets the salary in every period and the currencies the page uses', () => {
  const prompt = answers.buildAnswerPrompt({
    job: { title: 'DevOps Engineer', company: 'Acme', description: 'Pay: 3,000-4,000 USD per month.' },
    candidate: monthly,
    documentsJson: '{}',
    fields: [field('Expected salary', { kind: 'number' })],
    exchangeRates,
    today: new Date(2026, 9, 26),
  });
  assert.match(prompt, /"salaryExpectation":"500 EUR per month"/);
  assert.match(prompt, /"EUR":\{"year":6000,"month":500,"day":23.08,"hour":2.88\}/);
  assert.match(prompt, /"USD":\{"year":6480,"month":540/);
  assert.match(prompt, /"noticePeriod":"1 week","earliestStartDate":"2026-11-02"/);
});

test('yes/no facts pick the matching option; a missing required fact stops instead of guessing', () => {
  const { answers: resolved, missing } = answers.resolveFields([
    field('Will you now or in the future require visa sponsorship?', { kind: 'select', options: ['Yes', 'No'] }),
    field('Are you willing to relocate?', { kind: 'radio', options: ['Yes', 'No'] }),
  ], candidate, []);
  assert.equal(resolved['Will you now or in the future require visa sponsorship?'].value, 'No');
  assert.deepEqual(missing.map((entry) => entry.fact), ['relocation']);
});

test('optional links the profile lacks are left empty, not guessed', () => {
  const { answers: resolved, missing, open } = answers.resolveFields([
    field('GitHub', { required: false }),
    field('Portfolio URL', { required: false }),
  ], candidate, []);
  assert.deepEqual(resolved, {});
  assert.deepEqual(missing, []);
  assert.deepEqual(open, []);
});

test('diversity questions decline, consent boxes are ticked, uploads get the documents', () => {
  const { answers: resolved } = answers.resolveFields([
    field('Gender', { kind: 'select', options: ['Male', 'Female', 'Decline to self-identify'] }),
    field('I agree to the privacy policy', { kind: 'checkbox' }),
    field('Resume/CV', { kind: 'file' }),
    field('Cover Letter', { kind: 'file', required: false }),
  ], candidate, []);
  assert.equal(resolved.Gender.value, 'Decline to self-identify');
  assert.equal(resolved['I agree to the privacy policy'].value, true);
  assert.equal(resolved['Resume/CV'].file, 'resume');
  assert.equal(resolved['Cover Letter'].file, 'coverLetter');
});

test('saved answers are reused and open questions go to the AI', () => {
  const saved = [{ questionKey: answers.normalizeQuestionKey('Why do you want to join Exadel?'), answer: 'Saved answer.' }];
  const { answers: resolved, open } = answers.resolveFields([
    field('Why do you want to join Exadel? *', { kind: 'textarea' }),
    field('Describe your Kubernetes experience', { kind: 'textarea', maxLength: 500 }),
  ], candidate, saved);
  assert.equal(resolved['Why do you want to join Exadel? *'].value, 'Saved answer.');
  assert.deepEqual(open.map((entry) => entry.id), ['Describe your Kubernetes experience']);
});

test('AI answers are checked against options and length before use', () => {
  const fields = [
    field('Kubernetes level', { kind: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] }),
    field('Short pitch', { kind: 'textarea', maxLength: 10 }),
    field('Team size', { kind: 'number' }),
  ];
  const reply = '```json\n{"answers":[{"id":"Kubernetes level","value":"advanced"},{"id":"Short pitch","value":"Far too long an answer"},{"id":"Team size","value":"five"}]}\n```';
  const { answers: usable, invalid } = answers.parseAnswerReply(reply, fields);
  assert.equal(usable['Kubernetes level'].value, 'Advanced');
  assert.deepEqual(invalid.map((entry) => entry.id), ['Short pitch', 'Team size']);
  assert.match(answers.buildFixPrompt(invalid), /Short pitch/);
});

test('the AI prompt carries the job, the facts, and only the open questions', () => {
  const prompt = answers.buildAnswerPrompt({
    job: { title: 'DevOps Engineer', company: 'Exadel', description: 'Kubernetes and AWS.' },
    candidate,
    documentsJson: '{"resume":{"summary":"Platform engineer"}}',
    fields: [field('Describe your Kubernetes experience', { kind: 'textarea', maxLength: 500 })],
  });
  assert.match(prompt, /DevOps Engineer at Exadel/);
  assert.match(prompt, /Platform engineer/);
  assert.match(prompt, /"maxLength":500/);
  assert.match(prompt, /Never invent/);
  assert.match(prompt, /Reply with JSON only/);
});

test('questions about someone else never take the candidate\'s facts', () => {
  const { answers: resolved, open } = answers.resolveFields([
    field('If you have discussed this role with a current employee, please share their full name', { required: false }),
    field('What is your Legal first and last name?'),
    field('City'),
    field('Autofill from resume', { kind: 'file', required: false }),
  ], { ...candidate, city: 'Warsaw' }, []);
  assert.equal(resolved['What is your Legal first and last name?'].value, 'Anna Kowalska');
  assert.equal(resolved.City.value, 'Warsaw');
  assert.equal(resolved['Autofill from resume'], undefined);
  assert.deepEqual(open.map((entry) => entry.id), ['If you have discussed this role with a current employee, please share their full name']);
});

test('a notice slider counts in its unit, a typed cover letter is Generation\'s, a lone acknowledgement is ticked', () => {
  const coverLetterText = 'Dear Hiring Manager,\n\nI am applying for the role.';
  const { answers: resolved, open } = answers.resolveFields([
    field('What is your current notice period? * Required', { id: 'weeks', kind: 'range', unit: 'weeks', min: 0, max: 25 }),
    field('Notice period in months', { id: 'months', kind: 'number' }),
    field('Cover letter', { kind: 'textarea', required: false }),
    field('Short cover letter', { id: 'short', kind: 'textarea', maxLength: 20 }),
    field('Our Hybrid & Remote Working Models * Required', { kind: 'radio', options: ['I acknowledge this statement'] }),
  ], candidate, [], { coverLetterText });
  assert.equal(resolved.weeks.value, '1');
  assert.equal(resolved.months.value, '1');
  assert.equal(resolved['Cover letter'].value, coverLetterText);
  assert.equal(resolved['Our Hybrid & Remote Working Models * Required'].value, 'I acknowledge this statement');
  assert.deepEqual(open.map((entry) => entry.id), ['short']);

  const { answers: now } = answers.resolveFields([
    field('What is your current notice period?', { id: 'weeks', kind: 'range', unit: 'weeks', min: 0, max: 25 }),
  ], { ...candidate, noticePeriod: 'immediately' }, []);
  assert.equal(now.weeks.value, '0');
});

test('Teamtailor\'s menu dropdown and drag-and-drop CV are answered like any choice and upload', () => {
  const { answers: resolved, open } = answers.resolveFields([
    field('Please select what right to work you hold: * Required', { kind: 'menu', options: ['British Passport', 'Skilled Worker Visa (formerly Tier 2)'] }),
    field('Upload CV * Required', { kind: 'file', drop: true }),
    field('Additional files', { kind: 'file', drop: true, required: false }),
  ], candidate, []);
  assert.equal(resolved['Upload CV * Required'].file, 'resume');
  assert.equal(resolved['Additional files'], undefined);
  assert.deepEqual(open.map((entry) => entry.id), ['Please select what right to work you hold: * Required']);
});

test('a tick box takes only yes/no facts, and a non-yes/no list goes to the AI instead of stopping', () => {
  const { answers: resolved, open, missing } = answers.resolveFields([
    field('Arden University can use my phone number for recruiting-related communication via SMS.', { kind: 'checkbox', required: false }),
    field('Please select what right to work you hold: Some roles may not meet the requirement for a sponsored visa.', { id: 'visa', kind: 'menu', options: ['British Passport', 'Skilled Worker Visa'] }),
  ], candidate, []);
  assert.deepEqual(resolved, {});
  assert.deepEqual(missing, []);
  assert.deepEqual(open.map((entry) => entry.id), ['visa']);
});

test('a currency and a frequency dropdown next to the salary take the candidate\'s own', () => {
  const { answers: resolved } = answers.resolveFields([
    field('Salary', { required: false }),
    field('Currency', { kind: 'menu', options: ['Euro', 'US Dollar', 'Thai Baht'] }),
    field('Frequency', { kind: 'menu', options: ['Hourly', 'Daily', 'Weekly', 'Monthly', 'Annually'] }),
  ], { ...candidate, salaryExpectationAmount: 5000, salaryExpectationPeriod: 'month' }, []);
  assert.equal(resolved.Currency.value, 'Euro');
  assert.equal(resolved.Frequency.value, 'Monthly');
});

test('an unmarked terms box is ticked, marketing and talent-pool boxes are not', () => {
  const { answers: resolved } = answers.resolveFields([
    field('I agree to the terms and conditions & privacy policy', { kind: 'checkbox', required: false }),
    field('I agree to receive marketing emails and newsletters', { id: 'marketing', kind: 'checkbox', required: false }),
    field('I consent to being kept in the talent pool for future opportunities under the privacy policy', { id: 'pool', kind: 'checkbox', required: false }),
  ], candidate, []);
  assert.equal(resolved['I agree to the terms and conditions & privacy policy'].value, true);
  assert.equal(resolved.marketing, undefined);
  assert.equal(resolved.pool, undefined);
});

test('a currency list that runs the code into the name picks the candidate\'s currency', () => {
  const { answers: resolved } = answers.resolveFields([
    field('Currency', { kind: 'menu', options: ['EUREuro', 'USDUS Dollar', 'THBThai Baht'] }),
  ], candidate, []);
  assert.equal(resolved.Currency.value, 'EUREuro');
});

test('years of experience as choices take the highest one the candidate reaches', () => {
  const { answers: resolved } = answers.resolveFields([
    field('How many years of experience do you have?', { kind: 'menu', options: ['No experience', '1+ year', '5+ year', '8+ year', '10+ year'] }),
    field('Years of experience', { id: 'ranges', kind: 'select', options: ['Less than 2', '2-4 years', '5-7 years', '8-10 years', '10+ years'] }),
  ], candidate, []);
  assert.equal(resolved['How many years of experience do you have?'].value, '8+ year');
  assert.equal(resolved.ranges.value, '8-10 years');
});

test('a box about future job opportunities stays unticked even when it mentions privacy', () => {
  const { answers: resolved } = answers.resolveFields([
    field('Yes, XTB can contact me about future job opportunities for up to 1 year, in line with the privacy notice', { kind: 'checkbox', required: false }),
  ], candidate, []);
  assert.deepEqual(resolved, {});
});

test('a fact the profile lacks, or has in another form, goes to the AI with a hint instead of stopping', () => {
  const { answers: resolved, open, missing } = answers.resolveFields([
    field('Are you willing to relocate?', { kind: 'radio', options: ['Yes', 'No'] }),
    field('Country', { kind: 'select', options: ['Polska', 'Niemcy', 'Czechy'] }),
    field('What is your nationality?'),
  ], { ...candidate, willingToRelocate: null, nationality: null }, []);
  assert.deepEqual(resolved, {});
  assert.deepEqual(missing.map((entry) => entry.fact), ['relocation', 'nationality']);
  const hints = Object.fromEntries(open.map((entry) => [entry.id, entry.hint]));
  assert.match(hints['Are you willing to relocate?'], /has no relocation/);
  assert.match(hints.Country, /profile says "Poland"/);
  assert.match(hints['What is your nationality?'], /has no nationality/);
});

test('Super Admin\'s prompt gets its placeholders filled and always ends with the reply format', () => {
  const fields = [field('Do you speak German?', { kind: 'radio', options: ['Yes', 'No'], hint: 'The candidate\'s profile has no languages.' })];
  const prompt = answers.buildAnswerPrompt({
    template: 'Answer for {{company}} ({{job_title}}).\nFacts: {{candidate_profile}}\nBefore: {{saved_answers}}\nQ: {{questions}}\n{{unknown_thing}}',
    job: { title: 'SRE', company: 'Acme', description: 'Go and Kubernetes.' },
    candidate: { ...candidate, languages: 'English C1, Polish C2', contractType: 'b2b' },
    documentsJson: '{}',
    fields,
    savedAnswers: [{ questionText: 'Earliest interview date', answer: 'Any weekday' }],
    today: new Date(2026, 9, 26),
  });
  assert.match(prompt, /^Answer for Acme \(SRE\)\./);
  assert.match(prompt, /"languages":"English C1, Polish C2"/);
  assert.match(prompt, /"contractType":"B2B or contractor"/);
  assert.match(prompt, /Earliest interview date: Any weekday/);
  assert.match(prompt, /"hint":"The candidate's profile has no languages\."/);
  assert.match(prompt, /\{\{unknown_thing\}\}/);
  assert.match(prompt, /Reply with JSON only/);
  // A prompt without a questions placeholder still carries the questions.
  const bare = answers.buildAnswerPrompt({ template: 'Be brief.', job: {}, candidate, fields });
  assert.match(bare, /Questions:\n\[\{"id":"Do you speak German\?"/);
});

test('several choices, number limits, and dates are checked, and the follow-up names the problem', () => {
  const group = field('Locations', { kind: 'checkbox-group', options: ['Coventry', 'Leeds', 'Remote'] });
  assert.deepEqual(answers.checkAnswer(group, 'Leeds | Remote'), { ok: true, value: ['Leeds', 'Remote'] });
  assert.equal(answers.checkAnswer(group, 'Leeds | Paris').ok, false);
  const weeks = field('Notice in weeks', { kind: 'range', min: 0, max: 25 });
  assert.equal(answers.checkAnswer(weeks, '30').ok, false);
  assert.equal(answers.checkAnswer(field('Start', { kind: 'date' }), '02/11/2026').ok, false);
  const fix = answers.buildFixPrompt([{ id: 'Locations', label: 'Locations', reason: 'the site did not take "Paris"' }], [group]);
  assert.match(fix, /"options":\["Coventry","Leeds","Remote"\]/);
  assert.match(fix, /"problem":"the site did not take \\"Paris\\""/);
});
