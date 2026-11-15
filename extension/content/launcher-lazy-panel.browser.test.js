// The launcher fills its panel only while it shows: closed, a page pays just for the tab (signed in,
// its dot) and asks the worker nothing for the panel; opened, the panel is up to date before it
// shows, so a click never acts on an old row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));

test('closed, the panel is not filled; opened, it is up to date before it shows', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Job page</h1>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
      window.calls = [];
      // Generation is running in this Chrome.
      window.stored = { authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager', displayName: 'Ana Manager' }, qtsExtensionStatus: 'generation' };
      window.chrome = {
        runtime: { id: 'fixture', getURL: (p) => `https://extension.test/${p}`, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async (message) => {
          window.calls.push(message);
          if (message.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
          if (message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, canUseApply: true, canManageTextHighlights: true };
          return { ok: true, accounts: [], applications: [] };
        } },
        storage: { local: { get: async () => structuredClone(window.stored), set: async () => {} }, onChanged: { addListener(fn) { window.storageChanged = fn; }, removeListener() {} } },
      };
    });
    for (const file of ['shared/runtime-config.js', 'shared/get-jd-notifications.js', 'content/page-launcher.js']) await page.addScriptTag({ path: path.resolve('extension', file) });
    await page.waitForFunction(() => window.testRoot?.querySelector('.launcher')?.classList.contains('signed-in'));
    // The tab's dot says Generation runs...
    await page.waitForFunction(() => window.testRoot.querySelector('.launcher').classList.contains('running'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    // ...while the hidden panel was not filled and nothing was asked for it.
    const closed = await page.evaluate(() => ({
      tag: window.testRoot.querySelector('[data-action="generation"] .action-tag').textContent,
      features: window.calls.filter((m) => m.type === 'GET_MANAGER_EXTENSION_FEATURES').length,
    }));
    assert.deepEqual(closed, { tag: '', features: 0 });

    // Clicking the tab: when the panel turns visible, its rows already say what is running.
    await page.evaluate(() => {
      const menu = window.testRoot.querySelector('.menu');
      new MutationObserver(() => {
        if (!menu.hidden && !window.seenWhenShown) {
          const button = window.testRoot.querySelector('[data-action="generation"]');
          window.seenWhenShown = { tag: button.querySelector('.action-tag').textContent, action: button.dataset.modeAction };
        }
      }).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
      window.testRoot.querySelector('.main').click();
    });
    await page.waitForFunction(() => Boolean(window.seenWhenShown));
    assert.deepEqual(await page.evaluate(() => window.seenWhenShown), { tag: 'Running', action: 'cancel_status' });
    // The Tools rows were checked for this Manager on opening.
    await page.waitForFunction(() => !window.testRoot.querySelector('[data-action="text_highlights"]').hidden);

    // Open, changes show at once, as before.
    await page.evaluate(() => {
      window.stored.qtsExtensionStatus = null;
      window.storageChanged({ qtsExtensionStatus: { newValue: null } }, 'local');
    });
    await page.waitForFunction(() => window.testRoot.querySelector('[data-action="generation"]').dataset.modeAction === 'generation');
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('.launcher').classList.contains('running')), false);
  } finally {
    await browser.close();
  }
});
