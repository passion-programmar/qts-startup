const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRuntimeConfig(storedUrl) {
  const context = vm.createContext({
    URL,
    chrome: {
      storage: {
        local: {
          get: async () => ({ qtsServerUrl: storedUrl }),
        },
      },
    },
  });
  context.globalThis = context;
  const source = fs.readFileSync(
    path.join(__dirname, 'runtime-config.js'),
    'utf8',
  );
  vm.runInContext(source, context, { filename: 'runtime-config.js' });
  return context.__qtsRuntimeConfig;
}

test('runtime config gives popup and worker callers one normalized server URL', async () => {
  const config = loadRuntimeConfig('http://localhost:3000/api/health/');
  assert.equal(await config.getServerUrl(), 'http://localhost:3000');
});

test('runtime config rejects unencrypted server URLs outside this machine', async () => {
  const defaultUrl = await loadRuntimeConfig().getServerUrl();
  assert.equal(await loadRuntimeConfig('http://qts.example.com').getServerUrl(), defaultUrl);
  assert.equal(await loadRuntimeConfig('http://127.0.0.1:3000').getServerUrl(), 'http://127.0.0.1:3000');
  assert.equal(await loadRuntimeConfig('https://qts.example.com/').getServerUrl(), 'https://qts.example.com');
});

test('Get JD and shared text highlights are enabled while unfinished automation stays disabled', () => {
  const config = loadRuntimeConfig();
  assert.equal(config.isFeatureEnabled('getJd'), true);
  assert.equal(config.isFeatureEnabled('geminiEvaluation'), false);
  assert.equal(config.isFeatureEnabled('scanner'), false);
  assert.equal(config.isFeatureEnabled('applicationAutomation'), false);
  assert.equal(config.isFeatureEnabled('textHighlights'), true);
  assert.equal(config.isFeatureEnabled('pageExclusions'), true);
});
