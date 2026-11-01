const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
const start = source.indexOf('  async function askGenerationChatGpt(');
const end = source.indexOf('  // pinnedChatTab', start);

test('closing the Generation ChatGPT tab retries in a fresh tab with the complete prompt', async () => {
  const sent = [];
  const context = vm.createContext({
    chrome: { scripting: { executeScript: async () => [{ result: 0 }] }, tabs: { remove: async () => {} } },
    getTab: async id => id === 1 ? null : { id },
    updateGenerationBrowserState: async () => {}, showGenerationChatGptStep: async () => {}, sleep: async () => {}, ensureChatGptReady: async () => {},
    acquireGenerationChatGptTab: async () => ({ id: 2 }),
    sendGenerationPromptWithRecovery: async (id, prompt) => { sent.push({ id, prompt }); if (id === 1) throw Error('No tab with id: 1'); },
    waitForGenerationAnswer: async () => 'synthetic response',
  });
  vm.runInContext(source.slice(start, end), context);
  const tab = { id: 1 };
  assert.equal(await context.askGenerationChatGpt(tab, 'Correct the JSON', 'test-id', { local() {} }, 'Full original Manager prompt and JSON contract'), 'synthetic response');
  assert.deepEqual(sent, [{ id: 1, prompt: 'Correct the JSON' }, { id: 2, prompt: 'Full original Manager prompt and JSON contract' }]);
  assert.equal(tab.id, 2);
});

test('Generation recovery never closes a recycled tab ID from another Chrome session', async () => {
  const touched = [];
  const context = vm.createContext({
    self: { __qtsAutoApply: { browserSession: async () => 'current-session' } }, URL,
    chrome: { tabs: { get: async id => { touched.push(['get', id]); return { id, pinned: true, url: 'https://chatgpt.com/' }; }, remove: async id => { touched.push(['remove', id]); } } },
    isChatGptHostUrl: () => true,
  });
  const begin = source.indexOf('  async function closeInterruptedGenerationTabs(');
  vm.runInContext(source.slice(begin, source.indexOf('  async function recoverInterruptedGeneration(', begin)), context);
  await context.closeInterruptedGenerationTabs({ browserSession: 'old-session', chatTabId: 1 });
  assert.deepEqual(touched, []);
  await context.closeInterruptedGenerationTabs({ browserSession: 'current-session', chatTabId: 1 });
  assert.deepEqual(touched, [['get', 1], ['remove', 1]]);
});
