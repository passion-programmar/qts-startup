const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bridgeSource = fs.readFileSync(path.join(__dirname, 'qts-site-bridge.js'), 'utf8');

// Runs the bridge on a page at `href`, with `saved` as the stored QTS server address, and reports
// whether it asked the service worker and whether it started listening for the QTS app.
async function runBridge(href, saved) {
  const location = new URL(href);
  const asked = [];
  const listeners = [];
  const window = {
    location,
    addEventListener: (type) => listeners.push(type),
    postMessage: () => {},
  };
  window.top = window;
  const chrome = {
    storage: { local: { get: async () => (saved === undefined ? {} : { qtsServerUrl: saved }) } },
    runtime: { sendMessage: async (message) => { asked.push(message.type); return { qtsSite: true }; } },
  };
  vm.runInNewContext(bridgeSource, { window, chrome, URL });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { asked, listening: listeners.includes('message') };
}

test('a page that is not the QTS site never wakes the service worker', async () => {
  for (const href of ['https://www.linkedin.com/jobs/view/1', 'https://example.com/', 'http://127.0.0.1:5000/']) {
    assert.deepEqual(await runBridge(href), { asked: [], listening: false }, href);
  }
});

test('the QTS site still asks the service worker and then listens', async () => {
  assert.deepEqual(await runBridge('https://qts-job-system.vercel.app/bids'), { asked: ['QTS_IS_QTS_SITE'], listening: true });
  // A saved local server (development, end-to-end tests) is the QTS site instead of Production.
  assert.deepEqual(await runBridge('http://127.0.0.1:1027/pdf', 'http://127.0.0.1:1027'), { asked: ['QTS_IS_QTS_SITE'], listening: true });
  assert.deepEqual(await runBridge('https://qts-job-system.vercel.app/bids', 'http://127.0.0.1:1027'), { asked: [], listening: false });
});

test('an unusable saved address falls back to Production, as runtime-config does', async () => {
  // Plain HTTP is allowed only on this machine; anything else means Production.
  assert.deepEqual(await runBridge('https://qts-job-system.vercel.app/', 'http://qts.example.com'), { asked: ['QTS_IS_QTS_SITE'], listening: true });
  assert.deepEqual(await runBridge('https://qts-job-system.vercel.app/', 'not an address'), { asked: ['QTS_IS_QTS_SITE'], listening: true });
});

test("the bridge's Production address is runtime-config's", () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'shared', 'runtime-config.js'), 'utf8');
  const production = config.match(/const DEFAULT_SERVER_URL = '([^']+)'/)[1];
  assert.ok(bridgeSource.includes(`const DEFAULT_SERVER_URL = '${production}'`));
});
