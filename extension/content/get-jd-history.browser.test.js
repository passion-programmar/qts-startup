const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));

test('launcher shows three completed results only while Get JD is on and restores saved history when enabled again', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Job page</h1>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
      window.calls = [];
      window.stored = { authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager' }, qtsGetJdOn: true,
        qtsGetJdNotificationState: { history: Array.from({ length: 5 }, (_, i) => ({ operationId: `tab:${i}`, title: `Job ${i}`, status: i === 4 ? 'processing' : 'success', outcome: 'review', label: 'Review needed', evaluationMode: 'gemini', pageUrl: `https://jobs.example/${i}`, message: 'Matching finished', updatedAt: Date.now() })) } };
      window.chrome = {
        runtime: { id: 'fixture', getURL: (p) => `https://extension.test/${p}`, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async (message) => {
          window.calls.push(message);
          if (message.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
          if (message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, canUseApply: true };
          return { ok: true, accounts: [], applications: [] };
        } },
        storage: { local: { get: async () => structuredClone(window.stored) }, onChanged: { addListener(fn) { window.storageChanged = fn; }, removeListener() {} } },
      };
    });
    for (const file of ['shared/runtime-config.js', 'shared/get-jd-notifications.js', 'content/page-launcher.js']) await page.addScriptTag({ path: path.resolve('extension', file) });
    await page.waitForFunction(() => Boolean(window.__qtsPageLauncher));
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
    const selector = '[data-sub-for="get_jd"] .sub-item';
    await page.waitForFunction((s) => window.testRoot.querySelectorAll(s).length === 3, {}, selector);
    const texts = await page.evaluate((s) => [...window.testRoot.querySelectorAll(s)].map((n) => n.textContent), selector);
    assert.ok(texts[0].includes('Job 3') && texts[1].includes('Job 2') && texts[2].includes('Job 1'));
    assert.ok(texts.every((text) => text.includes('Review needed')));
    await page.evaluate((s) => window.testRoot.querySelector(s).click(), selector);
    await page.waitForFunction(() => window.calls.some((m) => m.type === 'QTS_OPEN_GET_JD_RESULT' && m.operationId === 'tab:3'));
    await page.evaluate(() => {
      window.__qtsPageLauncher.setOpen(false);
      window.stored.qtsGetJdOn = false;
      window.storageChanged({ qtsGetJdOn: { newValue: false } }, 'local');
      window.__qtsPageLauncher.setOpen(true);
    });
    await page.waitForFunction((s) => window.testRoot.querySelectorAll(s).length === 0 && window.testRoot.querySelector('[data-sub-for="get_jd"]').hidden, {}, selector);
    assert.equal(await page.evaluate(() => window.stored.qtsGetJdNotificationState.history.length), 5);
    await page.evaluate(() => {
      window.stored.qtsGetJdNotificationState.history[3].label = 'Saved for 2 accounts';
      window.storageChanged({ qtsGetJdNotificationState: { newValue: window.stored.qtsGetJdNotificationState } }, 'local');
    });
    // Let the storage-triggered refresh finish while disabled: new results must stay hidden.
    await page.waitForFunction(() => window.testRoot.querySelector('[data-sub-for="get_jd"]').hidden);
    await page.evaluate(() => {
      window.stored.qtsGetJdOn = true;
      window.storageChanged({ qtsGetJdOn: { newValue: true } }, 'local');
    });
    await page.waitForFunction((s) => window.testRoot.querySelectorAll(s).length === 3, {}, selector);
    await page.waitForFunction((s) => window.testRoot.querySelector(s).textContent.includes('Saved for 2 accounts'), {}, selector);
    // A new document reads the same persisted history without receiving a live result event.
    const restored = await browser.newPage();
    await restored.setContent('<h1>Another job tab</h1>');
    await restored.evaluate((stored) => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
      window.chrome = {
        runtime: { id: 'fixture', getURL: (p) => `https://extension.test/${p}`, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async (m) => m.type === 'QTS_GET_LAUNCHER_STATE' ? { active: true } : { ok: true, canUseApply: true, accounts: [], applications: [] } },
        storage: { local: { get: async () => stored }, onChanged: { addListener() {}, removeListener() {} } },
      };
    }, await page.evaluate(() => window.stored));
    for (const file of ['shared/runtime-config.js', 'shared/get-jd-notifications.js', 'content/page-launcher.js']) await restored.addScriptTag({ path: path.resolve('extension', file) });
    await restored.waitForFunction((s) => window.testRoot?.querySelectorAll(s).length === 3, {}, selector);
    assert.equal(await restored.evaluate((s) => window.testRoot.querySelector(s).textContent.includes('Saved for 2 accounts'), selector), true);
    await restored.close();
    await page.evaluate(() => { window.stored.authExpiresAt = null; window.storageChanged({ authExpiresAt: { newValue: null } }, 'local'); });
    await page.waitForFunction((s) => window.testRoot.querySelectorAll(s).length === 0, {}, selector);
    assert.equal(await page.evaluate(() => window.calls.some((m) => /save|evaluate/i.test(m.type))), false);
  } finally { await browser.close(); }
});
