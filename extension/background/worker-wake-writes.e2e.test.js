// Real extension, fake QTS server: waking the background worker (as any page, alarm or click does)
// with no work running writes nothing to storage. Every write is announced to every open tab's
// storage listeners, so a wake-up that writes costs every tab some work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

test('a worker wake-up with nothing running writes nothing to storage', { skip: !CHROME, timeout: 90000 }, async () => {
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, managerId: 'manager', rules: [], exclusions: [], features: { canUseApply: true } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Puppeteer stays off the worker, as a restarted worker would stay paused under it.
  const browser = await require('puppeteer-core').launch({
    executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.resolve('extension')],
    targetFilter: (target) => target.type() !== 'service_worker', args: ['--no-first-run'],
  });
  try {
    const session = await browser.target().createCDPSession();
    let extensionId = null;
    for (let i = 0; i < 100 && !extensionId; i += 1) {
      const { targetInfos } = await session.send('Target.getTargets');
      const worker = targetInfos.find((target) => target.type === 'service_worker' && target.url.includes('/background/service-worker.js'));
      if (worker) extensionId = new URL(worker.url).host;
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(extensionId, 'the extension loaded');
    const control = await browser.newPage();
    await control.goto(`chrome-extension://${extensionId}/signin/signin.html`);
    // A signed-in Manager with Generation, Apply and Get JD off.
    await control.evaluate((serverUrl) => chrome.storage.local.set({
      qtsServerUrl: serverUrl, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000,
      qtsSessionUser: { id: 'manager', role: 'manager' }, qtsGetJdOn: false,
    }), `http://127.0.0.1:${server.address().port}`);
    const cdp = await control.createCDPSession();
    await cdp.send('ServiceWorker.enable');
    const ping = () => control.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_QTS_RUNTIME_CONFIG' }));
    await ping();
    // Let the first start-up (token move, rule cache) finish before watching.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    for (let round = 1; round <= 2; round += 1) {
      await cdp.send('ServiceWorker.stopAllWorkers');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await control.evaluate(() => {
        window.qtsWrites = [];
        chrome.storage.onChanged.addListener((changes, area) => window.qtsWrites.push(`${area}: ${Object.keys(changes).join(', ')}`));
      });
      await ping();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const writes = await control.evaluate(() => window.qtsWrites);
      assert.deepEqual(writes, [], `wake-up ${round} wrote: ${writes.join(' | ')}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Get JD's results and the idle pacing never go to local storage, which reaches every tab", { skip: !CHROME, timeout: 90000 }, async () => {
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    if (req.url.startsWith('/job')) {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Senior DevOps Engineer</title><main><h1>Senior DevOps Engineer</h1><p>Example Corp</p>'
        + '<h2>Responsibilities</h2><p>Run Kubernetes clusters.</p><h2>Requirements</h2><p>Five years of cloud work.</p></main>');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, managerId: 'manager', rules: [], exclusions: [], features: { canUseApply: true } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await require('puppeteer-core').launch({
    executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.resolve('extension')],
    targetFilter: (target) => target.type() !== 'service_worker', args: ['--no-first-run'],
  });
  try {
    const session = await browser.target().createCDPSession();
    let extensionId = null;
    for (let i = 0; i < 100 && !extensionId; i += 1) {
      const { targetInfos } = await session.send('Target.getTargets');
      const worker = targetInfos.find((target) => target.type === 'service_worker' && target.url.includes('/background/service-worker.js'));
      if (worker) extensionId = new URL(worker.url).host;
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(extensionId, 'the extension loaded');
    const control = await browser.newPage();
    await control.goto(`chrome-extension://${extensionId}/signin/signin.html`);
    await control.evaluate((serverUrl) => chrome.storage.local.set({
      qtsServerUrl: serverUrl, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000,
      qtsSessionUser: { id: 'manager', role: 'manager' }, qtsGetJdOn: false,
    }), base);
    await control.evaluate(() => {
      window.qtsChanges = [];
      chrome.storage.onChanged.addListener((changes, area) => window.qtsChanges.push({ area, keys: Object.keys(changes) }));
    });
    const turnedOn = await control.evaluate(() => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: 'get_jd' }));
    assert.equal(turnedOn.ok, true, JSON.stringify(turnedOn));
    const page = await browser.newPage();
    await page.goto(`${base.replace('127.0.0.1', 'localhost')}/job`, { waitUntil: 'load' });
    // Get JD reads the page and saves its result for the tab.
    const end = Date.now() + 20000;
    let changes = [];
    while (Date.now() < end) {
      changes = await control.evaluate(() => window.qtsChanges);
      if (changes.some(({ area, keys }) => area === 'session' && keys.includes('qtsGetJdResults'))) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(changes.some(({ area, keys }) => area === 'session' && keys.includes('qtsGetJdResults')), `Get JD saved a result: ${JSON.stringify(changes)}`);
    const local = changes.filter(({ area }) => area === 'local').flatMap(({ keys }) => keys);
    assert.deepEqual(local.filter((key) => key === 'qtsGetJdResults' || key.startsWith('qtsIdle')), [], `local writes: ${local.join(', ')}`);
  } finally {
    await browser.close();
    server.close();
  }
});
