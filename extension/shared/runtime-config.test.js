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

test('Get JD and shared text highlights are enabled while unfinished automation stays disabled', () => {
  const config = loadRuntimeConfig();
  assert.equal(config.isFeatureEnabled('getJd'), true);
  assert.equal(config.isFeatureEnabled('geminiEvaluation'), false);
  assert.equal(config.isFeatureEnabled('scanner'), false);
  assert.equal(config.isFeatureEnabled('applicationAutomation'), false);
  assert.equal(config.isFeatureEnabled('textHighlights'), true);
  assert.equal(config.isFeatureEnabled('pageExclusions'), true);
});
