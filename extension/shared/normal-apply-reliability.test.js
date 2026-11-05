const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const helpers = require('./apply-answers.js');
const source = fs.readFileSync(require.resolve('../background/apply-runner.js'), 'utf8');

test('actual Normal Apply fill body excludes AI, cached answers and legacy memory while preserving saved values', async () => {
  const fields = [
    { id: 'name', label: 'First name', kind: 'text', required: true },
    { id: 'missing', label: 'Describe your greatest achievement', kind: 'textarea', required: true },
    { id: 'letter', label: 'Cover letter', kind: 'textarea', maxLength: 4, required: true },
    { id: 'rejected', label: 'Email', kind: 'text', required: true },
    { id: 'saved', label: 'Interview channel', kind: 'select', options: ['Video', 'Phone'], required: true },
    { id: 'policy', label: 'I agree to the privacy policy', kind: 'checkbox', policyContext: 'inline-v1', required: true },
  ];
  const fills = []; let memoryReads = 0, aiCalls = 0;
  const context = { self: { __qtsApplyAnswers: { ...helpers, findRememberedChoice: () => { memoryReads++; return 'Unapproved'; } } },
    NORMAL_APPLY_SOURCES: new Set(['documents', 'profile', 'reusable']), APPLY_FILL_ROUNDS: 0,
    HAS_WORDS: /[a-z]/i, CHOICE_KINDS: new Set(), applyDebug: false, sleep: async () => {}, diag() {},
    readComboboxOptions: async () => [], usedKey: (_used, field) => field.label, fieldFacts: () => ({}),
    answerText: (value) => String(value ?? ''),
    fillAndCheck: async (_tab, field, answer) => { fills.push([field.id, answer.value]); return { ok: field.id !== 'rejected', error: 'Rejected' }; },
    askAiForAnswers: async () => { aiCalls++; throw Error('AI must not run'); },
    askAiToFix: async () => { aiCalls++; throw Error('AI repair must not run'); },
    __qtsApplyForm: { scanForAssist: () => fields, emptyRequired: () => [] },
  };
  vm.createContext(context);
  context.inForm = async (_tab, fn, args = []) => vm.runInContext(`(${fn.toString()})(...${JSON.stringify(args)})`, context);
  vm.runInContext(source.slice(source.indexOf('async function fillFormPageBody('), source.indexOf('async function browserName(')), context);
  const application = { candidate: { firstName: 'Ana', email: 'ana@example.test' }, savedAnswers: [
    { scope: 'manager', questionKey: 'interview channel', questionText: 'Interview channel', answer: 'Video' },
    { scope: 'application', questionText: 'I agree to the privacy policy', questionKey: 'i agree to the privacy policy', answer: 'false', variants: [{ kind: 'checkbox', options: [], answer: 'false', policyContext: 'inline-v1' }] },
  ], job: { coverLetterText: 'Original generated document text' },
    answerCache: new Map([['Describe your greatest achievement', { source: 'ai', value: 'Invented' }]]) };
  const result = await context.fillFormPageBody(1, application, () => {}, 1, { assist: true }, []);
  assert.equal(aiCalls, 0); assert.equal(memoryReads, 0);
  assert.ok(fills.some(([id, value]) => id === 'name' && value === 'Ana'));
  assert.ok(fills.some(([id, value]) => id === 'saved' && value === 'Video'));
  assert.ok(fills.some(([id, value]) => id === 'policy' && value === false));
  assert.ok(!fills.some(([id]) => ['missing', 'letter'].includes(id)));
  assert.ok(result.problems.some((entry) => entry.fieldId === 'rejected'));
});

test('AI entry points independently reject Normal Apply and retain Auto Apply execution', async () => {
  let calls = 0;
  const context = { spendAiRequest: () => { calls++; }, diag() {}, withAutoApplyAiQueue: (_app, fn) => fn(),
    askGeminiForAnswers: async () => 'auto-answer', askGeminiToFix: async () => 'auto-repair' };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function askAiForAnswers('), source.indexOf('// Both providers work')), context);
  for (const name of ['askAiForAnswers', 'askAiToFix']) await assert.rejects(context[name]({ normalApplyAnswers: true }, [], []), /disabled/);
  assert.equal(calls, 0);
  assert.equal(await context.askAiForAnswers({ aiMode: 'gemini' }, []), 'auto-answer');
  assert.equal(await context.askAiToFix({ aiMode: 'gemini' }, [], []), 'auto-repair');
  assert.equal(calls, 2);
});
