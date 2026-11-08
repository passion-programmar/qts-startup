// End-to-end test of the REAL extension in Chrome (Normal Apply): an application that moves through
// new tabs. Apply opens an intro page in a new tab and its Start application opens the form in
// another: QTS follows both, closes the earlier tabs (one tab per job) and fills the form. A privacy
// policy the Manager opens from the form is a side tab: it stays outside the application and the
// form tab is still filled. With the Manager's limit of one open job, the next job opens only after
// Submitted, however many tabs the first one went through.
// Nothing leaves this machine. Run with: npm run test:apply-e2e (skipped when Chrome is not
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

let BASE = '';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const log = { claims: [], results: [], reviews: 0 };

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const JOB = (number) => page(`Data Engineer ${number}`, `<main><h1>Data Engineer ${number}</h1><p>About the job: Spark, Airflow.</p>
<a href="/intro/${number}" target="_blank">Apply now</a></main>`);
// No questions: only the way on, in yet another new tab.
const INTRO = (number) => page('Before you apply', `<main><h1>Before you apply</h1><p>Have your CV ready. The form takes five minutes.</p>
<a href="/form/${number}" target="_blank">Start application</a></main>`);
const FORM = page('Application', `
<form id="app" onsubmit="event.preventDefault()">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div id="later"></div>
  <p>Read our <a id="policy" href="/privacy" target="_blank">privacy policy</a>.</p>
  <button type="submit">Submit application</button>
</form>`);
const PRIVACY = page('Privacy policy', '<main><h1>Privacy policy</h1><p>We keep your data for twelve months.</p></main>');

