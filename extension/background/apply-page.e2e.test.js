// End-to-end test of the REAL extension in Chrome: "Apply this page". With Apply on and nothing in
// the queue, the Manager opens a saved job's page; the launcher's lookup lists the accounts with
// that job (one ready, one already applied), and starting the ready one makes this very tab its
// application: the panel shows and QTS fills it. Against a local mock QTS server on 127.0.0.1;
// nothing leaves this machine. Run with: npm run test:apply-e2e (skipped when Chrome is not
// installed; QTS_CHROME sets it).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const CHROME = [
  process.env.QTS_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => candidate && fs.existsSync(candidate));

const PORT = 47126;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/jobs/7`;
const log = { lookedUp: [], started: [] };

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Data Engineer</title></head><body>
<h1>Data Engineer</h1><form onsubmit="event.preventDefault()">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <button type="submit">Submit application</button>
</form></body></html>`;

const JOB = '00000000-0000-4000-8000-00000000b107';
const APPLICATION = {
  attemptId: '00000000-0000-4000-8000-00000000a107',
  aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: JOB, url: PAGE, title: 'Data Engineer', company: 'Acme', location: 'Remote', workType: 'Full-time', salary: null,
    description: 'Spark.', resumeFolder: null, resumeSavedOn: null, promptName: null, templateName: null, resumeText: 'CV', coverLetterText: null,
  },
  candidate: { candidateId: '00000000-0000-4000-8000-00000000c107', firstName: 'Ola', lastName: 'Nowak', email: 'ola.test@example.com' },
  profileDetails: { experiences: [], educations: [] },
  savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: null,
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const data = JSON.parse(body || '{}');
    const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
    if (url.pathname === '/jobs/7') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); return res.end(FORM); }
    // Nothing in the queue: only the page the Manager chooses is applied to.
    if (url.pathname === '/api/extension/apply/claim') return json({ success: true, application: null });
    if (url.pathname === '/api/extension/apply/page') {
      log.lookedUp.push(data.url);
      return json({ success: true, applications: [
        { jobId: '00000000-0000-4000-8000-00000000b108', candidateName: 'Andrei Sava', title: 'Data Engineer', company: 'Acme', state: 'applied' },
        { jobId: JOB, candidateName: 'Ola Nowak', title: 'Data Engineer', company: 'Acme', state: 'ready' },
      ] });
    }
    if (url.pathname === '/api/extension/apply/start-job') { log.started.push(data.jobId); return json({ success: true, application: APPLICATION }); }
    return json({ success: true, leaseSeconds: 600 });
  });
});

const until = async (what, check, ms = 60000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await Promise.race([Promise.resolve().then(check).catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}.`);
};

test('"Apply this page": the accounts with this page\'s job are listed, and the chosen one is applied in this tab', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 180000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  try {
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
    const worker = await target.worker();
    const turnOn = (status) => worker.evaluate(async (base, value) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: false, qtsExtensionStatus: value, qtsBrowserName: 'E2E Chrome',
      });
    }, BASE, status);
    // The Manager opens the job's page themselves.
    const page = await browser.newPage();
    await page.goto(PAGE);
    const tabId = await until('the tab', () => worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, PAGE));
    // What the launcher sends, from the page's own tab.
    const ask = (message) => worker.evaluate(async (id, msg) => (await chrome.scripting.executeScript({
      target: { tabId: id }, func: (m) => chrome.runtime.sendMessage(m), args: [msg],
    }))[0]?.result, tabId, message);

    // Apply off: nothing is offered.
    await turnOn(null);
    assert.deepEqual(await ask({ type: 'QTS_APPLY_PAGE_ACCOUNTS' }), { ok: true, applyOn: false, applications: [] });

    // Apply on: the accounts with this page's job, looked up by the page's address.
    await turnOn('apply');
    const listed = await ask({ type: 'QTS_APPLY_PAGE_ACCOUNTS' });
    assert.equal(log.lookedUp.at(-1), PAGE);
    assert.deepEqual(listed.applications.map((entry) => [entry.candidateName, entry.state]), [['Andrei Sava', 'applied'], ['Ola Nowak', 'ready']]);

    // Ola Nowak chosen: this tab becomes her application and is filled.
    assert.deepEqual(await ask({ type: 'QTS_APPLY_PAGE_START', jobId: JOB }), { ok: true });
    assert.deepEqual(log.started, [JOB]);
    await until('the page filled', async () => (await page.evaluate(() => document.getElementById('em').value)) === 'ola.test@example.com');
    assert.equal(await page.evaluate(() => document.getElementById('fn').value), 'Ola');
    assert.equal((await worker.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url.startsWith('http://127.0.0.1')).length)), 1);
    // The same tab asked again says it is her application already.
    const again = await ask({ type: 'QTS_APPLY_PAGE_ACCOUNTS' });
    assert.equal(again.openHere, 'Ola Nowak');
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
});
