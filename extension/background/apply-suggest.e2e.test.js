// End-to-end test of Normal Apply's search and suggestion boxes in the REAL extension in Chrome,
// against a local mock QTS server and a local practice form whose boxes search only on a real key
// press. Nothing leaves this machine. Run with: npm run test:apply-e2e (skipped without Chrome).
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
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

// Each box searches only on a real key press (keyup) and counts letter keys and simulated key events.
const box = (id, label) => `<div><label for="${id}">${label} *</label><input id="${id}" role="combobox" aria-autocomplete="list" aria-controls="${id}-list" autocomplete="off" required><ul id="${id}-list" role="listbox"></ul></div>`;
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Apply</title></head><body>
<form id="app" onsubmit="event.preventDefault()">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  ${box('city', 'City')}${box('country', 'Country')}${box('nationality', 'Nationality')}
  <button type="submit">Submit application</button>
</form>
<script>
  window.typing = { untrusted: 0, letters: {} };
  const lists = { city: ['Cluj-Napoca, Romania', 'Cluj, Iowa, USA'], country: ['Romania', 'Russia'], nationality: ['French', 'German'] };
  for (const id of Object.keys(lists)) {
    const input = document.getElementById(id), list = document.getElementById(id + '-list');
    input.addEventListener('keydown', (event) => {
      if (!event.isTrusted) { if (event.key.length === 1) typing.untrusted += 1; return; }
      if (event.key.length === 1 && !event.ctrlKey) typing.letters[id] = (typing.letters[id] || 0) + 1;
    });
    input.addEventListener('keyup', (event) => {
      if (!event.isTrusted) return;
      const query = input.value.trim().toLowerCase();
      list.innerHTML = '';
      if (!query) return;
      for (const text of lists[id].filter((entry) => entry.toLowerCase().includes(query))) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.textContent = text;
        item.addEventListener('mousedown', (down) => down.preventDefault());
        item.addEventListener('click', () => { input.value = text; list.innerHTML = ''; input.dispatchEvent(new Event('change', { bubbles: true })); });
        list.append(item);
      }
    });
  }
</script></body></html>`;

const CANDIDATE = {
  candidateId: '00000000-0000-4000-8000-00000000c001', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com',
  phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania', nationality: 'Romanian', yearsOfExperience: 7,
};
let BASE = '';
const application = () => ({
  attemptId: '00000000-0000-4000-8000-00000000a001',
  aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: '00000000-0000-4000-8000-00000000b001', url: `${BASE}/form`, title: 'Data Engineer', company: 'Acme',
    location: 'Remote', workType: 'Remote', salary: null, description: 'Spark.', resumeFolder: 'QTS\\Candidate\\Acme', resumeSavedOn: 'Test Chrome',
    promptName: null, templateName: null, resumeText: 'Data Engineer.', coverLetterText: 'Dear Hiring Manager,\nHello.',
  },
  candidate: CANDIDATE,
  profileDetails: { experiences: [], educations: [] },
  savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: 'S1te-Acc0unt!',
});
let claims = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
    if (url.pathname === '/form') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(FORM); return; }
    if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { autoApplyParallelLimit: 1 } });
    if (url.pathname === '/api/extension/apply/claim') { claims += 1; return json({ success: true, application: claims === 1 ? application() : null }); }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
    if (url.pathname === '/api/extension/apply/documents') return json({ success: true, documents: { resumePath: 'QTS_Resume/M/C/R/CV.pdf', coverLetterPath: 'QTS_Resume/M/C/R/Cover.pdf' } });
    if (url.pathname === '/api/extension/apply/answers') return json({ success: false, message: 'No AI in Normal Apply.' });
    return json({ success: true });
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, check, ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await Promise.race([Promise.resolve().then(check).catch(() => null), sleep(5000).then(() => null)]);
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

test('Normal Apply fills suggestion boxes with real input, never letter by letter; one with no suggestion is left for the Manager', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 180000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  try {
    const workerEval = async (func, ...args) => {
      const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
      return (await target.worker()).evaluate(func, ...args);
    };
    await workerEval(async (base) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: false, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
      });
    }, BASE);
    await workerEval((documentPdf) => {
      Object.defineProperty(self, '__qtsScannerDocumentStore', { configurable: true, value: { getSetting: async (key) => ({ value: key === 'applyPdfDownloadsDirectoryV1' ? {} : null }) } });
      Object.defineProperty(self, '__qtsApplyLocalPdfs', { configurable: true, value: {
        SETTING_KEY: 'applyPdfDownloadsDirectoryV1',
        readApplyDocuments: async () => ({ resume: { filename: 'CV.pdf', base64: documentPdf, mimeType: 'application/pdf' }, coverLetter: { filename: 'Cover.pdf', base64: documentPdf, mimeType: 'application/pdf' } }),
      } });
    }, pdf);
    await workerEval(() => { self.__qtsApplyRunner.processApplyQueue(); });
    const form = await until('the form', async () => (await browser.pages()).find((page) => page.url() === `${BASE}/form`));
    await until('the city box filled', () => form.evaluate(() => document.getElementById('city').value === 'Cluj-Napoca, Romania'));
    await until('the country box filled', () => form.evaluate(() => document.getElementById('country').value === 'Romania'));
    // Nationality has no suggestion for the candidate's answer: it stays empty and the panel says so.
    const panel = await until('the panel to say "pick it yourself"', async () => {
      const text = await workerEval(() => JSON.stringify([...activeReviews.values()].map((review) => review.panel)));
      return /pick it yourself/i.test(text) ? text : null;
    }, 60000);
    assert.match(panel, /pick it yourself/i);
    const seen = await form.evaluate(() => ({ nationality: document.getElementById('nationality').value, typing: window.typing }));
    assert.equal(seen.nationality, '');
    assert.equal(seen.typing.untrusted, 0, 'no simulated letter keys');
    assert.equal(seen.typing.letters.city, 1, 'one real letter key: the last one, after Backspace');
    assert.equal(seen.typing.letters.country, 1);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
