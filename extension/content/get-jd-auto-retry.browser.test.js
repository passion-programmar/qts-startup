// Real extension in real Chrome, with a local mock QTS server. No database or external AI calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '../..');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome']
  .find((file) => file && fs.existsSync(file));
const until = async (label, check) => {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${label}`);
};

const DESCRIPTION = Array.from({ length: 14 }, (_, index) => 'Responsibility ' + index + ': build Python services using FastAPI and PostgreSQL, with production engineering experience, for this full-time remote role.').join(' ');
const page = '<html><head><title>Software Engineer at Example</title></head><body><main><h1>Software Engineer</h1><span data-testid="company-name">Example</span><section data-testid="job-description"><p>' + DESCRIPTION + '</p></section></main></body></html>';

test('a busy AI provider never needs Try again: the job waits and retries by itself', { skip: !CHROME, timeout: 420000 }, async () => {
  const requests = [];
  const replies = new Map();
  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/api/')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(page);
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    requests.push({ path: req.url, body });
    let result = { success: true, managerId: 'test-manager', rules: [], exclusions: [], features: {} };
    if (req.url === '/api/extension/get-jd/check') result = { success: true, skip: false, precheckToken: 'fixture' };
    else if (req.url === '/api/extension/get-jd/mode') result = { success: true, mode: 'gemini' };
    else if (req.url === '/api/extension/get-jd') {
      const script = replies.get(new URL(body.pageUrl).pathname) || [];
      const scripted = script.shift();
      if (scripted) {
        res.statusCode = scripted.status;
        result = scripted.body;
      } else {
        result = {
          success: true,
          classification: { isJobPage: true, isRemote: true, matchingProfileIds: ['a'], job: { title: 'Software Engineer', company: 'Example', description: body.originalDescription, jobUrl: body.pageUrl } },
          profiles: [{ id: 'a', name: 'Test Candidate', state: 'has_job', autoSaved: true, available: false }],
          autoSavedProfileIds: ['a'],
          autoSavedJobs: [{ profileId: 'a', jobId: 'job' }],
          autoSaveFailureCount: 0,
          jobDescription: body.originalDescription,
        };
      }
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    const worker = await (await browser.waitForTarget((target) => target.type() === 'service_worker')).worker();
    await worker.evaluate(async (url) => chrome.storage.local.set({
      qtsServerUrl: url, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000,
      qtsSessionUser: { id: 'test-manager', role: 'manager', displayName: 'Test' }, qtsGetJdOn: false, qtsGetJdAutoClose: false,
    }), base);

    const control = await browser.newPage();
    await control.goto(`${base}/jobs/control`);
    const tabIdOf = (url) => worker.evaluate(async (target) => (await chrome.tabs.query({})).find((tab) => tab.url === target)?.id, url);
    const controlId = await tabIdOf(control.url());
    await until('launcher ready', () => control.evaluate(() => Boolean(document.querySelector('[data-qts-page-launcher]'))));
    const toggled = await worker.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: 'get_jd' }) }))[0].result, controlId);
    assert.equal(toggled.ok, true);

    const open = (pathname) => worker.evaluate(async (url) => chrome.tabs.create({ url, active: true }), base + pathname);
    const result = (id) => worker.evaluate(async (tabId) => (await chrome.storage.local.get('qtsGetJdResults')).qtsGetJdResults?.[tabId], id);
    const alarm = (id) => worker.evaluate(async (tabId) => (await chrome.alarms.get(`qtsGetJdRetry:${tabId}`)) || null, id);
    const asks = (pathname) => requests.filter((entry) => entry.path === '/api/extension/get-jd' && new URL(entry.body.pageUrl).pathname === pathname).length;
    const fireRetry = (id) => worker.evaluate(async (tabId) => { await chrome.tabs.update(tabId, { active: true }); await chrome.alarms.clear(`qtsGetJdRetry:${tabId}`); await runGetJdAutoRetry(tabId); }, id);
    const outcomeOffersTryAgain = (id) => worker.evaluate(async (tabId) => {
      const [{ result: text }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const collect = (node) => [...node.querySelectorAll('*')].map((element) => [element.shadowRoot ? collect(element.shadowRoot) : '', element.childElementCount ? '' : element.textContent].join(' ')).join(' ');
          return collect(document);
        },
      });
      return /Try again/i.test(text);
    }, id);

    // Busy twice, then it answers.
    const busy = { status: 503, body: { success: false, message: 'Gemini and Groq are busy right now. Try again shortly.', diagnosticCode: 'ai_busy', autoRetry: { kind: 'soon' } } };
    replies.set('/jobs/busy', [busy, busy]);
    const busyTab = await open('/jobs/busy');
    await until('first wait', async () => /retrying automatically/.test((await result(busyTab.id))?.message || ''));
    const firstRun = await result(busyTab.id);
    assert.equal(firstRun.status, 'processing', 'still shown as in progress');
    assert.equal(asks('/jobs/busy'), 1);
    const firstAlarm = await alarm(busyTab.id);
    assert.ok(firstAlarm, 'an alarm is set');
    assert.ok(Math.abs(firstAlarm.scheduledTime - Date.now() - 30000) < 8000, 'the first retry is about 30 seconds away');
    assert.equal(await outcomeOffersTryAgain(busyTab.id), false, 'no Try again button');

    await fireRetry(busyTab.id);
    await until('second ask', () => asks('/jobs/busy') === 2);
    await until('second wait', async () => Boolean(await alarm(busyTab.id)));
    const secondAlarm = await alarm(busyTab.id);
    assert.ok(Math.abs(secondAlarm.scheduledTime - Date.now() - 60000) < 8000, 'the second retry is about a minute away');

    await fireRetry(busyTab.id);
    await until('finished by itself', async () => (await result(busyTab.id))?.status === 'complete');
    assert.equal(asks('/jobs/busy'), 3);
    assert.equal((await result(busyTab.id)).runId, firstRun.runId, 'one job stays one history entry');
    assert.equal(await alarm(busyTab.id), null);

    // Quota used up: waits until just after the reset.
    const resetAt = Date.now() + 3600000;
    replies.set('/jobs/quota', [{ status: 429, body: { success: false, message: 'Used up.', diagnosticCode: 'ai_quota_used_up', autoRetry: { kind: 'at', at: resetAt } } }]);
    const quotaTab = await open('/jobs/quota');
    await until('quota wait', async () => /midnight Pacific/.test((await result(quotaTab.id))?.message || ''));
    const quotaAlarm = await alarm(quotaTab.id);
    assert.equal(Math.round(quotaAlarm.scheduledTime), resetAt + 60000);

    // A page too long gets the reason, with no retry and no button.
    replies.set('/jobs/toolong', [{ status: 413, body: { success: false, message: 'This job page is too long for the AI models. Nothing was saved.', diagnosticCode: 'ai_too_large' } }]);
    const longTab = await open('/jobs/toolong');
    await until('reason shown', async () => (await result(longTab.id))?.status === 'error');
    assert.match((await result(longTab.id)).message, /too long/);
    assert.equal(await alarm(longTab.id), null);
    assert.equal(asks('/jobs/toolong'), 1);
    assert.equal(await outcomeOffersTryAgain(longTab.id), false, 'no Try again button');

    // Closing the tab ends the wait.
    replies.set('/jobs/closed', [busy]);
    const closedTab = await open('/jobs/closed');
    await until('wait before close', async () => Boolean(await alarm(closedTab.id)));
    await worker.evaluate(async (id) => chrome.tabs.remove(id), closedTab.id);
    await until('alarm cleared with the tab', async () => (await alarm(closedTab.id)) === null);

    // Turning Get JD off ends the wait too.
    replies.set('/jobs/off', [busy]);
    const offTab = await open('/jobs/off');
    await until('wait before off', async () => Boolean(await alarm(offTab.id)));
    const asked = asks('/jobs/off');
    await worker.evaluate(async () => chrome.storage.local.set({ qtsGetJdOn: false }));
    await fireRetry(offTab.id);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(asks('/jobs/off'), asked, 'no retry while Get JD is off');
  } catch (error) {
    console.error('Local request trace:', JSON.stringify(requests.map((entry) => ({ path: entry.path, url: entry.body?.pageUrl || entry.body?.job?.jobUrl }))));
    throw error;
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
