const assert = require('node:assert/strict');
const test = require('node:test');
const identity = require('./answer-identity.js');
const answers = require('./apply-answers.js');
const vm = require('node:vm');

test('the Profile browser bundle and classic worker share the same identity contract', () => {
  const bundle = require('esbuild').buildSync({ stdin: { contents: 'globalThis.fixtureIdentity = require("./extension/shared/answer-identity.js")', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser' });
  const context = {}; vm.runInNewContext(bundle.outputFiles[0].text, context);
  assert.equal(context.fixtureIdentity.identity('Telephone').key, identity.identity('Telephone').key);
  assert.equal(context.fixtureIdentity.same('Country', 'Nationality'), false);
});

test('canonical identities preserve meaning, country/time/basis and unknown/policy boundaries', () => {
  assert.equal(identity.same('Telephone', 'Your phone number'), true);
  for (const [a, b] of [['Country', 'Nationality'], ['Legal name', 'Full name'], ['Do you require sponsorship now?', 'Will you require sponsorship?'], ['Expected annual salary EUR', 'Expected annual salary USD'], ['Are you authorized to work in Germany?', 'Are you authorized to work in France?']]) assert.equal(identity.same(a, b), false);
  for (const question of ['Privacy policy', 'I agree to the terms', 'Referee phone', 'Unknown wording']) assert.equal(identity.identity(question), null);
});

test('duplicate grouping never merges records or crosses Manager/candidate/job/scope boundaries', () => {
  const rows = [{ id: 'a', managerId: 'm1', contextKey: 'candidate:c1', questionText: 'Phone' }, { id: 'b', managerId: 'm1', contextKey: 'candidate:c1', questionText: 'Telephone' }, { id: 'c', managerId: 'm2', contextKey: 'candidate:c1', questionText: 'Phone' }, { id: 'd', managerId: 'm1', contextKey: 'candidate:c2', questionText: 'Telephone' }];
  const before = JSON.stringify(rows);
  assert.deepEqual(identity.duplicateGroups(rows).map((group) => group.map((row) => row.id)), [['a', 'b']]);
  assert.equal(JSON.stringify(rows), before);
});

test('explicit matching variation preserves canonical answer and rejects conflicting approved representations', () => {
  const row = { id: 'saved', scope: 'candidate', questionText: 'Preferred interview format', answer: 'Video', variants: [{ questionText: 'Preferred interview channel', kind: 'select', options: ['Online', 'In person'], answer: 'Online' }] };
  const field = { id: 'f', label: 'Preferred interview channel', kind: 'select', options: ['Online', 'In person'] };
  const before = JSON.stringify(row);
  assert.equal(answers.resolveField(field, {}, [row], { normalApply: true }).value, 'Online');
  assert.equal(JSON.stringify(row), before);
  row.variants.push({ ...row.variants[0], answer: 'In person' });
  assert.match(answers.resolveField(field, {}, [row], { normalApply: true }).byHand, /variations/);
  assert.equal(identity.selectVariant(row, { ...field, label: 'Preferred interview method' }).variant, null);
});

test('rollback leaves strict flag disabled and never changes Auto Apply resolution', () => {
  const field = { id: 'f', label: 'Preferred interview channel', kind: 'text' };
  const rows = [{ scope: 'candidate', questionText: 'Preferred interview format', answer: 'Video' }];
  const auto = answers.resolveField(field, {}, rows, {});
  global.__qtsAnswerRollout = { answerSemanticV1: false, answerRepresentationsV1: false, answerIdentityV1: false };
  try {
    assert.deepEqual(answers.resolveField(field, {}, rows, {}), auto);
    assert.equal(answers.resolveField(field, {}, rows, { normalApply: true })?.value, undefined);
  } finally { delete global.__qtsAnswerRollout; }
});

test('Normal-only persisted variations cannot supply a new answer to the Auto resolver', () => {
  const field = { id: 'f', label: 'Preferred interview format', kind: 'select', options: ['Online', 'In person'] };
  const original = { scope: 'candidate', questionText: 'Preferred interview format', answer: 'Video', variants: [] };
  const changed = { ...original, variants: [{ kind: 'normal-variation', options: [], answer: 'Video', normalVariation: { questionText: field.label, kind: field.kind, options: field.options, answer: 'Online' } }] };
  assert.deepEqual(answers.resolveField(field, {}, [changed], {}), answers.resolveField(field, {}, [original], {}));
  assert.equal(answers.resolveField(field, {}, [changed], { normalApply: true }).value, 'Online');
});
