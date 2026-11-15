// Real launcher and toast scripts in Chrome with a stubbed extension API: the Alt+G and Alt+H
// messages act like the Get JD row and the Highlight button. No server or AI calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));

async function openLauncherPage(browser) {
  const page = await browser.newPage();
  await page.setContent('<h1>Job page</h1>');
  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    window.roots = [];
    Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.roots.push(root); return root; };
    window.calls = [];
    window.listeners = [];
    window.opened = [];
    window.canHighlight = true;
    window.stored = { authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager' }, qtsGetJdOn: false };
    window.cleanupCount = 2;
    // The Get JD panel's Manager settings, which the Highlight button opens and its Back button closes.
    window.settingsPage = '';
    window.closeCount = 0;
    window.__qtsInitializeGetJdReview = async () => {};
    window.__qtsGetJdReview = {
      openManagerSettings: async (panel, tabId, permissions) => { window.opened.push([panel, tabId, permissions.canManageTextHighlights]); window.settingsPage = panel; },
      openManagerSettingsPanel: () => window.settingsPage,
      closeManagerSettings: () => { window.closeCount += 1; window.settingsPage = ''; },
    };
    window.chrome = {
      runtime: {
        id: 'fixture',
        getURL: (p) => `https://extension.test/${p}`,
        onMessage: { addListener(fn) { window.listeners.push(fn); }, removeListener(fn) { window.listeners = window.listeners.filter((l) => l !== fn); } },
        sendMessage: async (message) => {
          window.calls.push(message);
          if (message.type === 'QTS_GET_LAUNCHER_STATE') return { ok: true, active: true };
          if (message.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true, excluded: window.excluded === true };
          if (message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, tabId: 5, canManageTextHighlights: window.canHighlight };
          if (message.type === 'QTS_PAGE_ACTION' && message.action === 'get_jd') {
            window.stored.qtsGetJdOn = true;
            return { ok: true, status: 'get_jd', appliedCleanupCount: window.cleanupCount };
          }
          if (message.type === 'QTS_PAGE_ACTION' && message.action === 'cancel_get_jd') {
            window.stored.qtsGetJdOn = false;
            return { ok: true, status: 'get_jd_off' };
          }
          return { ok: true, accounts: [], applications: [] };
        },
      },
      storage: { local: { get: async () => structuredClone(window.stored), set: async (v) => Object.assign(window.stored, v) }, onChanged: { addListener() {}, removeListener() {} } },
    };
    // What chrome.tabs.sendMessage does: every listener sees it; the one that returns true answers.
    window.press = (type, shortcut) => new Promise((resolve) => {
      for (const listener of [...window.listeners]) {
        if (listener({ type, shortcut }, {}, resolve) === true) return;
      }
      resolve(undefined);
    });
    window.toasts = () => window.roots.flatMap((root) => [...root.querySelectorAll('.toast:not(.leaving) .text')].map((n) => n.textContent));
    window.pageActions = () => window.calls.filter((m) => m.type === 'QTS_PAGE_ACTION').map((m) => m.action);
    window.signInShown = () => window.roots.some((root) => root.querySelector('iframe[title="QTS Manager sign in"]'));
  });
  for (const file of ['shared/runtime-config.js', 'shared/get-jd-notifications.js', 'content/page-toast.js', 'content/page-launcher.js']) {
    await page.addScriptTag({ path: path.resolve('extension', file) });
  }
  await page.waitForFunction(() => Boolean(window.__qtsPageLauncher?.toggleGetJdFromShortcut));
  return page;
}

