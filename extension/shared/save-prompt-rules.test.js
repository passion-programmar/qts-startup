// What the Manager may save after changing a box while applying (decisions 2026-11-07).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const semantics = require('./semantic-fields.js');

const source = fs.readFileSync(path.join(__dirname, '../background/apply-runner.js'), 'utf8');
const start = source.indexOf('const NOT_SAVED_QUESTION');
const end = source.indexOf('async function refreshAssistQuestions');
const context = { self: { __qtsSemanticFields: semantics } };
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.savePromptFor = savePromptFor;`, context);
const prompt = (label, source = null, kind = 'text', company = 'Kraken') => context.savePromptFor({ label, kind }, source, company);

test('profile facts are never saved while applying: a note says where to change them', () => {
  for (const label of ['Email', 'First name', 'Phone', 'City', 'LinkedIn profile']) {
    assert.match(prompt(label).note, /Profile page/, label);
    assert.equal(prompt(label).levels, undefined);
  }
  assert.match(prompt('Current location', 'profile').note, /Profile page/);
});

test('generated content, agreements, marketing, files and passwords are never offered', () => {
  assert.equal(prompt('Cover Letter', 'documents', 'textarea'), null);
  assert.equal(prompt('I agree to the terms and conditions', 'consent', 'checkbox'), null);
  assert.equal(prompt('Subscribe to our newsletter', null, 'checkbox'), null);
  assert.equal(prompt('Resume', 'documents', 'file'), null);
  assert.equal(prompt('Password', null, 'password'), null);
  assert.equal(prompt('Something an AI wrote', 'ai'), null);
});

test('a question about this company or role is saved only for this job; others at every level', () => {
  assert.deepEqual([...prompt('Why do you want to join Kraken?').levels], ['application']);
  assert.deepEqual([...prompt('What attracts you to this role?').levels], ['application']);
  assert.deepEqual([...prompt('Have you used a Kraken product in the last six months?').levels], ['application']);
  assert.deepEqual([...prompt('What is your highest level of education?', null, 'select').levels], ['manager', 'candidate', 'application']);
  assert.deepEqual([...prompt('Which remote collaboration tools have you used?', null, 'checkbox-group').levels], ['manager', 'candidate', 'application']);
});
