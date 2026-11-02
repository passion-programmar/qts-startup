const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Auto Apply always uses ChatGPT regardless of Manager assignment or stale Chrome preferences', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'auto-apply-runner.js'), 'utf8');
  const start = source.indexOf('async function prepareAutoApplication('), end = source.indexOf('\n/**', start);
  for (const [assigned, local, debug, customUrlGemini, expected, enabled] of [
    [undefined, undefined, false, false, 'chatgpt', true],
    ['chatgpt', 'gemini', false, false, 'chatgpt', true],
    ['gemini', 'chatgpt', false, false, 'chatgpt', true],
    ['chatgpt', 'off', false, false, 'chatgpt', true],
    ['gemini', 'off', true, false, 'chatgpt', false],
    ['chatgpt', 'gemini', false, true, 'gemini', true],
  ]) {
    const stored = { ai: local, qtsApplyDebug: debug };
    const context = vm.createContext({ self: { __qtsApplyAnswers: { factSources: () => ({}) } },
      chrome: { storage: { local: { get: async () => stored } } },
      AUTO_APPLY_AI_KEY: 'ai', AUTO_APPLY_AI_LIMITS_KEY: 'limits', AUTO_APPLY_CHAT_FOCUS_KEY: 'focus', AUTO_APPLY_AI_BUDGET: 10, AUTO_APPLY_AI_RETRY_WAITS: [],
    });
    vm.runInContext(source.slice(start, end), context);
    const application = { aiMode: assigned, autoApplyCustomUrlGemini: customUrlGemini, candidate: {}, job: {} };
    await context.prepareAutoApplication(application);
    assert.equal(application.aiMode, expected); assert.equal(application.autoAi, enabled);
  }
});

test('two Auto Apply ChatGPT requests are isolated; a rejected round does not block the next job', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'apply-runner.js'), 'utf8');
  const start = source.indexOf('let autoApplyChatQueue'), end = source.indexOf('async function askChatGptForAutoApplyRound', start);
  const calls = [], releases = [];
  const context = vm.createContext({ isApplyOn: async () => true, activeReviews: { has: () => true },
    askChatGptForAutoApplyRound: async application => { calls.push(application.id); await new Promise(resolve => releases.push(resolve)); if (application.fail) throw Error('Synthetic ChatGPT failure'); return application.id; },
  });
  vm.runInContext(source.slice(start, end), context);
  const first = context.askChatGptForAutoApply({ id: 1, fail: true }), second = context.askChatGptForAutoApply({ id: 2 });
  const rejected = assert.rejects(first, /Synthetic ChatGPT failure/);
  await new Promise(setImmediate); assert.deepEqual(calls, [1]);
  releases.shift()(); await rejected; await new Promise(setImmediate);
  assert.deepEqual(calls, [1, 2]); releases.shift()(); assert.equal(await second, 2);
});
