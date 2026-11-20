// End-to-end test of the REAL extension in Chrome (Normal Apply): the Manager's "Maximum open
// applications" decides how many jobs are open at once, with checked jobs and without. With a limit
// of 3 and five ready jobs, three job pages open at the same time, the fourth only after one of them
// ends (Submitted), and never more than three.
// Nothing leaves this machine. Run with: node --test extension/background/apply-limit.e2e.test.js
// (skipped when Chrome is not installed; QTS_CHROME sets it).
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

const LIMIT = 3;
const JOBS = 5;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const FORM = (number) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Job ${number}</title></head><body>
<h1>Data Engineer ${number}</h1>
<form onsubmit="event.preventDefault()">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <button type="submit">Submit application</button>
</form></body></html>`;
const CANDIDATE = { candidateId: '00000000-0000-4000-8000-00000000f001', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com', phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania' };
const jobId = (number) => `00000000-0000-4000-8000-00000000e00${number}`;
const attemptId = (number) => `00000000-0000-4000-8000-00000000d00${number}`;

async function runWithLimit(selection) {
  const puppeteer = require('puppeteer-core');
  const log = { claims: [], bodies: [], open: new Set(), maxOpen: 0, results: [] };
  let BASE = '';
  const application = (number) => ({
    attemptId: attemptId(number), aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
    job: {
      id: jobId(number), url: `${BASE}/job/${number}`, title: `Data Engineer ${number}`, company: `Acme ${number}`,
      location: 'Remote', workType: 'Full-time · Remote', salary: null, description: 'Spark and Airflow.',
      resumeFolder: 'QTS\\Candidate\\Acme', resumeSavedOn: 'Test Chrome', promptName: null, templateName: null,
      resumeText: 'Data Engineer.', coverLetterText: 'Dear Hiring Manager,',
    },
    candidate: CANDIDATE, profileDetails: { experiences: [], educations: [] },
    savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: null,
  });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, BASE);
      const data = JSON.parse(body || '{}');
      const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
      if (url.pathname.startsWith('/job/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        return res.end(FORM(url.pathname.split('/')[2]));
      }
      if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { autoApplyParallelLimit: LIMIT } });
      if (url.pathname === '/api/extension/apply/claim') {
        log.bodies.push(data);
        // As the server does: no more than the limit open for this Chrome.
        if (log.open.size >= LIMIT || log.claims.length >= JOBS) return json({ success: true, application: null });
        const number = log.claims.length + 1;
        log.claims.push(Date.now());
        log.open.add(attemptId(number));
        log.maxOpen = Math.max(log.maxOpen, log.open.size);
        return json({ success: true, application: application(number) });
      }
      if (url.pathname === '/api/extension/apply/result' || url.pathname === '/api/extension/apply/release') {
        log.results.push(data);
        log.open.delete(data.attemptId);
        return json({ success: true, result: 'confirmed' });
      }
      if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
      if (url.pathname === '/api/extension/apply/documents') {
        return json({ success: true, documents: { resumePath: 'QTS_Resume/M/C/R/CV.pdf', coverLetterPath: 'QTS_Resume/M/C/R/Cover.pdf' } });
      }
      return json({ success: true });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  const until = async (what, check, ms = 60000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const value = await Promise.race([Promise.resolve().then(check).catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${what} (claims ${log.claims.length}, open ${log.open.size}).`);
  };
  try {
    const workerEval = async (func, ...args) => {
      const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
      return (await target.worker()).evaluate(func, ...args);
    };
    await workerEval(async (base, chosen) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: false, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
        qtsWorkSelection: chosen,
      });
    }, BASE, selection);
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
    const jobTabs = async () => (await workerEval(async (base) => (await chrome.tabs.query({}))
      .map((tab) => tab.url || tab.pendingUrl || '').filter((url) => url.startsWith(`${base}/job/`)), BASE)).sort();
    const filled = async (number) => {
      const page = (await browser.pages()).find((entry) => entry.url().endsWith(`/job/${number}`));
      return page ? page.evaluate(() => document.querySelector('#fn')?.value === 'Radu') : false;
    };

    // 1. Three jobs open at the same time, each filled; the fourth is not opened.
    const started = Date.now();
    await until(`${LIMIT} job pages open`, async () => (await jobTabs()).length === LIMIT, 60000);
    const openedIn = Date.now() - started;
    for (let number = 1; number <= LIMIT; number += 1) await until(`job ${number} filled`, () => filled(number), 60000);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    assert.equal((await jobTabs()).length, LIMIT, 'never more than the limit open');
    assert.equal(log.claims.length, LIMIT, 'the fourth job is not claimed while three are open');

    // 2. Submitted on one: the fourth opens; the limit is still kept.
    const firstTab = await workerEval(async (base) => (await chrome.tabs.query({})).find((tab) => (tab.url || '').endsWith('/job/1'))?.id, BASE);
    await workerEval((tabId, id) => chrome.scripting.executeScript({
      target: { tabId }, func: (attempt) => chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', assist: true, attemptId: attempt, action: 'submitted', answers: [] }), args: [id],
    }), firstTab, attemptId(1));
    await until('the fourth job opened after Submitted', async () => (await jobTabs()).includes(`${BASE}/job/4`), 90000);
    assert.equal((await jobTabs()).length, LIMIT);
    assert.equal(log.maxOpen, LIMIT);
    return { openedIn, bodies: log.bodies };
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
}

const options = { skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).', timeout: 300000 };

test('Normal Apply opens the Manager\'s limit of jobs at once (every account)', options, async () => {
  const { openedIn, bodies } = await runWithLimit(null);
  assert.ok(bodies.every((body) => !body.selection), 'no selection sent');
  console.log(`every account: ${LIMIT} jobs open in ${openedIn} ms`);
});

test('Normal Apply opens the Manager\'s limit of jobs at once (checked jobs)', options, async () => {
  const selection = { mode: 'apply', candidateId: CANDIDATE.candidateId, jobIds: [1, 2, 3, 4, 5].map(jobId) };
  const { openedIn, bodies } = await runWithLimit(selection);
  assert.ok(bodies.every((body) => body.selection?.jobIds?.length === JOBS), 'the checked jobs go with every claim');
  console.log(`checked jobs: ${LIMIT} jobs open in ${openedIn} ms`);
});
