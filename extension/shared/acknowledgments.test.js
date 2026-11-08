// Normal Apply ticks acknowledgments, consents and attestations automatically, required or not, even
// when the terms are a link (decision 2026-11-06); marketing and future-contact opt-ins stay unticked.
// Labels are the real ones from the visible real-site tests.
const assert = require('node:assert/strict');
const test = require('node:test');
const answers = require('./apply-answers.js');

const fill = (label, extra = {}) => answers.resolveField({ id: 'f', kind: 'checkbox', label, ...extra }, {}, [], { normalApply: true });

test('acknowledgments from real sites are accepted automatically', () => {
  for (const label of [
    'I have read and accepted the Terms and Conditions and Privacy Policy', // SoftServe (linked terms)
    'I agree', // Ashby (Jimdo), optional
    "I confirm I have read OysterHR's Privacy Notice", // Ashby (Oyster)
    "Yes, I have read and consent to Cotality's Applicant Privacy Statement.", // Workday (Cotality)
    'I accept', // iCIMS (RWS)
  ]) {
    const result = fill(label, { required: false });
    assert.equal(result.value, true, label); assert.equal(result.source, 'consent', label);
  }
  // Sii.pl: a one-option check box group.
  const sii = fill('I consent to the processing of my personal data by Sii sp. z o.o. and its affiliates for the purpose of recruitment', {
    kind: 'checkbox-group', options: ['yes I consent to the processing of my personal data'], required: true });
  assert.deepEqual(sii.value, ['yes I consent to the processing of my personal data']);
  // Greenhouse (Reddit): an "I agree" dropdown.
  const reddit = fill('By selecting "I agree," I understand that the information I have provided as part of this job application will be processed in accordance with Reddit\'s Candidate Privacy Policy.', {
    kind: 'combobox', options: ['I agree', 'I do not agree'], required: true });
  assert.equal(reddit.value, 'I agree');
});

test('marketing and future-contact opt-ins stay unticked', () => {
  for (const label of [
    "I would like to get updates on hot vacancies, company's news, events, and more", // SoftServe
    'WorkWave has my consent to contact me about future job opportunities.', // Lever
    'I agree to receive marketing emails',
  ]) assert.equal(fill(label).value, undefined, label);
});

test('questions that only use "accept" or "agree" about the candidate are not agreements', () => {
  const lower = answers.resolveField({ id: 'f', kind: 'radio', label: 'Are you willing to accept a lower salary?', options: ['Yes', 'No'] }, {}, [], { normalApply: true });
  assert.notEqual(lower?.source, 'consent');
  assert.equal(lower?.value, undefined);
});

test('an agreement list with no single clear yes is left for the Manager', () => {
  const unclear = fill('I acknowledge the data processing terms', { kind: 'select', options: ['Option A', 'Option B'], required: true });
  assert.equal(unclear.value, undefined);
  assert.match(unclear.byHand, /yourself/);
});

test('future-recruitment consent is a reusable answer: a saved Yes ticks it, required or not; none or No leaves it', () => {
  const saved = (answer, scope = 'manager') => [{ id: 's', scope, questionText: 'Consent to future recruitment', questionKey: 'consent to future recruitment', answer }];
  // Workable (Sunscrapers): a required one-option radio.
  const workable = { kind: 'radio', options: ['YES'], required: true };
  const sunscrapers = 'I consent to Sunscrapers Sp. z o.o. processing my data for the purposes of future recruitment processes';
  // Lever (Laminar Projects): an optional check box.
  const laminar = 'Yes, Laminar Projects can contact me about future job opportunities for up to 2 years';
  const resolve = (label, extra, rows) => answers.resolveField({ id: 'f', kind: 'checkbox', label, ...extra }, {}, rows, { normalApply: true });
  assert.equal(resolve(sunscrapers, workable, saved('Yes')).value, 'YES');
  assert.equal(resolve(laminar, { required: false }, saved('Yes')).value, true, 'optional, still ticked');
  // A candidate's own No wins over the Manager's Yes.
  assert.equal(resolve(laminar, {}, [...saved('Yes'), ...saved('No', 'candidate')]).value, undefined);
  // Nothing saved: left unticked, as before.
  assert.equal(resolve(laminar, {}, []).value, undefined);
  assert.equal(resolve(sunscrapers, workable, []).value, undefined);
  // Marketing stays out even with the saved Yes.
  assert.equal(resolve("I would like to get updates on hot vacancies, company's news, events, and more", {}, saved('Yes')).value, undefined);
});
