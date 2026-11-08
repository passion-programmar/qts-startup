import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { recognizeSemanticField, profileField, correctionScope, canShareQuestion, parseCorrection } from './manager-answer-values';
import { parseAnswerEdit } from './manager-answer-editor';
const browserContract = createRequire(import.meta.url)('../../../extension/shared/semantic-fields.js');

test('backend and extension share recognition, meaning context and profile mappings', () => {
  for (const label of ['What is your telephone number?', 'Please enter your contact email', 'Preferred name', 'Full legal name', 'Where did you learn about this opportunity?', 'Are you authorized to work in Germany?']) {
    assert.deepEqual(recognizeSemanticField(label), browserContract.recognize(label));
  }
  assert.equal(profileField('What is your telephone number?', true), 'phone');
  assert.equal(profileField('Please enter your contact email', true), 'candidateEmail');
  assert.equal(profileField('Prénom', true), 'firstName');
  assert.equal(canShareQuestion('Téléphone', true), false);
  assert.equal(profileField('Preferred first name', true), null);
  assert.equal(profileField('Preferred first name'), 'firstName', 'legacy/Auto mapping remains unchanged');
  for (const label of ['Legal name', 'Country of citizenship', 'Preferred interview channel']) assert.equal(correctionScope(label, true), 'candidate');
  // Identity stays with the candidate; a preference may be a Manager default (2026-11-06 decision).
  for (const label of ['Legal name', 'Country of citizenship']) assert.equal(canShareQuestion(label, true), false);
  assert.equal(canShareQuestion('Preferred interview channel', true), true);
  assert.equal(correctionScope('Expected annual salary EUR gross', true), 'application');
});

test('semantic validation is used only by explicit normal editor, preserving keys and records', () => {
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Earliest start date', answer: '31/02/2028', representation: { dateFormat: 'DD/MM/YYYY' } }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Full name', answer: 'Pop, Ana, Jr', representation: { nameOrder: 'family-given' } }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Earliest start date', answer: '01/28', representation: { dateFormat: 'MM/YY' } }), 'string');
  assert.equal(typeof parseCorrection({ question: 'Email', answer: 'referee@example.test', semanticHint: 'Contact email of the referee' }, { normalApply: true }), 'string');
  const invalid = parseCorrection({ question: 'Contact email', answer: 'not-email' }, { normalApply: true });
  assert.equal(typeof invalid, 'string');
  // Applying never changes the profile (decision 2026-11-07): a profile fact is not saved from the panel.
  const edit = parseAnswerEdit({ action: 'save', question: 'What is your telephone number?', answer: '+40 711222333' });
  assert.match(String(edit), /profile fact/i);
  assert.match(String(parseAnswerEdit({ action: 'save', question: 'Email', answer: 'a@b.test', level: 'candidate' })), /profile fact/i);
  const shared = parseAnswerEdit({ action: 'save', question: 'Preferred interview channel', answer: 'Video', confirmShared: true });
  assert.ok(typeof shared !== 'string' && shared.action === 'save' && shared.scope === 'manager', 'a preference may be shared as a Manager default');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Country of citizenship', answer: 'Poland', confirmShared: true }), 'string', 'identity is never shared');
});

test('the panel question list saves at the level the Manager chose; identity is never saved for all candidates', () => {
  const at = (level: string, question = 'Are you open to relocation?') => parseAnswerEdit({ action: 'save', question, answer: 'No', level });
  for (const level of ['application', 'candidate', 'manager']) {
    const edit = at(level);
    assert.ok(typeof edit !== 'string' && edit.action === 'save' && edit.scope === level, level);
  }
  assert.equal(typeof at('manager', 'Gender'), 'string');
  const own = at('candidate', 'Gender');
  assert.ok(typeof own !== 'string' && own.action === 'save' && own.scope === 'candidate');
});

test('the answer editor reads the candidate email from the profile (the users table has no email column)', async () => {
  const { answerAttemptQuery } = await import('./manager-answer-editor');
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const text = new PgDialect().sqlToQuery(answerAttemptQuery({ managerId: '00000000-0000-4000-8000-000000000001', browserId: '00000000-0000-4000-8000-000000000002', authVersion: 1 }, '00000000-0000-4000-8000-000000000003')).sql;
  assert.doesNotMatch(text, /\bu\.email\b/);
  assert.match(text, /p\.candidate_email/);
});

test('a chosen option is accepted whatever its spacing and capitals, stored in the site\'s own wording', () => {
  const options = ['Select...', 'Bachelors', 'Masters', 'PhD'];
  const edit = parseAnswerEdit({ action: 'save', question: 'What’s your highest level of education completed?', answer: ' masters ', kind: 'select', options, level: 'candidate' });
  assert.ok(typeof edit !== 'string' && edit.action === 'save' && edit.answer === 'Masters');
  const refused = parseAnswerEdit({ action: 'save', question: 'What’s your highest level of education completed?', answer: 'Doctorate', kind: 'select', options, level: 'candidate' });
  assert.equal(typeof refused, 'string');
  assert.match(String(refused), /Bachelors, Masters, PhD/);
  const group = parseAnswerEdit({ action: 'save', question: 'Which tools have you used?', answer: 'slack | ZOOM', kind: 'checkbox-group', options: ['Slack', 'Zoom', 'Notion'], level: 'manager' });
  assert.ok(typeof group !== 'string' && group.action === 'save' && group.answer === 'Slack | Zoom');
});
