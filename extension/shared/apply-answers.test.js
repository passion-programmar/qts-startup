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

test('a form\'s only general upload takes the résumé; other documents never do', () => {
  // justjoin.it: one optional upload named "File upload" (its box says "Add document").
  const justJoin = answers.resolveFields([
    field('First and last name'),
    field('File upload Add document Format: PDF. Max size 5 MB', { id: 'upload', kind: 'file', required: false }),
  ], candidate, []);
  assert.equal(justJoin.answers.upload.file, 'resume');
  // A separate cover-letter upload or a "fill from résumé" upload still leaves the résumé to the general one.
  const withOthers = answers.resolveFields([
    field('Autofill from resume', { id: 'autofill', kind: 'file', required: false }),
    field('Cover letter', { id: 'cover', kind: 'file', required: false }),
    field('Attachment', { id: 'attach', kind: 'file', required: false }),
  ], candidate, []);
  assert.equal(withOthers.answers.attach.file, 'resume');
  assert.equal(withOthers.answers.cover.file, 'coverLetter');
  assert.equal(withOthers.answers.autofill, undefined);
  // A form with its own résumé upload keeps a general one empty; photos and extra files are never the résumé.
  const named = answers.resolveFields([
    field('Resume', { id: 'resume', kind: 'file', required: false }),
    field('Attach file', { id: 'attach', kind: 'file', required: false }),
  ], candidate, []);
  assert.equal(named.answers.resume.file, 'resume');
  assert.equal(named.answers.attach, undefined);
  for (const label of ['Additional files', 'Upload a photo', 'Portfolio upload', 'Upload certificates']) {
    const other = answers.resolveFields([field(label, { id: 'x', kind: 'file', required: false })], candidate, []);
    assert.equal(other.answers.x, undefined, label);
  }
});

test('uploads that read the résumé to fill the form are recognised on any site, and a message to the employer takes the cover letter', () => {
  for (const label of ['Autofill from resume', 'Easy Apply Choose an option to autocomplete your application.', 'Import from CV', 'Upload your resume to fill the form', 'Auto-populate with your CV']) {
    assert.equal(answers.isAutofillUpload({ kind: 'file', label }), true, label);
  }
  for (const label of ['Resume', 'Resume/CV', 'Cover letter', 'File upload']) {
    assert.equal(answers.isAutofillUpload({ kind: 'file', label }), false, label);
  }
  assert.equal(answers.isAutofillUpload({ kind: 'text', label: 'Autofill from resume' }), false);
  // Zoho: the box says only "Upload your resume"; its section heading says "Autofill Application".
  assert.equal(answers.isAutofillUpload({ kind: 'file', label: 'Upload your resume or drag and drop it here', autofill: true }), true);
  assert.equal(answers.isAutofillUpload({ kind: 'file', label: 'Upload photo', autofill: true, accept: 'image/*' }), false);
  // A photo upload under an "Easy Apply" heading (SmartRecruiters takes .jfif photos) is not the résumé box.
  assert.equal(answers.isAutofillUpload({ kind: 'file', label: 'Easy Apply Choose an option to autocomplete your application.', accept: '.bmp,.gif,.jfif,.jpeg,.jpg,.png,.tif,.tiff,.webp' }), false);
  const { answers: letMessage } = answers.resolveFields([
    field('Let the company know about your interest working there', { id: 'interest', kind: 'textarea', required: false }),
  ], candidate, [], { coverLetterText: 'Dear Hiring Team' });
  assert.equal(letMessage.interest.value, 'Dear Hiring Team');
  const coverLetterText = 'Dear Hiring Team,\n\nI am applying.';
  const { answers: resolved } = answers.resolveFields([
    field('Easy Apply Choose an option to autocomplete your application.', { id: 'easy', kind: 'file', required: false }),
    field('File upload', { id: 'general', kind: 'file', required: false }),
    field('Message to the Hiring Team Let the company know about your interest working there', { id: 'message', kind: 'textarea', required: false }),
    field('Message to the hiring team (one line)', { id: 'line', kind: 'text', required: false }),
  ], candidate, [], { coverLetterText });
  // The autofill upload is Apply's first step, not an answer; the general upload still takes the résumé.
  assert.equal(resolved.easy, undefined);
  assert.equal(resolved.general.file, 'resume');
  assert.equal(resolved.message.value, coverLetterText);
  assert.equal(resolved.line, undefined);
});

test('a salutation comes from the profile\'s gender in any language; never guessed, never a job title', () => {
  const ask = (profile, label, options, extra = {}) =>
    answers.resolveFields([field(label, { id: 'q', kind: 'menu', options, ...extra })], { ...candidate, ...profile }, []).answers.q;
  assert.equal(ask({ gender: 'man' }, 'Anrede', ['Herr', 'Frau', 'Divers']).value, 'Herr');
  assert.equal(ask({ gender: 'woman' }, 'Title', ['Mr', 'Mrs', 'Ms', 'Dr']).value, 'Ms');
  assert.equal(ask({ gender: 'woman' }, 'Civilité', ['M.', 'Mme']).value, 'Mme');
  assert.equal(ask({ gender: 'non_binary' }, 'Anrede', ['Herr', 'Frau', 'Divers']).value, 'Divers');
  // No gender in the profile: the declining choice, else an optional one is left empty.
  assert.equal(ask({ gender: null }, 'Anrede', ['Herr', 'Frau', 'Keine Angabe']).value, 'Keine Angabe');
  assert.equal(ask({ gender: null }, 'Anrede', ['Herr', 'Frau'], { required: false }), undefined);
  // "Title" with job titles is not a salutation.
  assert.notEqual(ask({ gender: 'man' }, 'Title', ['Engineer', 'Senior Engineer'])?.value, 'Mr');
});