const job = (number, candidate) => ({
  attemptId: `00000000-0000-4000-8000-00000000d00${number}`,
  aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: `00000000-0000-4000-8000-00000000e00${number}`, url: `${BASE}/job/${number}`, title: `Data Engineer ${number}`, company: 'Acme',
    location: 'Remote', workType: 'Full-time · Remote', salary: null, description: 'We need Spark and Airflow.',
    resumeFolder: 'QTS\\Candidate\\Acme', resumeSavedOn: 'Test Chrome', promptName: null, templateName: null,
    resumeText: 'Data Engineer.', coverLetterText: 'Dear Hiring Manager,',
  },
  candidate,
  profileDetails: { experiences: [], educations: [] },
  savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: null,
});
const RADU = { candidateId: '00000000-0000-4000-8000-00000000f001', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com', phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania' };
const OLA = { candidateId: '00000000-0000-4000-8000-00000000f002', firstName: 'Ola', lastName: 'Nowak', email: 'ola.test@example.com', phone: '+48600111222', city: 'Krakow', country: 'Poland' };
let jobs = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const data = JSON.parse(body || '{}');
    const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
    const html = (text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); res.end(text); };
    const number = url.pathname.split('/')[2];
    if (url.pathname.startsWith('/job/')) return html(JOB(number));
    if (url.pathname.startsWith('/intro/')) return html(INTRO(number));
    if (url.pathname.startsWith('/form/')) return html(FORM);
    if (url.pathname === '/privacy') return html(PRIVACY);
    // The Manager's "Maximum open applications": one.
    if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { autoApplyParallelLimit: 1 } });
    if (url.pathname === '/api/extension/apply/claim') {
      log.claims.push(Date.now());
      return json({ success: true, application: jobs[log.claims.length - 1] || null });
    }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
    if (url.pathname === '/api/extension/apply/review') { log.reviews += 1; return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/documents') {
      return json({ success: true, documents: { resumePath: 'QTS_Resume/M/C/R/CV.pdf', coverLetterPath: 'QTS_Resume/M/C/R/Cover.pdf' } });
    }
    if (url.pathname === '/api/extension/apply/result') { log.results.push(data); return json({ success: true, result: 'confirmed' }); }
    return json({ success: true });
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Normal Apply follows new tabs to the form, keeps one tab per job, ignores side tabs, and keeps the open-job limit', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 300000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jobs = [job(1, RADU), job(2, OLA)];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  try {
    const workerEval = async (func, ...args) => {
      const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
      const worker = await target.worker();
      return worker.evaluate(func, ...args);
    };
    await workerEval(async (base) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: false, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
      });
    }, BASE);
    await workerEval((documentPdf) => {
      Object.defineProperty(self, '__qtsScannerDocumentStore', {
        configurable: true, value: { getSetting: async (key) => ({ value: key === 'applyPdfDownloadsDirectoryV1' ? {} : null }) },
      });
      Object.defineProperty(self, '__qtsApplyLocalPdfs', {
        configurable: true,
        value: {
          SETTING_KEY: 'applyPdfDownloadsDirectoryV1',
          readApplyDocuments: async () => ({
            resume: { filename: 'CV.pdf', base64: documentPdf, mimeType: 'application/pdf' },
            coverLetter: { filename: 'Cover.pdf', base64: documentPdf, mimeType: 'application/pdf' },
          }),
        },
      });
    }, pdf);
    await workerEval(() => { self.__qtsApplyRunner.processApplyQueue(); });
    const paths = async () => (await workerEval(async () => (await chrome.tabs.query({})).map((tab) => tab.url || tab.pendingUrl || '')))
      .filter((url) => url.startsWith(BASE)).map((url) => new URL(url).pathname).sort();
    const pageFor = async (part) => (await browser.pages()).find((entry) => entry.url().includes(part));
    const execute = async (part, func, args = []) => {
      const target = await pageFor(part);
      return target ? (await target.evaluate(func, ...args) ?? null) : null;
    };
    const hasPanel = (part) => execute(part, () => Boolean(document.querySelector('[data-qts-apply-assist]')));
    const read = (part) => execute(part, () => ({ fn: document.querySelector('#fn')?.value, em: document.querySelector('#em')?.value, city: document.querySelector('#city')?.value ?? null }));

    // 1. Job page → intro (new tab) → form (another new tab): only the form tab is left, filled.
    try {
      await until('the form filled after two new tabs', async () => {
        const values = await read('/form/1');
        return values?.fn === 'Radu' && values.em === 'radu.test@example.com';
      }, 90000);
      await until('the earlier tabs of the job closed', async () => JSON.stringify(await paths()) === JSON.stringify(['/form/1']), 30000);
    } catch (error) {
      console.error('Tabs:', JSON.stringify(await paths()), 'claims:', log.claims.length);
      throw error;
    }
    assert.ok(await hasPanel('/form/1'), 'the panel moved with the application');
    assert.equal(log.claims.length, 1, 'the job stays the one open job while it moves between tabs');

    // 2. The Manager opens the privacy policy: a side tab, outside the application.
    await execute('/form/1', () => document.querySelector('#policy').click());
    await until('the privacy policy tab', async () => (await paths()).includes('/privacy'));
    await pause(20000);
    assert.deepEqual(await paths(), ['/form/1', '/privacy'], 'neither tab is closed');
    assert.equal(await hasPanel('/privacy'), false, 'no QTS panel on the side tab');
    assert.ok(await hasPanel('/form/1'));
    // The form tab is still the application's: a question shown later is filled there.
    await execute('/form/1', () => { document.querySelector('#later').innerHTML = '<label for="city">City *</label><input id="city" required>'; });
    await until('the new question filled on the form tab', async () => (await read('/form/1'))?.city === 'Cluj-Napoca', 45000);
    assert.equal(log.claims.length, 1, 'still one open job');

    // 3. Submitted ends the job (its tab closes); only then is the next job opened.
    const formTab = await workerEval(async (base) => (await chrome.tabs.query({})).find((tab) => (tab.url || '').startsWith(`${base}/form/1`))?.id, BASE);
    await workerEval((tabId, attemptId) => chrome.scripting.executeScript({
      target: { tabId }, func: (id) => chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', assist: true, attemptId: id, action: 'submitted', answers: [] }), args: [attemptId],
    }), formTab, jobs[0].attemptId);
    await until('the first bid saved', () => log.results.length === 1);
    await until('the second job filled through its own tabs', async () => {
      const values = await read('/form/2');
      return values?.fn === 'Ola' && values.em === 'ola.test@example.com';
    }, 90000);
    assert.equal(log.claims.length >= 2, true);
    await until('one tab for the second job', async () => !(await paths()).some((entry) => /^\/(job|intro)\/2$/.test(entry)), 30000);
    assert.ok((await paths()).includes('/privacy'), 'the side tab was never touched');
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
});
