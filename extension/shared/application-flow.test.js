const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('./application-flow');
require('./auto-application-pipeline');

test('discovery checkpoints record observed steps without field values', () => {
  const first = flow.buildDiscoveryCheckpoint({
    siteKey: 'generic:ats.example',
    platform: 'generic',
    host: 'ats.example',
    pageSignature: 'step-one',
    fields: [{
      stableFieldId: 'full-name',
      label: 'Full name',
      fieldType: 'text',
      currentValue: 'Test Applicant',
      status: 'matched',
    }],
  });
  const second = flow.buildDiscoveryCheckpoint({
    siteKey: 'generic:ats.example',
    platform: 'generic',
    host: 'ats.example',
    pageSignature: 'step-two',
    fields: [{
      stableFieldId: 'motivation',
      label: 'Why this role?',
      fieldType: 'textarea',
      currentValue: 'Fictional test answer',
      status: 'matched',
    }],
  }, first);

  assert.equal(second.steps.length, 2);
  assert.deepEqual(second.transitions.map(({ from, to, status }) => ({ from, to, status })), [{
    from: 'step-one',
    to: 'step-two',
    status: 'observed_unverified',
  }]);
  assert.equal(JSON.stringify(second).includes('Test Applicant'), false);
  assert.equal(JSON.stringify(second).includes('Fictional test answer'), false);
});

test('verified Scanner evidence survives later structural refreshes without saving values', () => {
  const verifiedScannerCapture = {
    captureCount: 2,
    captureVerified: true,
    managerReviewed: false,
    observations: [
      {
        selectorHints: { tag: 'input', name: 'email' },
        domEvidence: { control: { tag: 'input', classNames: ['email-input'] }, ancestors: [] },
      },
      {
        selectorHints: { tag: 'input', name: 'email' },
        domEvidence: { control: { tag: 'input', classNames: ['email-input'] }, ancestors: [] },
      },
    ],
  };
  const initial = flow.buildDiscoveryCheckpoint({
    siteKey: 'generic:ats.example',
    platform: 'generic',
    host: 'ats.example',
    pageSignature: 'contact-step',
    fields: [{
      stableFieldId: 'name:email:email',
      label: 'Email',
      fieldType: 'email',
      sectionHeading: 'Contact',
      domEvidence: { control: { tag: 'input', classNames: ['email-input'] }, ancestors: [] },
      scannerCapture: verifiedScannerCapture,
    }],
  });
  const refreshed = flow.buildDiscoveryCheckpoint({
    siteKey: 'generic:ats.example',
    platform: 'generic',
    host: 'ats.example',
    pageSignature: 'contact-step-with-new-field',
    fields: [{
      stableFieldId: 'name:email:email',
      label: 'Email',
      fieldType: 'email',
      currentValue: 'private@example.invalid',
      sectionHeading: 'Contact',
      domEvidence: { control: { tag: 'input', classNames: ['email-input-v2'] }, ancestors: [] },
    }, {
      stableFieldId: 'name:phone:tel',
      label: 'Phone',
      fieldType: 'tel',
      sectionHeading: 'Contact',
    }],
  }, initial);

  assert.equal(refreshed.steps.length, 1);
  assert.deepEqual(refreshed.steps[0].fields[0].scannerCapture, verifiedScannerCapture);
  assert.equal(JSON.stringify(refreshed).includes('private@example.invalid'), false);
});

test('discovery navigation remains review-gated and marks final submit without activating it', () => {
  const next = flow.classifyNavigationAction('Continue', {
    mode: 'DISCOVERY',
    allowTestNavigation: true,
    controlType: 'submit',
  });
  assert.equal(next.classification, 'POSSIBLE_NEXT_REQUIRES_REVIEW');
  assert.equal(next.safe, false);

  const submit = flow.classifyNavigationAction('Submit', { mode: 'DISCOVERY' });
  assert.equal(submit.classification, 'FINAL_SUBMIT');
  assert.equal(submit.safe, false);
});