test('personal facts come from the profile, before any reusable answer; a birthday is never guessed', () => {
  const daniel = {
    ...candidate, firstName: 'Daniel', lastName: 'Mestre', city: 'Cluj-Napoca', country: 'Romania', province: 'Cluj',
    addressLine1: '149, Drumul lui Páter', postalCode: '400684', birthday: '1994-06-07',
  };
  // A reusable answer saved for exactly "Location" (another candidate's) does not beat the profile.
  const saved = [{ questionKey: answers.normalizeQuestionKey('Location*'), questionText: 'Location', answer: 'United Kingdom', note: null, scope: 'global' }];
  const { answers: resolved, open } = answers.resolveFields([
    field('Location*', { id: 'location' }),
    field('Birthday*', { id: 'birthday', kind: 'date' }),
    field('Date of birth', { id: 'dob', placeholder: 'DD/MM/YYYY' }),
    field('First', { id: 'first' }),
    field('Last', { id: 'last' }),
    field('Complete Address*', { id: 'address' }),
  ], daniel, saved);
  assert.equal(resolved.location.value, 'Cluj-Napoca, Romania');
  assert.equal(resolved.location.source, 'profile');
  assert.equal(resolved.birthday.value, '1994-06-07');
  assert.equal(resolved.dob.value, '07/06/1994');
  assert.equal(resolved.first.value, 'Daniel');
  assert.equal(resolved.last.value, 'Mestre');
  assert.equal(resolved.address.value, '149, Drumul lui Páter, 400684 Cluj-Napoca, Cluj, Romania');
  assert.deepEqual(open, []);
  // No birthday in the profile: left for the Manager, never asked of the AI.
  const none = answers.resolveFields([field('Birthday*', { id: 'birthday', kind: 'date' })], { ...daniel, birthday: null }, []);
  assert.equal(none.answers.birthday, undefined);
  assert.deepEqual(none.open, []);
  // A question that is not a personal fact still takes the reusable answer saved for it.
  const general = answers.resolveFields([field('Do you agree to a trial day?', { id: 'trial' })], daniel,
    [{ questionKey: answers.normalizeQuestionKey('Do you agree to a trial day?'), questionText: 'Do you agree to a trial day?', answer: 'Yes', note: null, scope: 'global' }]);
  assert.equal(general.answers.trial.value, 'Yes');
});

test('"where do you live" questions take the profile\'s city and country', () => {
  const where = { ...candidate, city: 'Warsaw', country: 'Poland' };
  for (const label of ['Where do you live?', 'Where do you currently reside?', 'Where are you based?', 'Place of residence']) {
    assert.equal(answers.resolveFields([field(label, { id: 'q' })], where, []).answers.q?.value, 'Warsaw, Poland', label);
  }
});

test('an image CAPTCHA is never typed', () => {
  const { answers: resolved, open } = answers.resolveFields([
    field('Type below image text', { id: 'code' }),
    field('Enter the characters shown in the image', { id: 'code2' }),
  ], candidate, []);
  assert.deepEqual(resolved, {});
  assert.deepEqual(open, []);
});

