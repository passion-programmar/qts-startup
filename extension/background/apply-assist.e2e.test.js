// End-to-end test of the REAL extension in Chrome as the Manager's assistant: its service worker, the
// Apply queue, the form engine, and the panel, against a local mock QTS server on 127.0.0.1. Two job
// pages open at once (the first in front), QTS fills only the résumé, the cover letter, profile facts,
// and reusable answers, never what the Manager typed, and the Manager ends each page: the site's
// Submit then Yes, Cancel, or Submitted. Nothing leaves this machine. Run with: npm run test:apply-e2e
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

const PORT = 47124;
const BASE = `http://127.0.0.1:${PORT}`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const log = { claims: [], submitted: [], results: [], released: [], reviews: 0 };

const JOB_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Data Engineer at Acme</title></head><body>
<main><h1>Data Engineer</h1><p>About the job: Spark, Airflow.</p><a href="/form/1" class="button">Apply now</a></main></body></html>`;

const form = (number) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Apply ${number}</title></head><body>
<form id="app" onsubmit="event.preventDefault(); window.submitted = true;">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
  <div><label for="co">Country *</label><select id="co" required><option value="">Select…</option><option>Poland</option><option>Romania</option></select></div>
  <div><label for="np">Notice period *</label><input id="np" required></div>
  <div><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option>LinkedIn</option><option>Friend</option></select></div>
  <div><label for="why">Why do you want to join Acme? *</label><textarea id="why" required></textarea></div>
  <div><label for="cl">Cover letter</label><textarea id="cl"></textarea></div>
  <div><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required></div>
  <div><label><input type="checkbox" id="ok" required> I agree to the privacy policy *</label></div>
  <button type="submit">Submit application</button>
</form></body></html>`;

const job = (number, url) => ({
  attemptId: `00000000-0000-4000-8000-00000000a00${number}`,
  aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: `00000000-0000-4000-8000-00000000b00${number}`, url, title: `Data Engineer ${number}`, company: 'Acme',
    location: 'Remote', workType: 'Full-time · Remote', salary: null, description: 'We need Spark and Airflow.',
    resumeFolder: 'QTS\\Radu Star\\Acme', resumeSavedOn: 'Test Chrome', promptName: null, templateName: null,
    resumeText: 'Radu Star — Data Engineer. 7 years of Spark.', coverLetterText: 'Dear Hiring Manager,\nI would like to join Acme.\nRadu Star',
  },
  candidate: {
    candidateId: '00000000-0000-4000-8000-00000000c001', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com',
    phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania', yearsOfExperience: 7,
  },
  profileDetails: {
    experiences: [{ jobTitle: 'Data Engineer', companyName: 'Initech', location: 'Cluj', workMode: 'remote', startDate: '2019-01-01', endDate: null, isCurrent: true, description: 'Spark pipelines.' }],
    educations: [{ institution: 'UBB', degree: 'BSc', fieldOfStudy: 'Computer Science', startDate: '2012-10-01', endDate: '2015-07-01', isCurrent: false, description: null }],
  },
  savedAnswers: [{ questionKey: 'notice period', questionText: 'Notice period', answer: 'Immediately', note: null, scope: 'everyone' }],
  exchangeRates: null, rememberedChoices: [], answerPrompt: null,
});
const jobs = [job(1, `${BASE}/job/1`), job(2, `${BASE}/form/2`), job(3, `${BASE}/form/3`), job(4, `${BASE}/form/4`)];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const data = JSON.parse(body || '{}');
    const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
    const html = (page) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); res.end(page); };
    if (url.pathname === '/job/1') return html(JOB_PAGE);
    if (url.pathname.startsWith('/form/')) return html(form(url.pathname.slice(6)));
    if (url.pathname === '/api/extension/apply/claim') {
      log.claims.push(data.skipJobIds || []);
      return json({ success: true, application: jobs[log.claims.length - 1] || null });
    }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
    if (url.pathname === '/api/extension/apply/review') { log.reviews += 1; return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/documents') {
      return json({ success: true, documents: { folder: 'C:\\test-folder', resume: { filename: 'Radu_Star_CV.pdf', base64: pdf }, coverLetter: { filename: 'Radu_Star_Cover.pdf', base64: pdf } } });
    }
    if (url.pathname === '/api/extension/apply/submitted') { log.submitted.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/result') { log.results.push(data); return json({ success: true, result: 'confirmed' }); }
    if (url.pathname === '/api/extension/apply/release') { log.released.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/answers') { log.aiAsked = true; return json({ success: false, message: 'No AI in assist mode.' }); }
    return json({ success: true });
  });
});

