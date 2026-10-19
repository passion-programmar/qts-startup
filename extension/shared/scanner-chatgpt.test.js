const assert = require('node:assert/strict');
const test = require('node:test');
const scannerChatGpt = require('./scanner-chatgpt');

test('prompt includes assigned instructions, scoped task context, and package contract', () => {
  const prompt = scannerChatGpt.buildPrompt({
    assignedPrompt: { name: 'Engineering', content: 'Tailor the resume for platform engineering.' },
    jobContext: { jobTitle: 'Software Engineer' },
    candidate: { fullName: 'Taylor Candidate' },
    page: { fields: [{ stableFieldId: 'field:email', label: 'Email' }] },
  });

  assert.match(prompt, /Tailor the resume for platform engineering/);
  assert.match(prompt, /Software Engineer/);
  assert.match(prompt, /Taylor Candidate/);
  assert.match(prompt, /field:email/);
  assert.match(prompt, /Return one JSON object only/);
  assert.match(prompt, /exact page field ID/);
  assert.match(prompt, /never copy sample names\/contact details/);
  assert.match(prompt, /Original Title \| two relevant keywords/);
  assert.match(prompt, /double asterisks/);
  assert.match(prompt, /Always return both resume and coverLetter/);
});

test('prompt supplies a safe built-in instruction when no Manager prompt is assigned', () => {
  const prompt = scannerChatGpt.buildPrompt({ candidate: { fullName: 'Taylor Candidate' } });

  assert.match(prompt, /safe, concise, ATS-friendly application materials/);
  assert.match(prompt, /using only verified candidate profile information/);
});

test('prompt uses the Super-managed default when no Manager prompt is assigned', () => {
  const prompt = scannerChatGpt.buildPrompt({
    defaultPrompt: 'Use the global QTS writing style.',
  });

  assert.match(prompt, /Use the global QTS writing style\./);
  assert.doesNotMatch(prompt, /safe, concise, ATS-friendly application materials/);
});

test('Manager-assigned prompt takes precedence over the Super-managed default', () => {
  const prompt = scannerChatGpt.buildPrompt({
    assignedPrompt: { content: 'Use the assigned Manager style.' },
    defaultPrompt: 'Use the global QTS writing style.',
  });

  assert.match(prompt, /Use the assigned Manager style\./);
  assert.doesNotMatch(prompt, /Use the global QTS writing style\./);
});

test('prompt tells GPT to normalize reusable answers to observed field validation', () => {
  const prompt = scannerChatGpt.buildPrompt({
    page: {
      fields: [{
        stableFieldId: 'field-salary',
        label: 'What are your compensation requirements?',
        fieldType: 'number',
        validation: { inputType: 'number', min: '1000', max: '10000', step: '500' },
        reusableAnswerContext: {
          question: 'Compensation requirements',
          answer: '5000 EUR per month',
        },
      }],
    },
  });

  assert.match(prompt, /page\.fields\[\]\.validation/);
  assert.match(prompt, /numeric inputs or numeric-only input modes/);
  assert.match(prompt, /reusableAnswerContext/);
  assert.match(prompt, /5000 EUR per month/);
  assert.match(prompt, /do not invent currency conversions/);
});

test('extracts raw and fenced JSON packages, including braces inside strings', () => {
  const raw = scannerChatGpt.extractPackage(
    '{"answers":[{"stableFieldId":"field-1","answer":"Use { braces } safely"}]}'
  );
  const fenced = scannerChatGpt.extractPackage(
    '```json\n{"answers":[],"unresolvedFields":[{"stableFieldId":"field-2","question":"Q","reason":"Unknown"}]}\n```'
  );

  assert.equal(raw.answers[0].answer, 'Use { braces } safely');
  assert.equal(fenced.unresolvedFields[0].stableFieldId, 'field-2');
});

test('rejects responses without a valid answers array', () => {
  assert.throws(() => scannerChatGpt.extractPackage('not JSON'), /valid JSON answer package/);
  assert.throws(() => scannerChatGpt.extractPackage('{"unresolvedFields":[]}'), /answers array/);
});

test('rejects an incomplete JSON response while ChatGPT is still generating', () => {
  assert.throws(
    () => scannerChatGpt.extractPackage('{"answers":[{"stableFieldId":"field-1","answer":"Draft'),
    /valid JSON answer package/
  );
});
