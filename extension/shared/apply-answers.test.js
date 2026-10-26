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
  noticePeriod: '1 month',
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
  assert.equal(resolved['Years of experience'].value, '8');
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
  assert.match(prompt, /never invent/);
});
