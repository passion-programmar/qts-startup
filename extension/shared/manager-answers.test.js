const assert = require('node:assert/strict');
const test = require('node:test');
const { changedCorrections, controlledAnswer, resolveField } = require('./apply-answers.js');
const row = (scope, questionText, answer, variants = []) => ({ scope, questionText, answer, variants });

test('Check learns changes and newly answered fields, including checkbox deselection, never unchanged AI or empty clears', () => {
  const baseline = [
    { id: 'a', label: 'Source', value: 'LinkedIn', kind: 'text' },
    { id: 'b', label: 'Privacy policy', value: 'Ticked', kind: 'checkbox' },
    { id: 'c', label: 'Existing AI answer', value: 'Unchanged', kind: 'text' },
    { id: 'd', label: 'Cleared field', value: 'Previous', kind: 'text' },
  ];
  const current = [...baseline.map((entry) => ({ ...entry, value: entry.id === 'a' ? 'Indeed' : entry.id === 'b' ? 'Not ticked' : entry.id === 'd' ? '' : entry.value })),
    { id: 'e', label: 'City', value: 'Bucharest', kind: 'text' },
    { id: 'f', label: 'Password', value: 'never-save', kind: 'password' },
    { id: 'g', label: 'New optional checkbox', value: 'Not ticked', kind: 'checkbox' }];
  assert.deepEqual(changedCorrections(baseline, current).map(({ question, answer }) => [question, answer]), [['Source', 'Indeed'], ['Privacy policy', 'false'], ['City', 'Bucharest']]);
  assert.deepEqual(changedCorrections(current, current), []);
});

test('saved wording adapts between text and dropdown without confusing recruiter and job-post source', () => {
  const saved = row('manager', 'How did you hear about us?', 'LinkedIn Job Post', [
    { kind: 'text', options: [], answer: 'LinkedIn' },
    { kind: 'select', options: ['Indeed', 'LinkedIn Job Post'], answer: 'LinkedIn Job Post' },
  ]);
  assert.equal(controlledAnswer({ label: 'How did you hear about this job?', kind: 'text' }, [saved]).value, 'LinkedIn');
  assert.equal(controlledAnswer({ label: 'How did you hear about us?', kind: 'select', options: ['Indeed', 'LinkedIn Job Post'] }, [saved]).value, 'LinkedIn Job Post');
  const generic = row('manager', 'How did you hear about us?', 'LinkedIn');
  assert.equal(controlledAnswer({ label: 'How did you hear about us?', kind: 'select', options: ['LinkedIn Job Post', 'Indeed'] }, [generic]).value, 'LinkedIn Job Post');
  assert.ok(controlledAnswer({ label: 'How did you hear about us?', kind: 'select', options: ['LinkedIn Job Post', 'LinkedIn Recruiter'] }, [generic]).byHand);
  assert.equal(controlledAnswer({ label: 'LinkedIn profile URL', kind: 'url' }, [saved]), null);
});

test('Manager shared answers beat legacy global payloads; application and candidate answers stay more specific', () => {
  const question = 'How did you hear about us?';
  const shared = row('everyone', question, 'Indeed'), manager = row('manager', question, 'LinkedIn');
  assert.equal(controlledAnswer({ label: question, kind: 'text' }, [manager, shared]).value, 'LinkedIn');
  assert.equal(controlledAnswer({ label: question, kind: 'text' }, [shared, manager]).value, 'LinkedIn');
  assert.equal(controlledAnswer({ label: question, kind: 'text' }, [row('candidate', question, 'Candidate source'), row('application', question, 'Application source'), manager]).value, 'Application source');
  assert.equal(controlledAnswer({ label: question, kind: 'text' }, [manager]).value, 'LinkedIn', 'global removal restores Manager fallback');
  assert.equal(controlledAnswer({ label: question, kind: 'text' }, [row('application', question, 'Referral'), shared, manager]).value, 'Referral');
  assert.equal(resolveField({ label: 'City', kind: 'text' }, { city: 'Old City' }, [row('candidate', 'City', 'New City')], { autoApply: true }).value, 'New City');
  assert.equal(resolveField({ label: 'City', kind: 'text' }, { city: 'Other candidate' }, [], { autoApply: true }).value, 'Other candidate');
});

test('checkbox corrections preserve false; unknown dropdown variants stay for the Manager', () => {
  assert.equal(controlledAnswer({ label: 'Privacy policy', kind: 'checkbox' }, [row('manager', 'Privacy policy', 'false')]).value, false);
  assert.ok(controlledAnswer({ label: 'Custom question', kind: 'select', options: ['A', 'B'] }, [row('manager', 'Custom question', 'C')]).byHand);
});
