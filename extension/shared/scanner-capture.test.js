const assert = require('node:assert/strict');
const test = require('node:test');
const scannerCapture = require('./scanner-capture');

function field(overrides = {}) {
  return {
    stableFieldId: 'name:email:text',
    label: 'Email address',
    fieldType: 'email',
    required: true,
    options: [],
    sectionHeading: 'Contact',
    selectorHints: { tag: 'input', name: 'email', type: 'email' },
    domEvidence: {
      control: { tag: 'input', role: '', classNames: ['form-control'], testId: '', automationId: '' },
      ancestors: [{ tag: 'div', role: '', classNames: ['field-row'], testId: 'email-field', automationId: '' }],
    },
    ...overrides,
  };
}

function savedRule(overrides = {}) {
  const savedField = field();
  const evidence = scannerCapture.captureEvidence(savedField);
  return {
    field_id: savedField.stableFieldId,
    question: savedField.label,
    field_snapshot: {
      fieldType: savedField.fieldType,
      required: savedField.required,
      options: savedField.options,
      section: savedField.sectionHeading,
      selectorHints: evidence.selectorHints,
      domEvidence: evidence.domEvidence,
      captureCount: 2,
      captureVerified: true,
      observations: [evidence, evidence],
    },
    ...overrides,
  };
}

test('new, changed, or unverified fields request a second capture', () => {
  const current = field();
  assert.equal(scannerCapture.requiresSecondCapture([current], []), true);
  assert.equal(scannerCapture.requiresSecondCapture([current], [savedRule({
    field_snapshot: { ...savedRule().field_snapshot, captureVerified: false },
  })]), true);
  assert.equal(scannerCapture.requiresSecondCapture([
    field({ label: 'Work email address' }),
  ], [savedRule()]), true);
  assert.equal(scannerCapture.requiresSecondCapture([current], [savedRule()]), false);
});

test('verified structural evidence prevents unnecessary repeated capture for ruleless fields', () => {
  const current = field({ fieldType: 'file', label: 'Resume' });
  const previous = scannerCapture.reconcileCaptures([current], [current]).fields[0].scannerCapture;
  assert.equal(scannerCapture.requiresSecondCapture([
    { ...current, previousScannerCapture: previous },
  ], []), false);
  assert.equal(scannerCapture.requiresSecondCapture([
    { ...current, label: 'Cover letter', previousScannerCapture: previous },
  ], []), true);
});

test('matching captures are verified and retain bounded locator evidence', () => {
  const first = field();
  const second = field({
    domEvidence: {
      control: { ...first.domEvidence.control, classNames: ['form-control', 'css-8f13aaab'] },
      ancestors: first.domEvidence.ancestors,
    },
  });
  const result = scannerCapture.reconcileCaptures([first], [second]);
  assert.equal(result.discrepancies.length, 0);
  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0].scannerCapture.captureCount, 2);
  assert.equal(result.fields[0].scannerCapture.captureVerified, true);
  assert.equal(result.fields[0].scannerCapture.classEvidenceChanged, false);
});

test('field snapshots include the locator evidence required by the API schema', () => {
  const snapshot = scannerCapture.captureFieldSnapshot(field());
  assert.deepEqual(snapshot.selectorHints, scannerCapture.captureEvidence(field()).selectorHints);
  assert.deepEqual(snapshot.domEvidence, scannerCapture.captureEvidence(field()).domEvidence);
  assert.equal(snapshot.domEvidence.control.tag, 'input');
  assert.equal(snapshot.domEvidence.ancestors.length, 1);
});

test('one-pass-only fields and meaningful DOM differences remain unresolved', () => {
  const first = field();
  const second = field({
    label: 'Personal email address',
    domEvidence: {
      control: first.domEvidence.control,
      ancestors: [{ tag: 'section', role: '', classNames: ['field-row'], testId: 'email-field', automationId: '' }],
    },
  });
  const changed = scannerCapture.reconcileCaptures([first], [second]);
  assert.equal(changed.fields.length, 0);
  assert.equal(changed.discrepancies[0].kind, 'changed_between_captures');
  assert.ok(changed.discrepancies[0].changes.includes('label'));
  assert.ok(changed.discrepancies[0].changes.includes('DOM structure'));

  const missing = scannerCapture.reconcileCaptures([first], []);
  assert.equal(missing.discrepancies[0].kind, 'missing_on_second');
  const newOnSecond = scannerCapture.reconcileCaptures([], [first]);
  assert.equal(newOnSecond.discrepancies[0].kind, 'new_on_second');
});

test('class churn is weak evidence and cannot independently identify a field', () => {
  const first = field({
    selectorHints: { tag: 'input' },
  });
  const second = field({
    selectorHints: { tag: 'input' },
    domEvidence: {
      control: { ...first.domEvidence.control, classNames: ['form-control-next'] },
      ancestors: first.domEvidence.ancestors,
    },
  });
  const result = scannerCapture.reconcileCaptures([first], [second]);
  assert.equal(result.fields.length, 0);
  assert.equal(result.discrepancies[0].kind, 'changed_between_captures');
  assert.ok(result.discrepancies[0].changes.includes('class-based locator evidence'));

  const volatileClass = scannerCapture.reconcileCaptures(
    [field({ domEvidence: { ...first.domEvidence, control: { ...first.domEvidence.control, classNames: ['css-a81de094'] } } })],
    [field({ domEvidence: { ...first.domEvidence, control: { ...first.domEvidence.control, classNames: ['css-b07f3011'] } } })]
  );
  assert.equal(volatileClass.fields.length, 1);
  assert.equal(volatileClass.discrepancies.length, 0);
});

