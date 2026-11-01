const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'apply-runner.js'), 'utf8');
const start = source.indexOf('async function applyChatTab(');
const end = source.indexOf('async function waitForTabComplete(', start);
const serviceWorkerSource = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');

test('Apply starts one chat per job and replaces its tab after ten jobs', async () => {
  const session = {};
  const tabs = new Map();
  const created = [];
  const removed = [];
  const newChats = [];
  const configuredUrls = ['https://chatgpt.com/g/project-one', 'https://chatgpt.com/g/project-two'];
  const context = vm.createContext({
    chrome: {
      storage: { session: {
        get: async key => ({ [key]: session[key] }),
        set: async value => Object.assign(session, value),
      } },
      tabs: {
        create: async options => {
          const tab = { id: created.length + 1, ...options };
          tabs.set(tab.id, tab);
          created.push(tab);
          return tab;
        },
        remove: async id => { removed.push(id); tabs.delete(id); },
      },
    },
    getTab: async id => tabs.get(id) || null,
    getManagerChatGptUrl: async () => configuredUrls.shift(),
    applyWindowId: async () => 1,
    tabOwnership: { markTab: async () => {} },
    onTab: async () => {},
    ensureChatGptReady: async () => {},
    startNewChatGptChat: async (id, url) => { newChats.push({ id, url }); },
  });
  vm.runInContext(`const APPLY_CHAT_TAB_KEY='qtsApplyChatTab'; const APPLY_APPLICATIONS_PER_CHAT_TAB=10;\n${source.slice(start, end)}`, context);

  await context.applyChatTab('job-1');
  await context.applyChatTab('job-1');
  assert.equal(newChats.length, 0, 'later AI rounds for the same application keep its conversation');
  for (let count = 2; count <= 10; count += 1) await context.applyChatTab(`job-${count}`);
  assert.equal(created.length, 1);
  assert.equal(created[0].url, 'https://chatgpt.com/g/project-one');
  assert.equal(newChats.length, 9);
  assert.ok(newChats.every(chat => chat.url === 'https://chatgpt.com/g/project-one'));

  await context.applyChatTab('job-11');
  assert.deepEqual(removed, [1]);
  assert.equal(created.length, 2);
  assert.equal(created[1].url, 'https://chatgpt.com/g/project-two');
});

test('Generation opens the Manager URL and closes only its previous QTS tab', async () => {
  const removed = [];
  const context = vm.createContext({
    getManagerChatGptUrl: async () => 'https://chatgpt.com/g/manager-project',
    currentWorkWindowId: async () => 5,
    showGenerationChatGptTab: async () => 1,
    isChatGptHostUrl: value => value.includes('chatgpt.com'),
    tabOwnership: {
      markTab: async () => {},
      ownerOf: async id => id === 3 ? 'generation' : null,
    },
    chrome: {
      tabs: {
        create: async options => ({ id: 2, ...options }),
        query: async () => [
          { id: 1, windowId: 5, url: 'https://chatgpt.com/g/a-different-project' },
          { id: 2, windowId: 5, url: 'https://chatgpt.com/g/manager-project' },
          { id: 3, windowId: 5, url: 'https://chatgpt.com/g/old-qts-project' },
        ],
        remove: async id => { removed.push(id); },
      },
    },
  });
  const functionStart = serviceWorkerSource.indexOf('async function acquireGenerationChatGptTab()');
  const functionEnd = serviceWorkerSource.indexOf('// A step card in the corner of the ChatGPT tab', functionStart);
  vm.runInContext(serviceWorkerSource.slice(functionStart, functionEnd), context);

  const tab = await context.acquireGenerationChatGptTab();
  assert.equal(tab.url, 'https://chatgpt.com/g/manager-project');
  assert.equal(tab.qtsChatGptUrl, 'https://chatgpt.com/g/manager-project');
  assert.deepEqual(removed, [3]);
});
