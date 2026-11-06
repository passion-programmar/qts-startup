// Real Chrome: pages loaded before extension installation, new pages and cross-window tab moves.
// Synthetic sign-in and local HTTP only. No toolbar clicks, database, scans, or applications.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));

test('launcher follows tab switches and window moves and restores old tabs without clicking the extension', { skip: !CHROME, timeout: 120000 }, async () => {
  const requests = [], images = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/slow-image') { images.push(res); return; }
    if (req.url.startsWith('/api/')) {
      requests.push(req.url); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, rules: [], exclusions: [], features: {} })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><title>Synthetic page</title></head><body><h1>Example page</h1>' + (req.url === '/slow-page' ? '<img src="/slow-image">' : '') + '</body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true });
  const wait = async (label, check) => { const end = Date.now() + 20000; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw Error(label); };
  try {
    const pages = [];
    for (let i = 0; i < 2; i++) { const page = await browser.newPage(); await page.goto(base + '/old-' + i); pages.push(page); }
    await browser.installExtension(path.resolve('extension'));
    const worker = await (await browser.waitForTarget(t => t.type() === 'service_worker')).worker();
    await worker.evaluate(base => chrome.storage.local.set({ qtsServerUrl: base, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'synthetic-manager', role: 'manager' }, qtsGetJdOn: false }), base);
    const mounted = page => page.evaluate(() => Boolean(document.querySelector('[data-qts-page-launcher]')));
    const summaryId = page => page.evaluate(() => document.querySelector('[data-qts-page-toast]')?.getAttribute('data-qts-get-jd-summary-id') || '');
    const oneLauncher = async index => { const states = await Promise.all(pages.map(mounted)); return states[index] && states.filter(Boolean).length === 1; };
    for (const index of [0, 1, 0, 1]) { await pages[index].bringToFront(); await wait('launcher must follow old tab without toolbar click', () => oneLauncher(index)); }
    const batch = await worker.evaluate(() => ({
      id: 'cross-tab-get-jd-test',
      startedAt: Date.now() - 3000,
      expiresAt: Date.now() - 1000,
      dismissAt: Date.now() + 5000,
      updatedAt: Date.now(),
      items: [{ operationId: 'test-run', status: 'success', evaluationMode: 'gemini', pageTitle: 'Synthetic result', updatedAt: Date.now() }],
    }));
    await worker.evaluate(async batch => chrome.storage.local.set({ qtsGetJdNotificationState: { history: [], batch } }), batch);
    await pages[0].bringToFront();
    await wait('live Get JD summary follows the active eligible tab', async () => (await summaryId(pages[0])) === batch.id);
    assert.equal(await summaryId(pages[1]), '', 'background tabs do not receive active-page summaries');
    await worker.evaluate(async () => chrome.storage.local.set({
      qtsGetJdNotificationState: {
        history: [],
        batch: { id: 'expired-get-jd-test', dismissAt: Date.now() - 1, items: [] },
      },
    }));
    await pages[1].bringToFront();
    await wait('launcher follows the tab after the live summary expires', () => oneLauncher(1));
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await summaryId(pages[1]), '', 'expired summaries are not replayed on tab changes');
    const fresh = await browser.newPage(); pages.push(fresh);
    await fresh.goto(base + '/slow-page', { waitUntil: 'domcontentloaded' });
    await wait('launcher visible before the image finishes', () => oneLauncher(2));
    assert.notEqual(await fresh.evaluate(() => document.readyState), 'complete');
    const id = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, fresh.url());
    const originalWindowId = await worker.evaluate(async id => (await chrome.tabs.get(id)).windowId, id);
    await worker.evaluate(id => chrome.windows.create({ tabId: id, focused: true }), id);
    await wait('launcher survives moving to a new window', () => oneLauncher(2));
    // Headless Chrome reports both windows focused, so OS focus transitions are covered by the
    // focus-controller unit tests. Here exercise real attach/detach events in both directions.
    await worker.evaluate(async (id, windowId) => {
      await chrome.tabs.move(id, { windowId, index: -1 });
      await chrome.tabs.update(id, { active: true });
      await chrome.windows.update(windowId, { focused: true });
    }, id, originalWindowId);
    await pages[0].bringToFront(); await wait('launcher returns after moving back', () => oneLauncher(0));
    await fresh.bringToFront(); await wait('launcher returns to the moved tab', () => oneLauncher(2));
    // Reinjection races must not create duplicate scripts/listeners or a lexical declaration error.
    await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, files: ['content/page-launcher.js'] }), id);
    assert.equal(await fresh.evaluate(() => document.querySelectorAll('[data-qts-page-launcher]').length), 1);
    await worker.evaluate(async id => {
      await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.querySelector('[data-qts-page-launcher]')?.remove() });
      await chrome.tabs.sendMessage(id, { type: 'QTS_LAUNCHER_ACTIVE', active: true });
    }, id);
    await wait('detached launcher host is restored', () => mounted(fresh));
    assert.equal(requests.some(url => /\/get-jd\/check|\/generation\/|\/apply\//.test(url)), false, 'visibility changes do not trigger workflows');
  } finally {
    for (const res of images) res.end();
    await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});