test('Alt+G turns Get JD on and off with a toast each time, and asks sign-in first', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await openLauncherPage(browser);
    const press = (shortcut = 'Alt+G') => page.evaluate((s) => window.press('QTS_GET_JD_SHORTCUT', s), shortcut);

    // First press: on, with the toast and the daily clean-up question.
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await page.evaluate(() => window.pageActions()), ['get_jd']);
    assert.deepEqual(await page.evaluate(() => window.toasts()), ['Get JD is on. QTS checks each job page you open. Press Alt+G to turn it off.']);
    assert.equal(await page.evaluate(() => window.roots.some((root) => {
      const ask = root.querySelector('.cleanup');
      return ask && !ask.hidden && ask.textContent.includes('2 job rows are already applied');
    })), true);

    // Second press: off. Third: on again, and its toast is shown although the same text was shown seconds ago.
    await page.evaluate(() => { window.cleanupCount = 0; });
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await page.evaluate(() => window.pageActions()), ['get_jd', 'cancel_get_jd', 'get_jd']);
    assert.deepEqual(await page.evaluate(() => window.toasts()), [
      'Get JD is on. QTS checks each job page you open. Press Alt+G to turn it off.',
      'Get JD is off. Press Alt+G to turn it on again.',
      'Get JD is on. QTS checks each job page you open. Press Alt+G to turn it off.',
    ]);

    // Signed out: nothing is switched; the Sign In card opens and the toast says to sign in first.
    await page.evaluate(() => { window.stored.authExpiresAt = null; });
    assert.deepEqual(await press('Alt+Shift+G'), { ok: true });
    assert.deepEqual(await page.evaluate(() => window.pageActions()), ['get_jd', 'cancel_get_jd', 'get_jd']);
    assert.equal((await page.evaluate(() => window.toasts()))[0], 'Sign in to QTS first, then press Alt+Shift+G to turn on Get JD.');
    assert.equal(await page.evaluate(() => window.signInShown()), true);

    // QTS turned off on this page: the launcher declines, so the service worker switches Get JD instead.
    await page.evaluate(() => { window.excluded = true; window.__qtsPageLauncher.disable(); });
    assert.deepEqual(await press(), { ok: false, excluded: true });
    assert.deepEqual(await page.evaluate(() => window.pageActions()), ['get_jd', 'cancel_get_jd', 'get_jd']);
  } finally { await browser.close(); }
});

test('Alt+H opens and closes the Highlight panel like its buttons, or says why it cannot', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await openLauncherPage(browser);
    const press = (shortcut = 'Alt+H') => page.evaluate((s) => window.press('QTS_HIGHLIGHT_SHORTCUT', s), shortcut);
    const state = () => page.evaluate(() => ({ opened: window.opened.length, closed: window.closeCount, page: window.settingsPage }));

    // With access: the actions panel closes and the Highlight settings open for this tab.
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await page.evaluate(() => window.opened), [['text-highlights', 5, true]]);
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-qts-menu-docked')), 'false');
    assert.equal(await page.evaluate(() => window.calls.some((m) => m.type === 'GET_MANAGER_EXTENSION_FEATURES' && m.refresh === true)), true);
    // Pressed again, it closes as the panel's Back button does; a third press opens it again.
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await state(), { opened: 1, closed: 1, page: '' });
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await state(), { opened: 2, closed: 1, page: 'text-highlights' });
    // Another settings page open (Site Setting): it switches to Highlight instead of closing.
    await page.evaluate(() => { window.settingsPage = 'page-exclusions'; });
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await state(), { opened: 3, closed: 1, page: 'text-highlights' });
    assert.deepEqual(await page.evaluate(() => window.toasts()), []);

    // Without access: nothing opens and the Highlight button's own message shows.
    await page.evaluate(() => { window.settingsPage = ''; window.canHighlight = false; });
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await state(), { opened: 3, closed: 1, page: '' });
    assert.deepEqual(await page.evaluate(() => window.toasts()), ['Ask your Super Admin for text highlight management.']);

    // Signed out: the Sign In card opens and the toast says to sign in first.
    await page.evaluate(() => { window.canHighlight = true; window.stored.authExpiresAt = null; });
    assert.deepEqual(await press(), { ok: true });
    assert.deepEqual(await state(), { opened: 3, closed: 1, page: '' });
    assert.equal((await page.evaluate(() => window.toasts()))[0], 'Sign in to QTS first, then press Alt+H to open Highlight.');
    assert.equal(await page.evaluate(() => window.signInShown()), true);

    // QTS turned off on this page: the launcher declines and the service worker says so.
    await page.evaluate(() => { window.excluded = true; window.__qtsPageLauncher.disable(); });
    assert.deepEqual(await press(), { ok: false, excluded: true });
    assert.deepEqual(await state(), { opened: 3, closed: 1, page: '' });
  } finally { await browser.close(); }
});