const until = async (what, check, ms = 60000) => {
  if (process.env.QTS_E2E_TRACE) console.log(new Date().toISOString().slice(11, 19), 'waiting for', what);
  const deadline = Date.now() + ms;
  let hung = 0;
  while (Date.now() < deadline) {
    // A check that hangs (a tab between pages) counts as not yet.
    const value = await Promise.race([Promise.resolve().then(check).catch(() => null), new Promise((resolve) => setTimeout(() => resolve('hung'), 5000))]);
    if (value === 'hung') hung += 1;
    else if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}${hung ? ` (the check hung ${hung} times)` : ''}.`);
};

test('the assistant keeps two job pages open, fills only what it knows, and ends each page as the Manager says', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 300000,
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
    await worker.evaluate(async (base) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: false, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
      });
    }, BASE);
    await worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => ({ id: tab.id, url: tab.url, active: tab.active })));
    const tabFor = async (part) => (await tabs()).find((tab) => tab.url.includes(part));
    const pageFor = async (part) => (await browser.pages()).find((page) => page.url().includes(part));
    const panelSays = (part, message) => tabFor(part).then((tab) => worker.evaluate((tabId, msg) => chrome.scripting.executeScript({
      target: { tabId }, func: (m) => chrome.runtime.sendMessage(m), args: [msg],
    }), tab.id, message));
    // A page's answers, read through the extension (a page handle can hang while its tab navigates).
    const values = async (part) => {
      const tab = await tabFor(part);
      if (!tab) return null;
      const [frame] = await worker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const value = (id) => document.getElementById(id)?.value ?? null;
        if (!document.getElementById('fn')) return null;
        return {
          fn: value('fn'), ln: value('ln'), em: value('em'), ph: value('ph'), co: value('co'), np: value('np'),
          hear: value('hear'), why: value('why'), cl: value('cl'), cv: document.getElementById('cv').files.length, ok: document.getElementById('ok').checked,
        };
      } }).catch(() => [{ result: null }]), tab.id);
      return frame?.result || null;
    };

    // Two pages open, only the first in front; the third waits.
    await until('two job pages', async () => (await tabs()).filter((tab) => tab.url.startsWith(BASE)).length === 2);
    const open = (await tabs()).filter((tab) => tab.url.startsWith(BASE));
    assert.deepEqual(open.map((tab) => [new URL(tab.url).pathname, tab.active]), [['/job/1', true], ['/form/2', false]]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(log.claims.length, 2);
    assert.equal(log.reviews, 2);

    // A page behind the Manager's is filled with what QTS knows, and only that.
    const second = await pageFor('/form/2');
    await until('the second page filled', async () => (await values('/form/2'))?.cv === 1 && (await values('/form/2'))?.np);
    const filled = await values('/form/2');
    assert.deepEqual(filled, {
      fn: 'Radu', ln: 'Star', em: 'radu.test@example.com', ph: '+40264484948', co: 'Romania', np: 'Immediately',
      hear: '', why: '', cl: 'Dear Hiring Manager,\nI would like to join Acme.\nRadu Star', cv: 1, ok: false,
    });
    assert.equal(log.aiAsked, undefined);

    // The job page has nothing to fill; its Apply button opens the form, which is not a Submit.
    const first = await pageFor('/job/1');
    await first.click('a.button');
    await until('the first form filled', async () => {
      const page = await values('/form/1');
      return page?.fn === 'Radu' && page.cv === 1;
    });
    assert.equal(log.submitted.length, 0);

    // What the Manager types stays: QTS never fills a question twice (typed in the tab brought to the front).
    await second.bringToFront();
    await second.evaluate(() => { document.getElementById('fn').value = ''; });
    await second.type('#fn', 'Rado');
    await second.select('#hear', 'Friend');
    await second.type('#why', 'I like Spark.');
    await second.click('#ok');
    await new Promise((resolve) => setTimeout(resolve, 6000));
    assert.equal((await values('/form/2')).fn, 'Rado');

    // The site's own Submit asks Yes / No; Yes saves the bid and deletes the job row.
    const shot = process.env.QTS_E2E_SHOTS;
    if (shot) await second.screenshot({ path: path.join(shot, 'assist-panel.png') });
    await second.click('button[type=submit]');
    await until('the Submit noticed', () => log.submitted.length === 1);
    assert.equal(log.submitted[0].attemptId, jobs[1].attemptId);
    assert.ok(log.submitted[0].appliedAnswers.some((answer) => /First name/.test(answer.question) && answer.answer === 'Rado'));
    assert.equal(log.results.length, 0);
    if (shot) await second.screenshot({ path: path.join(shot, 'assist-confirm.png') });
    await panelSays('/form/2', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[1].attemptId, action: 'yes' });
    await until('the bid saved', () => log.results.length === 1);
    assert.deepEqual([log.results[0].attemptId, log.results[0].submitted, log.results[0].removeJob], [jobs[1].attemptId, true, true]);
    await until('the second page closed', async () => !(await tabFor('/form/2')));

    // A free place opens the third job, behind the Manager's page.
    await until('the third page', async () => Boolean(await tabFor('/form/3')));
    assert.equal((await tabFor('/form/3')).active, false);

    // Cancel: the page closes, the job stays in the list, and is not opened again here; the fourth opens.
    await panelSays('/form/3', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[2].attemptId, jobId: jobs[2].job.id, action: 'cancel' });
    await until('the cancel recorded', () => log.released.length === 1);
    assert.deepEqual([log.released[0].attemptId, log.released[0].mode], [jobs[2].attemptId, 'later']);
    await until('the third page closed', async () => !(await tabFor('/form/3')));
    await until('the fourth page', async () => Boolean(await tabFor('/form/4')));
    assert.deepEqual(log.claims[3], [jobs[2].job.id]);

    // Submitted at the bottom of the panel: the bid at once, without Yes / No.
    await panelSays('/form/1', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[0].attemptId, action: 'submitted', answers: [] });
    await until('the first bid', () => log.results.length === 2);
    assert.deepEqual([log.submitted[1].attemptId, log.results[1].attemptId, log.results[1].removeJob], [jobs[0].attemptId, jobs[0].attemptId, true]);
    await until('the first page closed', async () => !(await tabFor('/form/1')));

    // Only one job is left: one page stays open, and no other opens.
    await until('the empty list asked', () => log.claims.length >= 5);
    assert.deepEqual((await tabs()).filter((tab) => tab.url.startsWith(BASE)).map((tab) => new URL(tab.url).pathname), ['/form/4']);

    // Apply turned off: the last page gives its job back and closes.
    await worker.evaluate(() => chrome.storage.local.set({ qtsExtensionStatus: null }));
    await until('the last release', () => log.released.length === 2);
    assert.deepEqual([log.released[1].attemptId, log.released[1].mode], [jobs[3].attemptId, 'later']);
    await until('the last page closed', async () => !(await tabFor('/form/4')));
  } finally {
    await browser.close();
    server.close();
  }
});
