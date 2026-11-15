const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extensionRoot = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(extensionRoot, 'background', 'service-worker.js'), 'utf8');
const launcher = fs.readFileSync(path.join(extensionRoot, 'content', 'page-launcher.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

function slice(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return source.slice(start, end);
}

const shortcutSource = slice(worker, '// ---- Keyboard shortcuts', 'chrome.tabs.onActivated.addListener');
const switchSource = slice(worker, 'async function turnGetJdOn(', 'async function verifyFormScanScripts(');

// The shortcut section with its helpers stubbed; `launcherReply` is what the page answers.
function shortcutFixture({ launcherReply, getJdOn = false, keys = { 'toggle-get-jd': 'Alt+G', 'toggle-text-highlights': 'Alt+H' } }) {
  const events = [];
  let onCommand = null;
  const context = {
    console,
    chrome: {
      commands: {
        getAll: async () => [{ name: '_execute_action', shortcut: 'Alt+Q' }, ...Object.entries(keys).map(([name, shortcut]) => ({ name, shortcut }))],
        onCommand: { addListener: (listener) => { onCommand = listener; } },
      },
      runtime: { getURL: (file) => `chrome-extension://qts/${file}` },
      notifications: { create: (id, options) => events.push(['notify', options.message]) },
    },
    sendToLauncher: async (tab, message) => {
      events.push(['launcher', tab.id, message.type, message.shortcut]);
      if (launcherReply instanceof Error) throw launcherReply;
      return launcherReply;
    },
    isGetJdActive: async () => getJdOn,
    turnGetJdOn: async (options) => { events.push(['on', { ...options }]); return { ok: true }; },
    turnGetJdOff: async (tabId) => { events.push(['off', tabId]); return { ok: true }; },
  };
  vm.runInNewContext(`${shortcutSource}\nglobalThis.toggle = toggleGetJdFromShortcut; globalThis.highlight = toggleHighlightsFromShortcut;`, context);
  return { events, context, press: (command, tab = { id: 7, url: 'https://jobs.test/1' }) => onCommand(command, tab) };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the manifest binds Alt+G to Get JD and Alt+H to Highlight, beside Alt+Q', () => {
  assert.equal(manifest.commands._execute_action.suggested_key.default, 'Alt+Q');
  assert.equal(manifest.commands['toggle-get-jd'].suggested_key.default, 'Alt+G');
  assert.equal(manifest.commands['toggle-get-jd'].description, 'Turn Get JD on or off');
  assert.equal(manifest.commands['toggle-text-highlights'].suggested_key.default, 'Alt+H');
  assert.equal(manifest.commands['toggle-text-highlights'].description, 'Show or hide the Highlight panel');
  // Chrome assigns at most four suggested keys per extension.
  assert.ok(Object.values(manifest.commands).filter((command) => command.suggested_key).length <= 4);
});

test('each shortcut reaches the page with the keys Chrome has for it now; other commands are ignored', async () => {
  const f = shortcutFixture({ launcherReply: { ok: true }, keys: { 'toggle-get-jd': 'Alt+Shift+G', 'toggle-text-highlights': 'Ctrl+Shift+H' } });
  f.press('toggle-get-jd');
  await settle(); await settle();
  f.press('toggle-text-highlights');
  await settle(); await settle();
  f.press('_execute_action');
  await settle();
  assert.deepEqual(f.events, [
    ['launcher', 7, 'QTS_GET_JD_SHORTCUT', 'Alt+Shift+G'],
    ['launcher', 7, 'QTS_HIGHLIGHT_SHORTCUT', 'Ctrl+Shift+H'],
  ]);
});

test('without a launcher the service worker turns Get JD on and keeps the daily clean-up question', async () => {
  for (const launcherReply of [{ ok: false, excluded: true }, new Error('No content script'), undefined]) {
    const f = shortcutFixture({ launcherReply });
    await f.context.toggle({ id: 7, url: 'chrome://newtab/' });
    assert.deepEqual(f.events.slice(1), [
      ['on', { askAppliedCleanup: false }],
      ['notify', 'Get JD is on. QTS checks each job page you open. Press Alt+G to turn it off.'],
    ]);
  }
});

test('without a launcher a second Get JD press turns it off for that tab', async () => {
  const f = shortcutFixture({ launcherReply: { ok: false }, getJdOn: true });
  await f.context.toggle({ id: 7, url: 'chrome://newtab/' });
  assert.deepEqual(f.events.slice(1), [['off', 7], ['notify', 'Get JD is off. Press Alt+G to turn it on again.']]);
});

test('a failed Get JD switch says why', async () => {
  const f = shortcutFixture({ launcherReply: { ok: false } });
  f.context.turnGetJdOn = async () => ({ ok: false, error: 'Sign in before starting Get JD.' });
  await f.context.toggle({ id: 7, url: 'chrome://newtab/' });
  assert.deepEqual(f.events.slice(1), [['notify', 'Sign in before starting Get JD.']]);
});

test('Highlight opens only through a launcher; elsewhere a notification says why and nothing switches', async () => {
  const opened = shortcutFixture({ launcherReply: { ok: true } });
  await opened.context.highlight({ id: 7, url: 'https://jobs.test/1' });
  assert.deepEqual(opened.events, [['launcher', 7, 'QTS_HIGHLIGHT_SHORTCUT', 'Alt+H']]);

  const excluded = shortcutFixture({ launcherReply: { ok: false, excluded: true } });
  await excluded.context.highlight({ id: 7, url: 'https://jobs.test/1' });
  assert.deepEqual(excluded.events.slice(1), [['notify', 'QTS is turned off on this page, so the Highlight panel cannot open here.']]);

  for (const launcherReply of [new Error('No content script'), undefined]) {
    const browserPage = shortcutFixture({ launcherReply });
    await browserPage.context.highlight({ id: 7, url: 'chrome://newtab/' });
    assert.deepEqual(browserPage.events.slice(1), [['notify', 'The Highlight panel opens on web pages. Open a website, then press Alt+H again.']]);
  }

  const noKeys = shortcutFixture({ launcherReply: undefined, keys: { 'toggle-text-highlights': '' } });
  await noKeys.context.highlight({});
  assert.deepEqual(noKeys.events, [['notify', 'The Highlight panel opens on web pages. Open a website, then use the shortcut again.']]);
});

test('Get JD on asks the daily clean-up question only when a launcher can show it', async () => {
  const calls = [];
  const context = {
    GET_JD_ON_KEY: 'qtsGetJdOn',
    self: { __qtsAccountAuth: { getWorkerAuthToken: async () => 'token' } },
    enableGetJdMonitoring: async () => calls.push('enable'),
    workerApiRequest: async (method, url, body) => {
      calls.push(['api', url, body.action]);
      return { success: true, ask: true, appliedCount: 3 };
    },
  };
  vm.runInNewContext(`${switchSource}\nglobalThis.on = turnGetJdOn;`, context);

  const fromPage = await context.on();
  assert.equal(fromPage.appliedCleanupCount, 3);
  assert.equal(fromPage.message, 'Get JD is on. QTS checks each job page you open.');
  assert.deepEqual(calls, ['enable', ['api', '/api/extension/get-jd/applied-cleanup', 'check']]);

  calls.length = 0;
  const fromShortcut = await context.on({ askAppliedCleanup: false });
  assert.equal(fromShortcut.appliedCleanupCount, 0);
  assert.deepEqual(calls, ['enable']);

  context.self.__qtsAccountAuth.getWorkerAuthToken = async () => null;
  calls.length = 0;
  assert.deepEqual(JSON.parse(JSON.stringify(await context.on())), { ok: false, authRequired: true, error: 'Sign in before starting Get JD.' });
  assert.deepEqual(calls, []);
});

test('the launcher answers each shortcut through the same actions as its buttons', () => {
  const getJd = slice(launcher, 'async function toggleGetJdFromShortcut(', 'async function toggleHighlightsFromShortcut(');
  assert.ok(getJd.includes("action: turnOn ? 'get_jd' : 'cancel_get_jd'"));
  assert.ok(getJd.includes('askAppliedCleanup(response.appliedCleanupCount)'));
  assert.ok(getJd.includes("signedInForShortcut(shortcut, 'turn on Get JD')"));
  const highlight = slice(launcher, 'async function toggleHighlightsFromShortcut(', 'async function handleLauncherClick(');
  assert.ok(highlight.includes("menu.querySelector('[data-action=\"text_highlights\"]')"));
  assert.ok(highlight.includes('await openHighlightPanel(button)'));
  assert.ok(highlight.includes("signedInForShortcut(shortcut, 'open Highlight')"));
  // Open, it closes the way the panel's Back button does; another settings page switches to Highlight.
  assert.ok(highlight.includes("review?.openManagerSettingsPanel?.() === 'text-highlights'"));
  assert.ok(highlight.includes('review.closeManagerSettings()'));
  const review = fs.readFileSync(path.join(extensionRoot, 'content', 'get-jd-review.js'), 'utf8');
  assert.ok(review.includes("section.querySelector('[data-settings-back]').addEventListener('click', closeManagerSettings)"));
  assert.match(review, /openManagerSettingsPanel\(\) \{\r?\n\s*return managerSettingsOpen \? managerSettingsPanel : '';/);
  assert.match(review, /managerSettingsOpen = true;\r?\n\s*managerSettingsPanel = panel;/);
  assert.ok(launcher.includes('const shortcutToast = (message, type) => globalThis.__qtsPageToast?.show(message, { type });'));
  assert.ok(launcher.includes("['QTS_GET_JD_SHORTCUT', 'toggleGetJdFromShortcut']"));
  assert.ok(launcher.includes("['QTS_HIGHLIGHT_SHORTCUT', 'toggleHighlightsFromShortcut']"));
  assert.match(launcher, /toggleFromToolbar,\r?\n\s*toggleGetJdFromShortcut,\r?\n\s*toggleHighlightsFromShortcut,\r?\n/);
});
