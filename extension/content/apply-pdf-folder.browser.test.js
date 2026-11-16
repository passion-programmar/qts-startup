// The supported launcher with synthetic Manager permissions; no workflow is started.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));

test('the launcher shows Apply PDFs folder to every signed-in Manager, with legacy automation disabled', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    for (const [signedIn, canUseApply, ok] of [[true, true, true], [true, false, true], [false, true, true], [true, true, false]]) {
      const page = await browser.newPage();
      await page.setContent('<h1>Synthetic job page</h1>');
      await page.evaluate(({ signedIn, canUseApply, ok }) => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
        window.calls = [];
        window.chrome = {
          runtime: { id: 'fixture', getURL: (p) => `https://extension.test/${p}`, onMessage: { addListener() {}, removeListener() {} },
            sendMessage: async (message) => {
              window.calls.push(message);
              if (message.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
              if (message.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true };
              if (message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok, canUseApply, tabId: 1 };
              return { ok: true, accounts: [], applications: [] };
            } },
          storage: { local: { get: async () => ({ authExpiresAt: signedIn ? Date.now() + 3600000 : null }) }, onChanged: { addListener() {}, removeListener() {} } },
        };
      }, { signedIn, canUseApply, ok });
      await page.evaluate(() => {
        window.__qtsInitializeGetJdReview = async () => {};
        window.__qtsGetJdReview = {
          openManagerSettings: async (...args) => { window.openedSettings = args; },
        };
      });
      await page.addScriptTag({ path: path.resolve('extension/shared/runtime-config.js') });
      await page.addScriptTag({ path: path.resolve('extension/content/page-launcher.js') });
      await page.waitForFunction(() => Boolean(window.__qtsPageLauncher));
      await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
      await page.waitForFunction(() => window.calls.some((m) => m.type === 'GET_MANAGER_EXTENSION_FEATURES') || !window.testRoot.querySelector('.launcher').classList.contains('signed-in'));
      const visible = await page.evaluate(() => !window.testRoot.querySelector('[data-action="apply_pdf_folder"]').hidden);
      // Every signed-in Manager saves the QTS_Resume folder: Generation needs it too, not only Apply.
      assert.equal(visible, signedIn && ok);
      assert.equal(await page.evaluate(() => window.__qtsRuntimeConfig.features.applicationAutomation), false);
      if (visible) {
        assert.equal(await page.evaluate(() => [...window.testRoot.querySelectorAll('.label-top')].find((n) => n.textContent === 'Tools').hidden), false);
        await page.evaluate(() => window.testRoot.querySelector('[data-action="apply_pdf_folder"]').click());
        await page.waitForFunction(() => Boolean(window.openedSettings));
        assert.equal(await page.evaluate(() => window.openedSettings[0]), 'apply-pdf-folder');
        assert.equal(await page.evaluate(() => window.openedSettings[2].canUseApply), canUseApply);
        assert.equal(await page.evaluate(() => window.calls.some((m) => m.type === 'QTS_PAGE_ACTION' && m.action === 'apply_pdf_folder')), false);
        assert.equal(await page.evaluate(() => window.calls.some((m) => ['apply', 'auto_apply'].includes(m.action))), false);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('a work row refused for a missing QTS_Resume folder says so and opens the folder setting', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    for (const mode of ['generation', 'apply', 'auto_apply']) {
      const page = await browser.newPage();
      await page.setContent('<h1>Synthetic job page</h1>');
      await page.evaluate((mode) => {
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
        window.calls = [];
        window.chrome = {
          runtime: { id: 'fixture', getURL: (p) => `https://extension.test/${p}`, onMessage: { addListener() {}, removeListener() {} },
            sendMessage: async (message) => {
              window.calls.push(message);
              if (message.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
              if (message.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true };
              // A Manager with Apply off still gets the folder setting.
              if (message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, canUseApply: mode !== 'generation', canUseAutoApply: mode !== 'generation', tabId: 1 };
              if (message.type === 'QTS_PAGE_ACTION' && message.action === mode) {
                return { ok: false, resumeFolderRequired: true, error: 'Save the QTS_Resume folder first (Downloads › QTS_Resume), then click it again.' };
              }
              return { ok: true, accounts: [], applications: [] };
            } },
          storage: { local: { get: async () => ({ authExpiresAt: Date.now() + 3600000 }) }, onChanged: { addListener() {}, removeListener() {} } },
        };
        window.__qtsInitializeGetJdReview = async () => {};
        window.__qtsGetJdReview = { openManagerSettings: async (...args) => { window.openedSettings = args; } };
      }, mode);
      await page.addScriptTag({ path: path.resolve('extension/shared/runtime-config.js') });
      await page.addScriptTag({ path: path.resolve('extension/content/page-launcher.js') });
      await page.waitForFunction(() => Boolean(window.__qtsPageLauncher));
      await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
      await page.waitForFunction((mode) => {
        const button = window.testRoot?.querySelector(`[data-action="${mode}"]`);
        return button && !button.disabled && !button.closest('.row')?.hidden;
      }, {}, mode);
      await page.evaluate((mode) => window.testRoot.querySelector(`[data-action="${mode}"]`).click(), mode);
      // The folder setting opens on its own.
      await page.waitForFunction(() => Boolean(window.openedSettings));
      assert.equal(await page.evaluate(() => window.openedSettings[0]), 'apply-pdf-folder', mode);
      // The row explains why nothing started, as a warning rather than a failure: seen in the panel,
      // which the folder setting closed (it fills again when it opens).
      await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
      await page.waitForFunction((mode) => /Save the QTS_Resume folder first/.test(window.testRoot.querySelector(`[data-action="${mode}"] .action-detail`)?.textContent || ''), {}, mode);
      assert.equal(await page.evaluate((mode) => window.testRoot.querySelector(`[data-action="${mode}"] .action-detail`).className, mode), 'action-detail warn');
      assert.notEqual(await page.evaluate((mode) => window.testRoot.querySelector(`[data-action="${mode}"] .action-tag`).textContent, mode), 'Failed');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
