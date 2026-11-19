// End-to-end test of the REAL extension in Chrome (Normal Apply): a phone asked as two questions, a
// country code and a number. The code gets the number's own code (+40) and the number box gets only
// the digits after it (264484948), however the site draws the code: a list with names and codes, a
// list of bare codes, a box to type it in, a search box, one "Phone" label over both. A list naming
// only countries gets the candidate's country; with no code shown, the number stays whole.
// Nothing leaves this machine. Run with: node --test extension/background/apply-phone-code.e2e.test.js
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

// Each layout: its form part, and what the code (#cc) and the number (#ph) must hold.
const LAYOUTS = {
  namedCodeList: [`<div><label for="cc">Country code *</label><select id="cc" required><option value="">Select</option><option value="+1">United States (+1)</option><option value="+49">Germany (+49)</option><option value="+40">Romania (+40)</option></select></div>
    <div><label for="ph">Phone number *</label><input id="ph" type="tel" required></div>`, '+40', '264484948'],
  bareCodeList: [`<div><label for="cc">Code</label><select id="cc"><option value="">--</option><option>+1</option><option>+49</option><option>+40</option></select></div>
    <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>`, '+40', '264484948'],
  codeListOnAnotherCode: [`<div><label for="cc">Phone country code</label><select id="cc"><option value="1" selected>+1 (USA)</option><option value="40">+40 (Romania)</option><option value="49">+49 (Germany)</option></select></div>
    <div><label for="ph">Mobile number *</label><input id="ph" required></div>`, '40', '264484948'],
  typedCodeBox: [`<div><label for="cc">Country code *</label><input id="cc" required></div>
    <div><label for="ph">Phone number *</label><input id="ph" type="tel" required></div>`, '+40', '264484948'],
  dialingCodeBox: [`<div><label for="cc">Dialing code</label><input id="cc" placeholder="+1"></div>
    <div><label for="ph">Telephone number *</label><input id="ph" type="tel" required></div>`, '+40', '264484948'],
  searchCodeBox: [`<div><label for="cc">Country Phone Code *</label><input id="cc" role="combobox" list="codes" required><datalist id="codes"><option value="United States (+1)"><option value="Romania (+40)"><option value="Germany (+49)"></datalist></div>
    <div><label for="ph">Phone Number *</label><input id="ph" type="tel" required></div>`, 'Romania (+40)', '264484948'],
  oneLabelForBoth: [`<fieldset><legend>Phone *</legend><select id="cc" aria-label="Country"><option value="">Code</option><option value="1">US +1</option><option value="49">DE +49</option><option value="40">RO +40</option></select><input id="ph" type="tel" aria-label="Number" required></fieldset>`, '40', '264484948'],
  countryNamesOnly: [`<div><label for="cc">Phone country code *</label><select id="cc" required><option value="">Select</option><option value="US">United States</option><option value="DE">Germany</option><option value="RO">Romania</option></select></div>
    <div><label for="ph">Phone number *</label><input id="ph" type="tel" required></div>`, 'RO', '+40264484948'],
  // No separate code at all: the whole number, as before.
  phoneOnly: ['<div><label for="ph">Phone number *</label><input id="ph" type="tel" required></div><input id="cc" type="hidden">', '', '+40264484948'],
};
// The search box (slowest to fill) runs on its own: with many tabs filling at once it can miss its
// suggestion (as before this change), which is not what this test is about.
const TOGETHER = Object.keys(LAYOUTS).filter((name) => name !== "searchCodeBox");
const CANDIDATE = { candidateId: '00000000-0000-4000-8000-00000000f001', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com', phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania' };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const uuid = (prefix, number) => `00000000-0000-4000-8000-${prefix}${String(number).padStart(9, '0')}`;
const page = (name) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title></head><body>
<h1>Data Engineer</h1><form onsubmit="event.preventDefault()">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  ${LAYOUTS[name][0]}
  <button type="submit">Submit application</button>
</form></body></html>`;

async function fillLayouts(NAMES) {
  const puppeteer = require('puppeteer-core');
  let BASE = '';
  let claims = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, BASE);
      const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
      if (url.pathname.startsWith('/job/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        return res.end(page(decodeURIComponent(url.pathname.split('/')[2])));
      }
      if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { autoApplyParallelLimit: 10 } });
      if (url.pathname === '/api/extension/apply/claim') {
        if (claims >= NAMES.length) return json({ success: true, application: null });
        const name = NAMES[claims];
        claims += 1;
        return json({ success: true, application: {
          attemptId: uuid('d00', claims), aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
          job: {
            id: uuid('e00', claims), url: `${BASE}/job/${name}`, title: 'Data Engineer', company: `Acme ${claims}`, location: 'Remote',
            workType: 'Full-time', salary: null, description: 'Spark.', resumeFolder: 'QTS\\Candidate\\Acme', resumeSavedOn: 'Test Chrome',
            promptName: null, templateName: null, resumeText: 'Data Engineer.', coverLetterText: 'Dear Hiring Manager,',
          },
          candidate: CANDIDATE, profileDetails: { experiences: [], educations: [] },
          savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: null,
        } });
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
  try {
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
    const worker = await target.worker();
    await worker.evaluate(async (base) => chrome.storage.local.set({
      qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
      qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
      qtsApplyDryRun: false, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
    }), BASE);
    await worker.evaluate((documentPdf) => {
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
    await worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    // Each job's page, once its form is filled (the first name is in): what the two boxes hold.
    const results = {};
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && Object.keys(results).length < NAMES.length) {
      for (const tab of await browser.pages()) {
        const name = decodeURIComponent(tab.url().split('/job/')[1] || '');
        if (!NAMES.includes(name) || results[name]) continue;
        if (await tab.evaluate(() => document.querySelector('#fn')?.value).catch(() => null) !== 'Radu') continue;
        // A search box is the slowest to fill: read once both boxes stay the same for 3 s (up to 20 s).
        const read = () => tab.evaluate(() => ({ cc: document.querySelector('#cc')?.value, ph: document.querySelector('#ph')?.value }));
        let last = await read();
        for (let quiet = 0, waited = 0; quiet < 3000 && waited < 20000; waited += 1000) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const now = await read();
          quiet = JSON.stringify(now) === JSON.stringify(last) && now.ph ? quiet + 1000 : 0;
          last = now;
        }
        results[name] = last;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const expected = Object.fromEntries(NAMES.map((name) => [name, { cc: LAYOUTS[name][1], ph: LAYOUTS[name][2] }]));
    assert.deepEqual(results, expected);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
}

const options = { skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).', timeout: 300000 };

test('a phone asked as a country code and a number: both filled, the number without its code', options, () => fillLayouts(TOGETHER));

test('a phone code asked in a search box: the code picked, the number without it', options, () => fillLayouts(['searchCodeBox']));