test('automatic advancement accepts exactly one recognized non-submit next control', () => {
  const result = flow.selectAutomaticNextAction([
    { label: 'Continue', tag: 'button', disabled: false },
    { label: 'Submit application', tag: 'button', disabled: false },
  ]);
  assert.equal(result.action.label, 'Continue');
  assert.equal(result.reason, null);
});

test('automatic advancement rejects ambiguous, disabled, and unknown controls', () => {
  assert.equal(flow.selectAutomaticNextAction([
    { label: 'Next', disabled: false },
    { label: 'Continue', disabled: false },
  ]).action, null);
  assert.equal(flow.selectAutomaticNextAction([
    { label: 'Next', disabled: true },
  ]).action, null);
  assert.equal(flow.selectAutomaticNextAction([
    { label: 'Review and submit', disabled: false },
  ]).action, null);
  assert.equal(flow.selectAutomaticNextAction([
    { label: 'Submit application', disabled: false },
  ]).action, null);
});

test('automatic final submission accepts only one exact recognized submit control', () => {
  assert.equal(flow.selectAutomaticFinalSubmitAction([
    { label: 'Submit application', disabled: false },
    { label: 'Save and continue', disabled: false },
  ]).action.label, 'Submit application');
  assert.equal(flow.selectAutomaticFinalSubmitAction([
    { label: 'Apply now', disabled: false },
  ]).action, null);
  assert.equal(flow.selectAutomaticFinalSubmitAction([
    { label: 'Submit', disabled: false },
    { label: 'Submit application', disabled: false },
  ]).action, null);
  assert.equal(flow.selectAutomaticFinalSubmitAction([
    { label: 'Submit application', disabled: true },
  ]).action, null);
});

test('discovery graph stays bounded as additional steps are observed', () => {
  let checkpoint = {};
  for (let step = 0; step < 40; step += 1) {
    checkpoint = flow.buildDiscoveryCheckpoint({
      siteKey: 'generic:ats.example',
      host: 'ats.example',
      platform: 'generic',
      pageSignature: `step-${step}`,
      fields: Array.from({ length: 10 }, (_, field) => ({
        stableFieldId: `field-${step}-${field}`,
        fieldType: 'text',
        status: 'matched',
      })),
    }, checkpoint);
  }

  assert.equal(checkpoint.steps.length, 40);
  assert.ok(checkpoint.steps.reduce((total, step) => total + step.fields.length, 0) <= 300);
});

test('legacy generic autofill allows Workable through the normal discovery flow before field validation', async () => {
  const pipeline = globalThis.__qtsAutoApplicationPipeline;
  let tabLookups = 0;
  const discoveredFields = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true }),
    },
  };
  globalThis.__qtsApplicationFlow = {
    normalizeApplicationMode: () => 'DISCOVERY',
  };
  globalThis.__qtsApiWorker = {
    workerCheckDefaultCandidateApplied: async () => ({ applied: false }),
    workerApiRequest: async () => ({ success: true, candidate: { id: 7 } }),
  };
  pipeline.registerDeps({
    getTab: async () => {
      tabLookups += 1;
      return { id: 1, url: 'https://apply.workable.com/example/j/123' };
    },
    setJobSourceTab: async () => {},
    detectApplyTemplateOnTab: async () => {},
    discoverApplicationFormOnTab: async () => ({
      success: true,
      discovery: { fields: discoveredFields },
      scan: { fields: discoveredFields },
    }),
    preloadCustomGptTab: async () => {},
    showPageDetectAlert: async () => {},
  });

  await assert.rejects(
    pipeline.runAutoApplicationPipeline(1, {
      candidateId: 7,
      jobUrl: 'https://apply.workable.com/example/j/123',
    }),
    /No application fields detected on this page\./
  );
  assert.equal(tabLookups, 1);
});
