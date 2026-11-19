// Real extension in real Chrome, with a local mock QTS server. No database or external AI calls.
// Get JD on: every job tab opened shows its Get JD panel, also a page that changes its own address
// just after loading (tracking parameters: /jobs/2 → /jobs/2?utm_source=qts), in front or in the background.
// Once the panel shows, a later in-page jump to another address starts nothing (as before).
// Run with: node --test extension/content/get-jd-url-settle.browser.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../..');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome']
  .find((file) => file && fs.existsSync(file));
const until = async (check, ms = 45000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
};
const DESCRIPTION = Array.from({ length: 14 }, (_, index) => `Responsibility ${index}: build Python services using FastAPI and PostgreSQL, with production engineering experience, for this full-time remote role.`).join(' ');
const jobPage = (extra = '') => `<html><head><title>Software Engineer at Example</title></head><body>${extra}<main><h1>Software Engineer</h1><span data-testid="company-name">Example</span><section data-testid="job-description"><p>${DESCRIPTION}</p></section></main></body></html>`;

test('every job tab opened shows its Get JD panel, also one that changes its own address on load', { skip: !CHROME, timeout: 300000 }, async () => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (!req.url.startsWith('/api/')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // "settle": the page adds tracking parameters to its address 0.4 s after loading.
      const extra = url.pathname.includes('settle') && !url.search
        ? '<script>setTimeout(() => history.replaceState(null, "", location.pathname + "?utm_source=qts"), 400)</script>' : '';
      res.end(jobPage(extra));
      return;
    }
    for await (const chunk of req) void chunk;
    let result = { success: true, managerId: 'test-manager', rules: [], exclusions: [], features: {} };
    if (req.url === '/api/extension/get-jd/check') result = { success: true, skip: false, precheckToken: 'fixture' };
    else if (req.url === '/api/extension/get-jd/mode') result = { success: true, mode: 'gemini' };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'] });
    const worker = await (await browser.waitForTarget((target) => target.type() === 'service_worker')).worker();
    await worker.evaluate(async (url) => chrome.storage.local.set({
      qtsServerUrl: url, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000,
      qtsSessionUser: { id: 'test-manager', role: 'manager', displayName: 'Test' }, qtsGetJdOn: false, qtsGetJdAutoClose: false,
    }), base);
    const control = await browser.newPage();
    await control.goto(`${base}/jobs/control`);
    const controlId = await worker.evaluate(async (target) => (await chrome.tabs.query({})).find((tab) => tab.url === target)?.id, control.url());
    assert.ok(await until(() => control.evaluate(() => Boolean(document.querySelector('[data-qts-page-launcher]')))));
    const on = await worker.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: 'get_jd' }) }))[0].result, controlId);
    assert.equal(on.ok, true);

    const result = (id) => worker.evaluate(async (tabId) => (await chrome.storage.session.get('qtsGetJdResults')).qtsGetJdResults?.[tabId] || null, id);
    const kinds = ['front', 'back', 'front-settle', 'back-settle', 'back', 'front-settle', 'back-settle', 'front'];
    const opened = [];
    for (const [index, kind] of kinds.entries()) {
      const pathname = `/jobs/${kind.endsWith('settle') ? 'settle-' : ''}${index + 1}`;
      opened.push({ kind, tab: await worker.evaluate(async (url, active) => chrome.tabs.create({ url, active }), base + pathname, kind.startsWith('front')) });
    }
    const shown = {};
    for (const { kind, tab } of opened) {
      const draft = await until(async () => ((await result(tab.id))?.status === 'draft' ? result(tab.id) : null));
      const now = await worker.evaluate(async (id) => chrome.tabs.get(id), tab.id);
      const page = (await browser.pages()).find((entry) => entry.url() === now.url);
      const docked = page && await until(() => page.evaluate(() => document.documentElement.getAttribute('data-qts-get-jd-docked') === 'true'), 10000);
      const last = await result(tab.id);
      shown[`${tab.id} ${kind}`] = Boolean(draft) && Boolean(docked) && (!kind.endsWith('settle') || draft.pageUrl.endsWith("?utm_source=qts"))
        || { status: last?.status, pageUrl: last?.pageUrl, tabUrl: now.url, docked: Boolean(docked), message: last?.message };
    }
    assert.ok(Object.values(shown).every((value) => value === true), `every tab shows its Get JD panel: ${JSON.stringify(shown)}`);

    // The panel is showing: an in-page jump to another address (a list's next job) starts nothing.
    const first = opened[0].tab;
    const before = await result(first.id);
    await worker.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => history.pushState(null, '', '/jobs/elsewhere') }), first.id);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const after = await result(first.id);
    assert.equal(after?.runId, before.runId, 'no new Get JD read after the panel showed');
  } finally {
    await browser?.close();
    server.close();
  }
});
