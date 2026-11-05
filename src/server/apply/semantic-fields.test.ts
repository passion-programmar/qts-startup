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
  for (const label of ['Legal name', 'Country of citizenship', 'Preferred interview channel']) {
    assert.equal(correctionScope(label, true), 'candidate'); assert.equal(canShareQuestion(label, true), false);
  }
  assert.equal(correctionScope('Expected annual salary EUR gross', true), 'application');
});

test('semantic validation is used only by explicit normal editor, preserving keys and records', () => {
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Earliest start date', answer: '31/02/2028', representation: { dateFormat: 'DD/MM/YYYY' } }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Full name', answer: 'Pop, Ana, Jr', representation: { nameOrder: 'family-given' } }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Earliest start date', answer: '01/28', representation: { dateFormat: 'MM/YY' } }), 'string');
  assert.equal(typeof parseCorrection({ question: 'Email', answer: 'referee@example.test', semanticHint: 'Contact email of the referee' }, { normalApply: true }), 'string');
  const invalid = parseCorrection({ question: 'Contact email', answer: 'not-email' }, { normalApply: true });
  assert.equal(typeof invalid, 'string');
  const edit = parseAnswerEdit({ action: 'save', question: 'What is your telephone number?', answer: '+40 711222333' });
  assert.notEqual(typeof edit, 'string');
  if (typeof edit === 'string' || edit.action !== 'save') assert.fail('Expected save');
  assert.equal(edit.profileField, 'phone'); assert.equal(edit.scope, 'candidate');
  assert.equal(edit.questionKey, 'what is your telephone number', 'no canonical identity is stored');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Preferred interview channel', answer: 'Video', confirmShared: true }), 'string');
});