test('photo and image uploads are never filled, even when required; image links are not made up', () => {
  const { answers: resolved, open } = answers.resolveFields([
    field('Photo', { id: 'photo', kind: 'file' }),
    field('Upload', { id: 'pictureOnly', kind: 'file', accept: 'image/png, image/jpeg' }),
    field('Profile picture', { id: 'picture', kind: 'file', required: false }),
    field('File upload', { id: 'general', kind: 'file', required: false }),
    field('Link to your headshot', { id: 'headshotLink', kind: 'url' }),
    field('Describe an image classification model you shipped', { id: 'ml', kind: 'textarea' }),
  ], candidate, []);
  assert.equal(resolved.photo, undefined);
  assert.equal(resolved.pictureOnly, undefined);
  assert.equal(resolved.picture, undefined);
  assert.equal(resolved.headshotLink, undefined);
  // Required image uploads do not count as the résumé's own upload: the general one still takes it.
  assert.equal(resolved.general.file, 'resume');
  // A question that only mentions images is still answered (by the AI here).
  assert.deepEqual(open.map((entry) => entry.id), ['ml']);
  // "CV with photo" and a document upload that also takes images are still the résumé.
  const cv = answers.resolveFields([
    field('CV with photo', { id: 'cv', kind: 'file' }),
    field('Resume', { id: 'resume', kind: 'file', accept: '.pdf,.doc,.docx,.png' }),
  ], candidate, []);
  assert.equal(cv.answers.cv.file, 'resume');
  assert.equal(cv.answers.resume.file, 'resume');
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

test('a personal fact the profile lacks is left for the Manager; one in another language is the same fact; a missing policy goes to the AI', () => {
  const { answers: resolved, open, missing, byHand } = answers.resolveFields([
    field('Are you willing to relocate?', { kind: 'radio', options: ['Yes', 'No'] }),
    field('Country', { kind: 'select', options: ['Polska', 'Niemcy', 'Czechy'] }),
    field('What is your nationality?'),
  ], { ...candidate, willingToRelocate: null, nationality: null }, []);
  // "Poland" is "Polska" in the list's language: the profile's fact, not a guess.
  assert.equal(resolved.Country.value, 'Polska');
  assert.equal(resolved.Country.intended, 'Poland');
  assert.deepEqual(missing.map((entry) => entry.fact), ['relocation']);
  assert.match(open.find((entry) => entry.id === 'Are you willing to relocate?').hint, /has no relocation/);
  // Never asked of the AI: the Manager fills it or adds it to the profile.
  assert.equal(open.some((entry) => entry.id === 'What is your nationality?'), false);
  assert.match(byHand[0].message, /profile has no nationality: fill "What is your nationality\?" by hand, or add it to the profile/);
});

test('a profile fact the AI gave in the field\'s form must still say the same', () => {
  const country = { fact: 'country', intended: 'Romania' };
  assert.equal(answers.keepsMeaning(country, 'Rumunia'), true);
  assert.equal(answers.keepsMeaning(country, 'RO'), true);
  assert.equal(answers.keepsMeaning(country, 'United Kingdom'), false);
  assert.equal(answers.keepsMeaning({ fact: 'phone', intended: '+40264420463' }, '0264 420 463'), true);
  assert.equal(answers.keepsMeaning({ fact: 'phone', intended: '+40264420463' }, '+40 111 222 333'), false);
  assert.equal(answers.keepsMeaning({ fact: 'birthday', intended: '1994-03-07' }, '07/03/1994'), true);
  assert.equal(answers.keepsMeaning({ fact: 'birthday', intended: '1994-03-07' }, '07/04/1994'), false);
  assert.equal(answers.keepsMeaning({ fact: 'nationality', intended: 'Romanian' }, 'Romania'), true);
  // Questions that are not profile facts are not checked here.
  assert.equal(answers.keepsMeaning({ intended: 'Yes' }, 'No'), true);
  // The same country in another language, or by its code; never a look-alike.
  assert.equal(answers.sameFactOption('country', 'Romania', ['Roumanie', 'Royaume-Uni']), 'Roumanie');
  assert.equal(answers.sameFactOption('country', 'UK', ['Ukraine', 'United Kingdom']), 'United Kingdom');
  assert.equal(answers.sameFactOption('country', 'Guinea', ['Papua New Guinea', 'Equatorial Guinea']), null);
  assert.equal(answers.sameFactOption('nationality', 'Polish', ['Polska', 'Niemcy']), 'Polska');
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

test('the profile comes first, then a reusable answer that fits, else the reusable answer as a hint', () => {
  const reusable = [
    { questionKey: answers.normalizeQuestionKey('How did you hear about us?'), questionText: 'How did you hear about us?', answer: 'LinkedIn job post', note: 'Pick the closest choice.' },
    { questionKey: answers.normalizeQuestionKey('Do you know anyone working at the company?'), questionText: 'Do you know anyone working at the company?', answer: 'No' },
    { questionKey: answers.normalizeQuestionKey('Email address'), questionText: 'Email address', answer: 'shared@example.com' },
    { questionKey: answers.normalizeQuestionKey('Are you open to business travel?'), questionText: 'Are you open to business travel?', answer: 'Yes' },
  ];
  const { answers: resolved, open } = answers.resolveFields([
    field('Email'),
    field('How did you hear about this job?'),
    field('How did you hear about us?', { id: 'choices', kind: 'select', options: ['Job board', 'Referral', 'Social media'] }),
    field('Do you know any employee working at the company?', { kind: 'radio', options: ['Yes', 'No'] }),
    field('I am open to business travel', { kind: 'checkbox', required: false }),
  ], candidate, reusable);
  assert.equal(resolved.Email.value, 'anna@example.com');
  assert.equal(resolved['How did you hear about this job?'].value, 'LinkedIn job post');
  assert.equal(resolved['How did you hear about this job?'].source, 'reusable');
  assert.equal(resolved['Do you know any employee working at the company?'].value, 'No');
  assert.equal(resolved['I am open to business travel'].value, true);
  assert.deepEqual(open.map((entry) => entry.id), ['choices']);
  assert.match(open[0].hint, /reusable answer for this question is "LinkedIn job post" \(note: Pick the closest choice\.\)/);
});

test('every reusable answer reaches the AI as context, with its note', () => {
  const prompt = answers.buildAnswerPrompt({
    job: { title: 'SRE', company: 'Acme' },
    candidate,
    fields: [field('Where did you find this position?')],
    savedAnswers: [{ questionText: 'How did you hear about us?', answer: 'LinkedIn job post', note: 'Pick the closest choice.' }],
  });
  assert.match(prompt, /How did you hear about us\?: LinkedIn job post \(note: Pick the closest choice\.\)/);
});

test('reusable salary, notice, sponsorship, right-to-work, and employment-type answers come before the profile, by topic', () => {
  const row = (questionText, answer) => ({ questionKey: answers.normalizeQuestionKey(questionText), questionText, answer });
  const reusable = [
    row('What is your salary expectation?', '5000 EUR per month'),
    row('What is your notice period?', '2 weeks'),
    row('Will you require visa sponsorship?', 'No'),
    row('Are you legally authorized to work in the EU?', 'Yes'),
    row('What employment type are you interested in?', 'Permanent'),
    row('Does the advertised salary align with your expectations?', 'Yes'),
  ];
  const profile = { ...candidate, needsSponsorship: true, salaryExpectationAmount: 70000, salaryExpectationPeriod: 'year' };
  const { answers: resolved, open } = answers.resolveFields([
    field('Desired Pay'),
    field('Expected hourly rate', { kind: 'number' }),
    field('Date Available', { kind: 'date' }),
    field('What is your notice period?', { id: 'notice', kind: 'select', options: ['Immediately', '2 weeks', '1 month'] }),
    field("Will you require Elastic's sponsorship to continue or extend your work authorization?", { id: 'sponsor', kind: 'select', options: ['Yes', 'No'] }),
    field('Are you legally authorized to work in Poland?', { id: 'poland', kind: 'radio', options: ['Yes', 'No'] }),
    field('What employment type are you interested in?', { id: 'type', kind: 'checkbox-group', options: ['Permanent', 'Temporary', 'Secondments'] }),
    field('Does the advertised salary align with your expectations?', { id: 'align', kind: 'radio', options: ['Yes', 'No'] }),
  ], profile, reusable, { today: new Date(2026, 9, 26) });
  assert.deepEqual(open, []);
  assert.equal(resolved['Desired Pay'].value, '5000 EUR per month');
  assert.equal(resolved['Desired Pay'].source, 'reusable');
  assert.equal(resolved['Expected hourly rate'].value, '28.85');
  assert.equal(resolved['Date Available'].value, '2026-11-09');
  assert.equal(resolved.notice.value, '2 weeks');
  assert.equal(resolved.sponsor.value, 'No');
  assert.equal(resolved.poland.value, 'Yes');
  assert.deepEqual(resolved.type.value, ['Permanent']);
  assert.equal(resolved.align.value, 'Yes');
});

test('without reusable answers on those topics, the profile facts still answer them', () => {
  const { answers: resolved } = answers.resolveFields([
    field('Desired Pay'),
    field('Will you require visa sponsorship?', { kind: 'radio', options: ['Yes', 'No'] }),
  ], candidate, []);
  assert.equal(resolved['Desired Pay'].value, '70000 EUR per year');
  assert.equal(resolved['Desired Pay'].source, 'profile');
  assert.equal(resolved['Will you require visa sponsorship?'].value, 'No');
});

test('with static facts only, relocation and notice come from reusable answers; without one, notice is the usual 1 week', () => {
  const staticProfile = { firstName: 'Anna', lastName: 'Kowalska', email: 'anna@example.com', nationality: 'Polish', languages: 'English C1', yearsOfExperience: 8, eeoPreference: 'prefer_not_to_say' };
  const row = (questionText, answer) => ({ questionKey: answers.normalizeQuestionKey(questionText), questionText, answer });
  const { answers: resolved } = answers.resolveFields([
    field('Are you willing to relocate?', { kind: 'radio', options: ['Yes', 'No'] }),
    field('Notice period'),
  ], staticProfile, [row('Would you relocate for this role?', 'No'), row('What is your notice period?', '1 month')]);
  assert.equal(resolved['Are you willing to relocate?'].value, 'No');
  assert.equal(resolved['Notice period'].value, '1 month');

  const { answers: usual, open, missing } = answers.resolveFields([
    field('Notice period'),
    field('Date available', { kind: 'date' }),
    field('When can you start?', { id: 'choice', kind: 'select', options: ['Immediately', '1 week', '2 weeks', '1 month'] }),
    field('Will you require visa sponsorship?', { kind: 'radio', options: ['Yes', 'No'] }),
  ], staticProfile, [], { today: new Date(2026, 9, 26) });
  assert.equal(usual['Notice period'].value, '1 week');
  assert.equal(usual['Date available'].value, '2026-11-02');
  assert.equal(usual.choice.value, '1 week');
  assert.deepEqual(missing.map((entry) => entry.fact), ['visa sponsorship']);
  assert.deepEqual(open.map((entry) => entry.id), ['Will you require visa sponsorship?']);
});

test('diversity questions take Super Admin\'s reusable answers by topic, else decline, never a guess', () => {
  const row = (questionText, answer) => ({ questionKey: answers.normalizeQuestionKey(questionText), questionText, answer });
  const reusable = [row('Gender', 'Prefer not to say'), row('Veteran status', 'I am not a protected veteran')];
  const { answers: resolved, open } = answers.resolveFields([
    field('What is your gender identity?', { kind: 'select', options: ['Man', 'Woman', 'Non-binary', 'Prefer not to say'] }),
    field('Protected veteran status', { kind: 'radio', options: ['I am a protected veteran', 'I am not a protected veteran', 'I decline to answer'] }),
    field('Race / Ethnicity', { kind: 'select', options: ['Asian', 'White', 'Decline to self-identify'] }),
    field('Sexual orientation', { required: false, kind: 'select', options: ['Heterosexual', 'Gay', 'Bisexual'] }),
    field('Gender', { id: 'no-decline', kind: 'radio', options: ['Male', 'Female'] }),
  ], { firstName: 'Anna', lastName: 'Kowalska' }, reusable);
  assert.equal(resolved['What is your gender identity?'].value, 'Prefer not to say');
  assert.equal(resolved['Protected veteran status'].value, 'I am not a protected veteran');
  assert.equal(resolved['Race / Ethnicity'].value, 'Decline to self-identify');
  assert.equal(resolved['Sexual orientation'], undefined);
  // "Prefer not to say" is not a choice here: the AI gets the reusable answer and is told not to guess.
  assert.deepEqual(open.map((entry) => entry.id), ['no-decline']);
  assert.match(open[0].hint, /"Prefer not to say".*never infer it from the name/);
});

test('diversity questions take the candidate\'s own profile answers, in each form\'s wording', () => {
  const own = { firstName: 'Anna', lastName: 'Kowalska', gender: 'woman', ethnicity: 'white', veteranStatus: 'not_veteran', disabilityStatus: 'no', sexualOrientation: 'prefer_not_to_say' };
  const { answers: resolved, open } = answers.resolveFields([
    field('Gender', { kind: 'select', options: ['Male', 'Female', 'Decline to self-identify'] }),
    field('Race / Ethnicity', { kind: 'select', options: ['Asian', 'White (Not Hispanic or Latino)', 'Decline to self-identify'] }),
    field('Are you Hispanic or Latino?', { id: 'hispanic', kind: 'radio', options: ['Yes', 'No', 'Decline to self-identify'] }),
    field('Protected veteran status', { kind: 'radio', options: ['I identify as one or more of the classifications of protected veteran', 'I am not a protected veteran', "I don't wish to answer"] }),
    field('Disability Confident', { kind: 'radio', options: ['Yes, I would like to be considered under this scheme', "No, this isn't relevant"] }),
    field('Sexual orientation', { kind: 'select', options: ['Heterosexual', 'Gay', 'I prefer not to say'] }),
    field('Gender identity', { id: 'woman-text' }),
    field('Gender', { id: 'two-choices', kind: 'radio', options: ['Man', 'Lady'] }),
  ], own, [{ questionKey: 'gender', questionText: 'Gender', answer: 'Prefer not to say' }]);
  assert.equal(resolved.Gender.value, 'Female');
  assert.equal(resolved['Race / Ethnicity'].value, 'White (Not Hispanic or Latino)');
  assert.equal(resolved.hispanic.value, 'No');
  assert.equal(resolved['Protected veteran status'].value, 'I am not a protected veteran');
  assert.equal(resolved['Disability Confident'].value, "No, this isn't relevant");
  assert.equal(resolved['Sexual orientation'].value, 'I prefer not to say');
  assert.equal(resolved['woman-text'].value, 'Female');
  // No choice says "Female": the AI gets the profile's answer, told never to guess.
  assert.deepEqual(open.map((entry) => entry.id), ['two-choices']);
  assert.match(open[0].hint, /profile says "Female".*never infer/i);
});

test('a question naming the candidate\'s own country is a Yes from the profile', () => {
  const sanctions = { questionKey: 'are you located in one of the following countries or regions', questionText: 'Are you located in one of the following countries or regions?', answer: 'No', note: null };
  const { answers: resolved, open } = answers.resolveFields([
    field('Are you based in Romania, Serbia, Poland or Bulgaria?', { kind: 'radio', options: ['YES', 'NO'] }),
    field('Do you live in Warsaw or Krakow?', { kind: 'checkbox' }),
    field('Are you located in Germany or Austria?', { kind: 'radio', options: ['Yes', 'No'] }),
  ], candidate, [sanctions]);
  assert.deepEqual(resolved['Are you based in Romania, Serbia, Poland or Bulgaria?'], { value: 'YES', source: 'profile' });
  assert.deepEqual(resolved['Do you live in Warsaw or Krakow?'], { value: true, source: 'profile' });
  // A list without the candidate's country is not decided by this rule.
  assert.equal(resolved['Are you located in Germany or Austria?']?.source === 'profile', false);
  assert.ok(resolved['Are you located in Germany or Austria?'] || open.some((entry) => entry.label === 'Are you located in Germany or Austria?'));
});

test('the answer prompt gets the delivered résumé and cover letter as plain text', () => {
  const prompt = answers.buildAnswerPrompt({
    template: 'R: {{resume}}\nC: {{cover_letter}}\nBoth: {{resume_and_cover_letter}}\n{{questions}}',
    job: { title: 'DevOps Engineer', company: 'Acme', description: 'Kubernetes' },
    candidate,
    resumeText: 'Anna Kowalska\nKubernetes at Acme',
    coverLetterText: 'Dear Hiring Team,',
    fields: [field('Why Acme?')],
    savedAnswers: [],
  });
  assert.match(prompt, /R: Anna Kowalska\nKubernetes at Acme/);
  assert.match(prompt, /C: Dear Hiring Team,/);
  assert.match(prompt, /Both: Résumé:\nAnna Kowalska[\s\S]*Cover letter:\nDear Hiring Team,/);
  // Without them, the placeholders say so rather than staying as braces.
  const bare = answers.buildAnswerPrompt({ template: '{{resume}} {{cover_letter}} {{questions}}', job: {}, candidate, fields: [field('Why?')], savedAnswers: [] });
  assert.match(bare, /^\(none\) \(none\)/);
});

test('a remembered choice fills a value that did not fit, only on the same question and choices', () => {
  const field = { id: 'f', label: 'Right to work in the UK? *', kind: 'select', options: ['No', 'Yes, I have ILR', 'Yes, I am a British citizen'] };
  const remembered = [{
    questionKey: answers.normalizeQuestionKey('Right to work in the UK?'),
    optionsKey: answers.optionsKey(['Yes, I am a British citizen', 'Yes, I have ILR', 'No']),
    intended: 'Yes',
    choice: 'Yes, I have ILR',
  }];
  assert.equal(answers.findRememberedChoice(field, 'yes', remembered), 'Yes, I have ILR');
  assert.equal(answers.findRememberedChoice(field, 'No', remembered), null);
  assert.equal(answers.findRememberedChoice({ ...field, options: ['Yes', 'No'] }, 'Yes', remembered), null);
  assert.equal(answers.findRememberedChoice({ ...field, label: 'Other question' }, 'Yes', remembered), null);
  // The server keys choice lists the same way.
  assert.equal(answers.optionsKey(['B', ' a ']), 'a|b');
});

test('a reusable yes or no is the list\'s own yes or no, in any language; other answers carry the value meant', () => {
  const row = (question, answer) => ({ questionKey: answers.normalizeQuestionKey(question), questionText: question, answer, note: null });
  const { answers: resolved } = answers.resolveFields([
    field('Do you have the right to work?', { kind: 'select', options: ['Yes, I have ILR', 'No'] }),
    field('Czy wyrażasz zgodę na badanie przeszłości?', { kind: 'radio', options: ['Tak', 'Nie'] }),
  ], candidate, [row('Do you have the right to work?', 'Yes'), row('Czy wyrażasz zgodę na badanie przeszłości?', 'No')]);
  assert.equal(resolved['Do you have the right to work?'].value, 'Yes, I have ILR');
  assert.equal(resolved['Do you have the right to work?'].intended, 'Yes');
  assert.equal(resolved['Czy wyrażasz zgodę na badanie przeszłości?'].value, 'Nie');
  // Not a yes or no: the AI gives it in the field's form, keeping the meaning (checked after).
  const { open } = answers.resolveFields([field('Preferred interview format', { kind: 'select', options: ['Video call', 'Phone call', 'On-site'] })],
    candidate, [row('Preferred interview format', 'Online, via Teams')]);
  assert.equal(open[0].intended, 'Online, via Teams');
  assert.equal(open[0].fact, 'answer');
  // A reusable yes never comes back from the AI as a no.
  assert.equal(answers.keepsMeaning({ fact: 'answer', intended: 'Yes' }, 'No, I need sponsorship'), false);
  assert.equal(answers.keepsMeaning({ fact: 'answer', intended: 'Yes' }, 'Yes, I have ILR'), true);
  assert.equal(answers.keepsMeaning({ fact: 'answer', intended: 'One month' }, '2026-11-28'), true);
});

test('the AI sees help text, lists it could not read, and lists that take several choices', () => {
  const fields = [
    field('How many years of experience do you have in Data Science?', { kind: 'combobox' }),
    field('Which responsible AI principles have you implemented? (Select all that apply)', { kind: 'combobox', multiple: true }),
    field('What is your salary expectation?', { note: 'Gross annual, in EUR', placeholder: 'e.g. 60000' }),
  ];
  const prompt = answers.buildAnswerPrompt({ job: {}, candidate, fields });
  assert.match(prompt, /"choicesUnknown":true/);
  assert.doesNotMatch(prompt, /"options":"/);
  assert.match(prompt, /"multiple":true/);
  assert.match(prompt, /"note":"Gross annual, in EUR","placeholder":"e.g. 60000"/);
  assert.match(prompt, /every option that truly fits/);
  const reply = JSON.stringify({ answers: [
    { id: fields[0].id, value: '3-5 years' },
    { id: fields[1].id, value: 'Model explainability | Bias testing' },
    { id: fields[2].id, value: '60000 EUR per year' },
  ] });
  const { answers: usable, invalid } = answers.parseAnswerReply(reply, fields);
  assert.deepEqual(invalid, []);
  assert.deepEqual(usable[fields[1].id].value, ['Model explainability', 'Bias testing']);
  // Once the list's choices are known, several are checked against them.
  const known = { ...fields[1], options: ['Model explainability', 'Bias testing', 'Privacy by design'] };
  assert.deepEqual(answers.parseAnswerReply(JSON.stringify({ answers: [{ id: known.id, value: 'bias testing | Privacy by design' }] }), [known]).answers[known.id].value, ['Bias testing', 'Privacy by design']);
});

test('the candidate\'s own country and city fill "Country/Region" and "City/Town", never the job\'s', () => {
  const daniel = { ...candidate, city: 'Cluj-Napoca', country: 'Romania' };
  const fields = [
    field('Country/Region*', { kind: 'combobox' }),
    field('Country / Territory'),
    field('Region/Country'),
    field('Country of residence'),
    field('City/Town'),
    field('State/Region'),
  ];
  const { answers: resolved } = answers.resolveFields(fields, daniel, []);
  assert.equal(resolved['Country/Region*'].value, 'Romania');
  assert.equal(resolved['Country / Territory'].value, 'Romania');
  assert.equal(resolved['Region/Country'].value, 'Romania');
  assert.equal(resolved['Country of residence'].value, 'Romania');
  assert.equal(resolved['City/Town'].value, 'Cluj-Napoca');
  assert.notEqual(resolved['State/Region']?.value, 'Romania');
  const prompt = answers.buildAnswerPrompt({ job: { location: 'London, United Kingdom' }, candidate: daniel, fields: [field('Where would you work from?')] });
  assert.match(prompt, /"livesIn":"Cluj-Napoca, Romania"/);
  assert.match(prompt, /never from the job's location/);
});

test('other people\'s details and yes/no questions never get the candidate\'s own facts', () => {
  const fields = ['Emergency contact phone number', 'Reference email', 'Referee\'s phone number', 'Are you available for a phone screen?', 'Do you have a mobile phone?']
    .map((label) => field(label));
  const { answers: resolved } = answers.resolveFields(fields, candidate, []);
  for (const entry of fields) assert.equal(resolved[entry.id], undefined, entry.label);
  // Labels in other languages and forms are still the candidate's own.
  const own = ['Telefonnummer', 'Wohnort', 'Land', 'PLZ', 'Straße und Hausnummer', 'Staatsangehörigkeit', 'Forename', 'Contact number', 'Postal address']
    .map((label) => field(label));
  const { answers: filled } = answers.resolveFields(own, { ...candidate, city: 'Cluj-Napoca', country: 'Romania', postalCode: '400001', addressLine1: 'Str. Exemplu 1', nationality: 'Romanian' }, []);
  for (const entry of own) assert.ok(filled[entry.id]?.value, entry.label);
  assert.match(filled['Postal address'].value, /Str\. Exemplu 1, 400001 Cluj-Napoca/);
});

test('a dropdown whose choices could not be read takes the AI\'s wordings in order; several choices stay several', () => {
  const years = field('How many years of experience do you have?', { kind: 'combobox' });
  const principles = field('Which principles have you applied? (Select all that apply)', { kind: 'combobox', multiple: true });
  const known = field('Level', { kind: 'combobox', options: ['Junior', 'Senior'] });
  const reply = JSON.stringify({ answers: [
    { id: years.id, value: ['5-8 years', '5+ years', '5-8 years', 'More than 5 years', 'Over 5', 'Extra'] },
    { id: principles.id, value: ['Bias testing', 'Privacy by design'] },
    { id: known.id, value: ['Lead', 'senior'] },
  ] });
  const { answers: usable, invalid } = answers.parseAnswerReply(reply, [years, principles, known]);
  assert.deepEqual(invalid, []);
  assert.equal(usable[years.id].value, '5-8 years');
  assert.deepEqual(usable[years.id].alternatives, ['5+ years', 'More than 5 years', 'Over 5']);
  assert.deepEqual(usable[principles.id].value, ['Bias testing', 'Privacy by design']);
  assert.equal(usable[principles.id].alternatives, undefined);
  // Known choices: the first wording that is one of them.
  assert.equal(usable[known.id].value, 'Senior');
  assert.match(answers.buildAnswerPrompt({ job: {}, candidate, fields: [years] }), /up to 4 wordings/);
});

test('every answer prompt, Super Admin\'s too, asks for the strongest true answer for this job', () => {
  const fields = [field('Years of Python?', { kind: 'select', options: ['0-2', '3-5', '6+'] })];
  for (const template of [undefined, 'Answer for {{company}}.\n{{questions}}']) {
    const prompt = answers.buildAnswerPrompt({ template, job: { company: 'Acme' }, candidate, fields });
    assert.match(prompt, /best qualifies the candidate for this job/);
    assert.match(prompt, /the highest level, range, or count the résumé supports/);
    assert.match(prompt, /never claim what the résumé does not show/);
  }
  // The fix-up request keeps the same goal.
  assert.match(answers.buildFixPrompt([{ id: fields[0].id, label: fields[0].label, reason: 'not an option' }], fields), /best qualifies the candidate/);
});

test('a phone question shown as a country-code list takes the number\'s own code', () => {
  assert.equal(answers.sameFactOption('phone', '+40264484948', ['+48', '+44', '+40']), '+40');
  assert.equal(answers.sameFactOption('phone', '+420601234567', ['+4', '+42', '+420']), '+420');
  assert.equal(answers.sameFactOption('phone', '+40264484948', ['Poland (+48)', 'Romania (+40)']), 'Romania (+40)');
  assert.equal(answers.sameFactOption('phone', '0264484948', ['+40']), null);
  const { answers: resolved } = answers.resolveFields([field('Telephone*', { kind: 'select', options: ['+48', '+44', '+40'] })], { ...candidate, phone: '+40264484948' }, []);
  assert.equal(resolved['Telephone*'].value, '+40');
});

test('a box no text names for sure is never asked of the AI; a fact its name hint matches still fills it', () => {
  const fields = [
    field('first name', { labelUnresolved: true }),
    field('q 17', { labelUnresolved: true }),
    field('notes', { labelUnresolved: true, required: false }),
  ];
  const { answers: resolved, open, byHand } = answers.resolveFields(fields, { ...candidate, firstName: 'Daniel' }, []);
  assert.equal(resolved['first name'].value, 'Daniel');
  assert.equal(open.length, 0);
  assert.deepEqual(byHand.map((entry) => entry.id), ['q 17']);
  assert.match(byHand[0].message, /couldn't tell which question this box is for \("q 17"\)/);
});

test('a native multi-select takes several choices, each one of its options', () => {
  const languages = field('Languages you speak', { kind: 'select', multiple: true, options: ['English', 'German', 'Polish'] });
  const reply = JSON.stringify({ answers: [{ id: languages.id, value: 'English | polish' }] });
  assert.deepEqual(answers.parseAnswerReply(reply, [languages]).answers[languages.id].value, ['English', 'Polish']);
  assert.match(answers.buildAnswerPrompt({ job: {}, candidate, fields: [languages] }), /"multiple":true/);
  const wrong = JSON.stringify({ answers: [{ id: languages.id, value: 'English | Klingon' }] });
  assert.match(answers.parseAnswerReply(wrong, [languages]).invalid[0].reason, /"Klingon" is not one of the options/);
});

test('a list read only in part takes the AI\'s own wording; a complete one does not', () => {
  const partial = field('City', { kind: 'combobox', options: ['Cluj-Napoca', 'Turda'], optionsPartial: true });
  const complete = field('Region', { kind: 'combobox', options: ['Cluj', 'Bihor'] });
  const reply = JSON.stringify({ answers: [{ id: partial.id, value: 'Oradea' }, { id: complete.id, value: 'Mazowieckie' }] });
  const { answers: usable, invalid } = answers.parseAnswerReply(reply, [partial, complete]);
  assert.equal(usable[partial.id].value, 'Oradea');
  assert.deepEqual(invalid.map((entry) => entry.id), [complete.id]);
  assert.match(answers.buildAnswerPrompt({ job: {}, candidate, fields: [partial] }), /"optionsPartial":true/);
});

test('the AI may say nothing supports an answer: that question is neither filled nor asked again', () => {
  const fields = [
    field('GitHub username', { required: true }),
    field('Years of Python?', { kind: 'select', options: ['0-2', '3-5', '6+'] }),
    field('Your city', { labelConfidence: 'low' }),
  ];
  const prompt = answers.buildAnswerPrompt({ job: {}, candidate, fields });
  assert.match(prompt, /"status":"ready"/);
  assert.match(prompt, /status "review" with value null and a short "reason"/);
  assert.match(prompt, /"labelUncertain":true/);
  const reply = JSON.stringify({ answers: [
    { id: 'GitHub username', value: null, status: 'review' },
    { id: 'Years of Python?', value: '6+', status: 'ready' },
    { id: 'Your city', value: 'Warsaw' },
  ] });
  const parsed = answers.parseAnswerReply(reply, fields);
  assert.deepEqual(parsed.review, [{ id: 'GitHub username', label: 'GitHub username' }]);
  assert.deepEqual(parsed.invalid, []);
  assert.equal(parsed.answers['Years of Python?'].value, '6+');
  assert.equal(parsed.answers['GitHub username'], undefined);
  // A reply that is not JSON at all: every question is invalid, nothing is filled.
  const broken = answers.parseAnswerReply('Sure! Here are the answers: years 6+', fields);
  assert.deepEqual(Object.keys(broken.answers), []);
  assert.equal(broken.invalid.length, 3);
  // An answer that is not one of a complete list's options is refused, never matched loosely.
  assert.match(answers.parseAnswerReply(JSON.stringify({ answers: [{ id: 'Years of Python?', value: '6' }] }), [fields[1]]).invalid[0].reason, /"6" is not one of the options/);
});

test('an upload named only "Upload file" takes the document its section heading names', () => {
  const resolve = (...fields) => answers.resolveFields(fields, candidate, []).answers;
  // A cover-letter step (one upload per step): required, generic name, heading "Add a cover letter".
  assert.equal(resolve(field('Upload file', { kind: 'file', section: 'Add a cover letter' }))['Upload file'].file, 'coverLetter');
  assert.equal(resolve(field('Drag & drop', { kind: 'file', required: false, section: 'Confirm your cover letter' }))['Drag & drop'].file, 'coverLetter');
  assert.equal(resolve(field('Upload file', { kind: 'file', section: 'Upload your CV' }))['Upload file'].file, 'resume');
  // A heading naming both documents decides nothing: a required box still takes the résumé.
  assert.equal(resolve(field('Upload file', { kind: 'file', section: 'Your CV and cover letter' }))['Upload file'].file, 'resume');
  // The box's own name comes first.
  assert.equal(resolve(field('Resume', { kind: 'file', section: 'Add a cover letter' })).Resume.file, 'resume');
  // Other languages.
  for (const label of ['Anschreiben', 'Motivationsschreiben', 'List motywacyjny', 'Lettre de motivation', 'Carta de presentación', 'Motivation letter']) {
    assert.equal(resolve(field(label, { kind: 'file' }))[label].file, 'coverLetter', label);
  }
  assert.equal(resolve(field('Lebenslauf', { kind: 'file' })).Lebenslauf.file, 'resume');
  // With a résumé box on the page, an optional general box under a cover-letter heading is the letter.
  const both = resolve(field('Resume/CV', { kind: 'file' }), field('Attach file', { kind: 'file', required: false, section: 'Cover letter (optional)' }));
  assert.deepEqual([both['Resume/CV'].file, both['Attach file'].file], ['resume', 'coverLetter']);
});

test('Auto Apply checks an AI answer against the documents and approved facts before it is filled', () => {
  const sources = answers.factSources({
    candidate: { firstName: 'Ana', yearsOfExperience: 6 },
    resumeText: 'Backend engineer since 2019. Python, Django, AWS, PostgreSQL. Led a team of 4.',
    savedAnswers: [{ questionKey: 'do you require visa sponsorship', questionText: 'Do you require visa sponsorship?', answer: 'No' }],
    job: { description: 'We need Kubernetes, Terraform and Python. Strong communication. 5+ years.', title: 'Backend Engineer', company: 'Globex' },
  });
  const field = (label, kind = 'textarea', options) => ({ label, kind, options });
  const verdict = (f, value) => answers.verifyAiAnswer(f, value, sources);
  // Supported by the résumé: filled.
  assert.equal(verdict(field('Describe your backend experience'), 'I have built Python and Django services on AWS since 2019 and led a team of 4.').ok, true);
  assert.equal(verdict(field('Why Globex?'), 'Strong communication matters to me. Globex builds reliable systems.').ok, true);
  assert.equal(verdict(field('Years of experience with Python?', 'select', ['1-3', '4-5', '6+']), '6+').ok, true);
  // Not supported: a skill only the job names, an invented number, more years than the profile, a contradiction.
  assert.match(verdict(field('Describe your backend experience'), 'I run Kubernetes clusters with Terraform.').reason, /Kubernetes, Terraform/);
  assert.match(verdict(field('Describe your backend experience'), 'Kubernetes is what I use daily.').reason, /Kubernetes/);
  assert.match(verdict(field('Team size you managed'), 'I managed 12 engineers.').reason, /number 12/);
  assert.match(verdict(field('How many years of experience with Python do you have?', 'number'), '8').reason, /8\+ years/);
  assert.match(verdict(field('Will you require visa sponsorship?', 'radio', ['Yes', 'No']), 'Yes').reason, /approved answer says "No"/);
  // Without sources (the assistant, the dormant engine) nothing is checked.
  assert.equal(answers.verifyAiAnswer(field('Anything'), 'Kubernetes 12', null).ok, true);
});

test('Auto Apply\'s prompt leaves out contact and diversity facts and shortens the job description', () => {
  const job = { title: 'Engineer', company: 'Acme', description: 'x'.repeat(9000) };
  const fields = [{ id: 'q1', label: 'Why Acme?', kind: 'textarea' }];
  const full = answers.buildAnswerPrompt({ job, candidate: { ...candidate, genderIdentity: 'woman' }, resumeText: 'CV', coverLetterText: 'Letter', fields, today: new Date('2026-10-29') });
  const minimal = answers.buildAnswerPrompt({ job, candidate: { ...candidate, genderIdentity: 'woman' }, resumeText: 'CV', coverLetterText: 'Letter', fields, today: new Date('2026-10-29'), minimal: true });
  assert.match(full, /anna@example\.com/);
  assert.doesNotMatch(minimal, /anna@example\.com|600 100 200|linkedin\.com/);
  assert.ok(minimal.length < full.length - 2500, `minimal ${minimal.length} vs full ${full.length}`);
  assert.match(minimal, /Why Acme\?/);
});

test('Auto Apply: no built-in notice default; the assisted Apply keeps it', () => {
  const person = { firstName: 'Ana', lastName: 'Test', country: 'Romania', city: 'Cluj-Napoca' };
  const fields = [{ id: 'n', label: 'Notice Period', kind: 'text', required: true }, { id: 's', label: 'When can you start? *', kind: 'text', required: true }];
  const assisted = answers.resolveFields(fields, person, [], { today: new Date('2026-10-29') });
  assert.equal(assisted.answers.n.value, '1 week');
  const auto = answers.resolveFields(fields, person, [], { today: new Date('2026-10-29'), autoApply: true });
  assert.equal(auto.answers.n, undefined);
  assert.deepEqual(auto.byHand.map((entry) => entry.id), ['n', 's']);
  assert.match(auto.byHand[0].message, /no notice period or start date/);
  // A notice Super Admin approved is used.
  const approved = answers.resolveFields(fields, person, [{ questionKey: 'what is your notice period', questionText: 'What is your notice period?', answer: '2 weeks', scope: 'everyone' }], { today: new Date('2026-10-29'), autoApply: true });
  assert.equal(approved.answers.n.value, '2 weeks');
  // Nor is the default told to the AI as the candidate's own.
  const prompt = answers.buildAnswerPrompt({ candidate: person, job: { title: 'Engineer', company: 'Acme', description: '' }, fields: [{ id: 'q', label: 'Why Acme?', kind: 'textarea' }], minimal: true });
  assert.doesNotMatch(prompt, /"noticePeriod"|"earliestStartDate"/);
});

test('Auto Apply: country and location asked as whole questions; the assisted Apply unchanged', () => {
  const person = { firstName: 'Ana', lastName: 'Test', country: 'Romania', city: 'Cluj-Napoca' };
  const labels = ['What is your current country of residence?*', 'Please choose the country in which you are located.', 'What country are you based in?', 'What country do you currently live in? *', 'What is your location?'];
  const fields = labels.map((label, index) => ({ id: `f${index}`, label, kind: 'text', required: true }));
  const auto = answers.resolveFields(fields, person, [], { autoApply: true });
  assert.deepEqual(fields.map((field) => auto.answers[field.id]?.value), ['Romania', 'Romania', 'Romania', 'Romania', 'Cluj-Napoca, Romania']);
  const assisted = answers.resolveFields(fields, person, []);
  assert.deepEqual(fields.map((field) => assisted.answers[field.id]?.value), [undefined, undefined, undefined, undefined, undefined]);
  // A list of countries takes the country (Lever's "What is your location?").
  const list = answers.resolveFields([{ id: 'l', label: 'What is your location?', kind: 'select', options: ['Afghanistan', 'Romania', 'Spain'] }], person, [], { autoApply: true });
  assert.equal(list.answers.l.value, 'Romania');
  // A yes/no question naming another country of residence is not this rule's.
  const yesNo = answers.resolveFields([{ id: 'y', label: 'Will you relocate to another country of residence?', kind: 'text' }], person, [], { autoApply: true });
  assert.equal(yesNo.answers.y, undefined);
});

test('Auto Apply: an approved answer matches the same question in other words (job / position / opportunity)', () => {
  const saved = [{ questionKey: 'how did you hear about this position', questionText: 'How did you hear about this position?', answer: 'LinkedIn', note: null, scope: 'everyone' }];
  const labels = ['How did you hear about this job?*', 'Please tell us how you heard about this opportunity.', 'How did you first hear about this role? *'];
  const fields = labels.map((label, index) => ({ id: `h${index}`, label, kind: 'text', required: true }));
  const auto = answers.resolveFields(fields, { firstName: 'Ana' }, saved, { autoApply: true });
  assert.deepEqual(fields.map((field) => [auto.answers[field.id]?.value, auto.answers[field.id]?.source]), [['LinkedIn', 'reusable'], ['LinkedIn', 'reusable'], ['LinkedIn', 'reusable']]);
  // Other questions about the role are not taken for it.
  const other = answers.resolveFields([{ id: 'r', label: 'What role are you applying for?', kind: 'text' }, { id: 'f', label: 'Did anyone refer you to this position?', kind: 'text' }], { firstName: 'Ana' }, saved, { autoApply: true });
  assert.equal(other.answers.r, undefined);
  assert.equal(other.answers.f, undefined);
});