test('stable semantic locators tolerate class changes, and step keys survive new fields', () => {
  const first = field();
  const classChanged = field({
    domEvidence: {
      control: { ...first.domEvidence.control, classNames: ['new-styles'] },
      ancestors: first.domEvidence.ancestors,
    },
  });
  const result = scannerCapture.reconcileCaptures([first], [classChanged]);
  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0].scannerCapture.classEvidenceChanged, true);

  const firstStep = scannerCapture.deriveStepKey([
    field({ pageStep: 'Step 1 of 2', sectionHeading: 'Contact' }),
  ]);
  const expandedStep = scannerCapture.deriveStepKey([
    field({ pageStep: 'Step 1 of 2', sectionHeading: 'Contact' }),
    field({ stableFieldId: 'name:phone:tel', label: 'Phone', fieldType: 'tel', pageStep: 'Step 1 of 2', sectionHeading: 'Contact' }),
  ]);
  const nextStep = scannerCapture.deriveStepKey([
    field({ pageStep: 'Step 2 of 2', sectionHeading: 'Experience' }),
  ]);
  assert.equal(firstStep, expandedStep);
  assert.notEqual(firstStep, nextStep);
  assert.notEqual(
    scannerCapture.getRuleFieldId({ stableFieldId: 'name:email:email', scannerStepKey: firstStep }),
    scannerCapture.getRuleFieldId({ stableFieldId: 'name:email:email', scannerStepKey: nextStep })
  );
  assert.equal(scannerCapture.requiresSecondCapture([
    field({ pageStep: 'Step 2 of 2' }),
  ], [savedRule({ context: { pageStep: 'Step 1 of 2' } })]), true);
});

test('Manager review records a second observation without claiming it was stable', () => {
  const reviewed = scannerCapture.acceptReviewedObservation(field());
  assert.equal(reviewed.scannerCapture.captureCount, 2);
  assert.equal(reviewed.scannerCapture.captureVerified, false);
  assert.equal(reviewed.scannerCapture.managerReviewed, true);
});

test('uncertain field identity is trusted only after explicit Manager confirmation', () => {
  const rule = savedRule();
  assert.equal(scannerCapture.hasManagerConfirmedFieldIdentity(field(), rule), false);
  assert.equal(scannerCapture.hasManagerConfirmedFieldIdentity({
    ...field(),
    scannerCapture: { captureCount: 2, captureVerified: true },
  }, rule), false);
  assert.equal(scannerCapture.hasManagerConfirmedFieldIdentity({
    ...field(),
    scannerCapture: { fieldIdentityConfirmed: true },
  }, rule), true);
  assert.equal(scannerCapture.hasManagerConfirmedFieldIdentity(field(), savedRule({
    field_snapshot: { ...savedRule().field_snapshot, fieldIdentityConfirmed: true },
  })), true);
  assert.equal(scannerCapture.hasManagerConfirmedFieldIdentity({
    ...field(),
    scannerCapture: { fieldIdentityConfirmed: true },
  }, null), false);
});

test('captures native validation metadata and detects changed constraints', () => {
  const numeric = field({
    fieldType: 'number',
    inputMode: 'numeric',
    constraints: { min: '1000', max: '10000', step: '500', pattern: '', minLength: -1, maxLength: -1 },
  });
  assert.deepEqual(scannerCapture.captureValidation(numeric), {
    inputType: 'number',
    inputMode: 'numeric',
    numericOnly: false,
    min: '1000',
    max: '10000',
    step: '500',
  });
  assert.ok(scannerCapture.meaningfulFieldChanges(
    numeric,
    field({
      ...numeric,
      constraints: { ...numeric.constraints, min: '2000' },
    })
  ).changes.includes('input validation'));
});

test('reusable answers must fit detected number, pattern, and length validation', () => {
  const numeric = field({
    fieldType: 'number',
    constraints: { min: '1000', max: '10000', step: '500' },
  });
  assert.deepEqual(scannerCapture.validateAnswerForField(numeric, '5000'), { status: 'valid' });
  assert.equal(scannerCapture.validateAnswerForField(numeric, '5000 EUR per month').status, 'invalid');
  assert.equal(scannerCapture.validateAnswerForField(numeric, '5200').status, 'invalid');
  assert.equal(scannerCapture.validateAnswerForField(numeric, '12000').status, 'invalid');

  assert.equal(scannerCapture.validateAnswerForField(field({
    fieldType: 'text',
    constraints: { pattern: '[0-9]+' },
  }), '5000 EUR per month').status, 'invalid');
  assert.equal(scannerCapture.validateAnswerForField(field({
    fieldType: 'text',
    validationMessage: 'Please enter numbers only.',
  }), '5000 EUR per month').status, 'invalid');
  assert.equal(scannerCapture.validateAnswerForField(field({
    fieldType: 'text',
    constraints: { maxLength: 5 },
  }), '5000 EUR').status, 'invalid');
});

test('unsupported date formats are marked uncertain for GPT review', () => {
  assert.equal(scannerCapture.validateAnswerForField(
    field({ fieldType: 'date' }),
    'October 15, 2026'
  ).status, 'unknown');
});
