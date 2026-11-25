// Replay pack: the REAL extension's Auto Apply fill (self.__qtsAutoApplyApi.fillPage, no AI) on local
// copies of widgets met on real job sites (Greenhouse/Workable plain forms, Telekom's Eightfold lists
// and uploads, SoftServe's nice-select, Revolut People's tick groups). Each page's end state is checked
// in the page itself, and each fill's time is printed, so a speed change can be measured and a fix for
// one site cannot quietly break another. Nothing leaves this machine; no job site, AI or QTS server.
// Run with: node --test extension/background/fill-replay.e2e.test.js (skipped without Chrome).
// QTS_E2E_HEADFUL=1 shows the browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { normalizeQuestionKey } = require('../shared/apply-answers.js');

const root = path.join(__dirname, '..', '..');
const CHROME = [
  process.env.QTS_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => candidate && fs.existsSync(candidate));
const HEADFUL = process.env.QTS_E2E_HEADFUL === '1';
const skip = CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).';
const PORT = 47151;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- The candidate, the Manager's saved answers and the PDFs ----
function pdf(text) {
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1').toString('base64');
}
const ID = '00000000-0000-4000-8000-0000000000ac';
const saved = (questionText, answer) => ({
  id: `saved-${normalizeQuestionKey(questionText).slice(0, 20)}`, managerId: 'm', candidateId: null, jobId: null, scope: 'manager', contextKey: 'manager',
  questionKey: normalizeQuestionKey(questionText), questionText, answer, variants: [{ kind: 'text', answer, options: [] }], note: null,
});
const APPLICATION = {
  attemptId: '00000000-0000-4000-8000-00000000f001', applyStopVersion: 0,
  aiMode: 'gemini', autoApplyApi: true, apiFlow: true, autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: '00000000-0000-4000-8000-00000000f002', url: '', title: 'Senior Site Reliability Engineer', company: 'Globex',
    location: 'Remote', workType: 'Full-time', salary: null, description: 'Kubernetes, AWS, Terraform.',
    resumeText: 'Alex Morgan — Senior Site Reliability Engineer. 9 years: Kubernetes, AWS, Terraform.',
    coverLetterText: 'Dear Hiring Manager,\nI would like to apply for this role.\nKind regards,\nAlex Morgan',
  },
  candidate: {
    id: ID, candidateId: ID, firstName: 'Alex', lastName: 'Morgan', email: 'alex.morgan.qts.test@example.com', phone: '+40721234567',
    headline: 'Senior Site Reliability Engineer', linkedinUrl: 'https://www.linkedin.com/in/alex-morgan-qts-test', githubUrl: null, portfolioUrl: null,
    country: 'Romania', city: 'Bucharest', province: 'Bucharest', addressLine1: 'Strada Exemplu 10', postalCode: '010101',
    yearsOfExperience: 9, nationality: 'Romanian', birthday: '1990-05-14', languages: 'English C1',
    gender: 'man', ethnicity: 'white', veteranStatus: 'not_veteran', disabilityStatus: 'no', sexualOrientation: 'prefer_not_to_say', pronouns: 'he_him',
  },
  profileDetails: {
    experiences: [
      { jobTitle: 'Senior Site Reliability Engineer', companyName: 'Cloudway SRL', location: 'Bucharest, Romania', workMode: 'remote', startDate: '2021-03-01', endDate: null, isCurrent: true, description: null },
      { jobTitle: 'DevOps Engineer', companyName: 'Datanet SA', location: 'Cluj-Napoca, Romania', workMode: 'hybrid', startDate: '2016-09-01', endDate: '2021-02-28', isCurrent: false, description: null },
    ],
    educations: [{ institution: 'University Politehnica of Bucharest', degree: "Bachelor's Degree", fieldOfStudy: 'Computer Science', startDate: '2009-10-01', endDate: '2013-07-01', isCurrent: false, description: null }],
  },
  savedAnswers: [
    saved('Will you require employer sponsorship for this role now or in the future?', 'No'),
    saved('Are you currently legally authorized to work as a direct employee, without restrictions, in the country where this role is based, without requiring employer sponsorship or additional work authorization ?', 'Yes'),
    saved('How did you find out about our vacancy?', 'LinkedIn'),
    saved('Do you consent to us keeping your data for future job opportunities?', 'Yes'),
    saved('Notice period', 'Available immediately'),
  ],
  exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: '',
};
const DOCUMENTS = {
  folder: 'QTS_Resume/Test/Alex Morgan',
  paths: ['QTS_Resume/Test/Alex Morgan/Alex Morgan.pdf', 'QTS_Resume/Test/Alex Morgan/Alex Morgan_Cover_Letter.pdf'],
  resume: { filename: 'Alex Morgan.pdf', mimeType: 'application/pdf', base64: pdf('Alex Morgan - Resume') },
  coverLetter: { filename: 'Alex Morgan_Cover_Letter.pdf', mimeType: 'application/pdf', base64: pdf('Alex Morgan - Cover letter') },
};

// ---- Local copies of real widgets ----
const HEAD = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - ${title}</title>
<style>body{font-family:Arial;margin:24px;max-width:760px} .q{margin:14px 0;position:relative} label,legend{display:block;margin-bottom:4px}
input[type=text],input[type=email],input[type=tel],input:not([type]),textarea,select{width:340px;padding:6px}
[role=listbox]{position:absolute;z-index:5;background:#fff;border:1px solid #888;list-style:none;margin:0;padding:0;width:340px;max-height:180px;overflow:auto}
[role=option]{padding:6px;cursor:pointer} [role=option]:hover{background:#eef}
.nice-select{width:340px;border:1px solid #888;padding:6px;cursor:pointer;position:relative} .nice-select .list{display:none;position:absolute;left:0;top:100%;background:#fff;border:1px solid #888;width:100%;list-style:none;margin:0;padding:0;z-index:5}
.nice-select.open .list{display:block} .nice-select .option{padding:6px}</style></head><body>`;

// Greenhouse / Workable: plain boxes, a native list, radio groups, a consent tick, two uploads; some
// boxes still hold someone else's answers (QTS empties them first).
const PLAIN = `${HEAD('Plain form')}
<form id="app"><h1>Apply for Senior Site Reliability Engineer</h1>
  <div class="q"><label for="fn">First name *</label><input id="fn" required value="Old Name"></div>
  <div class="q"><label for="ln">Last name *</label><input id="ln" required></div>
  <div class="q"><label for="em">Email *</label><input id="em" type="email" required value="old@person.com"></div>
  <div class="q"><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
  <div class="q"><label for="li">LinkedIn Profile</label><input id="li"></div>
  <div class="q"><label for="city">City *</label><input id="city" required></div>
  <div class="q"><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option>Indeed</option><option>LinkedIn</option><option>Other</option></select></div>
  <fieldset class="q"><legend>Are you willing to relocate? *</legend><label><input type="radio" name="relo" value="Yes" required> Yes</label><label><input type="radio" name="relo" value="No"> No</label></fieldset>
  <fieldset class="q"><legend>Will you now or in the future require sponsorship for employment visa status? *</legend><label><input type="radio" name="spon" value="Yes" required> Yes</label><label><input type="radio" name="spon" value="No"> No</label></fieldset>
  <div class="q"><label for="msg">Message to the hiring team</label><textarea id="msg" rows="4"></textarea></div>
  <div class="q"><label for="cv">Resume/CV *</label><input id="cv" type="file" accept=".pdf" required></div>
  <div class="q"><label for="cl">Cover Letter</label><input id="cl" type="file" accept=".pdf"></div>
  <div class="q"><label><input type="checkbox" id="privacy" required> I agree to the privacy policy *</label></div>
  <button type="submit" id="submit">Submit application</button>
</form></body></html>`;

// The list widget Telekom's Eightfold form uses: a typed box (role=combobox) whose list opens on a click,
// narrows as you type, and is picked with a click. picked() tells a real pick from typed text.
const COMBO_SCRIPT = `<script>
window.picked = {};
function combobox(id, choices) {
  const input = document.getElementById(id);
  const list = document.getElementById(input.getAttribute('aria-controls'));
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const render = () => {
    const typed = input.value.toLowerCase();
    list.innerHTML = '';
    for (const choice of choices.filter((entry) => entry.toLowerCase().includes(typed))) {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.textContent = choice;
      item.addEventListener('mousedown', (event) => { event.preventDefault(); input.value = choice; window.picked[id] = choice; close(); input.dispatchEvent(new Event('change', { bubbles: true })); });
      list.appendChild(item);
    }
  };
  const open = () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); render(); };
  input.addEventListener('click', open);
  input.addEventListener('input', () => { delete window.picked[id]; open(); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  close();
}
// An upload that empties its file box and lists the file once "uploaded" (after 700 ms).
function upload(id) {
  const input = document.getElementById(id);
  input.addEventListener('change', () => {
    const name = input.files[0]?.name;
    if (!name) return;
    setTimeout(() => { document.getElementById(id + '-done').innerHTML = '<span>File upload completed successfully</span> <span class="file">' + name + '</span>'; input.value = ''; }, 700);
  });
}
</script>`;
const combo = (id, label, required = true, aria = false) => `<div class="q">${aria ? '' : `<label id="${id}-label" for="${id}">${label}${required ? ' *' : ''}</label>`}
  <input id="${id}" type="text" role="combobox" aria-controls="${id}-list" aria-expanded="false" ${aria ? `aria-label="${label}"` : ''} ${required ? 'aria-required="true"' : ''} placeholder="Select" autocomplete="off">
  <ul id="${id}-list" role="listbox"></ul></div>`;
const COUNTRY_CODES = ['🇦🇩 (+376) Andorra', '🇦🇹 (+43) Austria', '🇩🇪 (+49) Germany', '🇭🇺 (+36) Hungary', '🇷🇴 (+40) Romania', '🇬🇧 (+44) United Kingdom'];
const COMBOS = `${HEAD('Eightfold form')}${COMBO_SCRIPT}
<form id="app"><h1>Application Form</h1>
  <h2>Resume</h2><div class="q"><label for="cv">Upload your resume</label><input id="cv" type="file" accept=".pdf"><div id="cv-done"></div></div>
  <h2>Contact Information</h2>
  <div class="q"><label for="fn">First Name *</label><input id="fn" aria-required="true"></div>
  <div class="q"><label for="ln">Last Name *</label><input id="ln" aria-required="true"></div>
  <div class="q"><label for="em">Email *</label><input id="em" aria-required="true"></div>
  <fieldset class="q"><legend>Phone *</legend>${combo('cc', 'Country code', true, true)}<input id="ph" type="text" placeholder="Phone Number" aria-required="true"></fieldset>
  <h2>Additional Attachments</h2><div class="q"><label for="att">Additional Attachments</label><input id="att" type="file" accept=".pdf" multiple><div id="att-done"></div></div>
  ${combo('lang', 'Preferred Language')}
  <h2>Additional questions</h2>
  ${combo('emp', 'Have you ever been employed by our company?')}
  ${combo('open', 'Are you open for other positions by the company?')}
  <div class="q"><label for="rec">If you were recommended by an employee, please enter the email address of the recommender person. *</label><input id="rec" aria-required="true"></div>
  ${combo('auth', 'Are you authorized to work in the job location?')}
  <button type="submit" id="submit">Submit</button>
</form>
<script>
combobox('cc', ${JSON.stringify(COUNTRY_CODES)});
combobox('lang', ['English', 'German', 'Magyar']);
for (const id of ['emp', 'open', 'auth']) combobox(id, ['Yes', 'No']);
upload('cv'); upload('att');
</script></body></html>`;

// SoftServe's nice-select (a hidden native list drawn as a div), Revolut People's single-choice tick
// groups ("RadioButtons-…"), and a relocation radio group.
const WIDGETS = `${HEAD('Widgets form')}
<form id="app"><h1>Apply</h1>
  <div class="q"><label for="fn">First name *</label><input id="fn" required></div>
  <div class="q"><label for="em">Email *</label><input id="em" type="email" required></div>
  <div class="q"><label for="src">Where did you hear about us? *</label>
    <select id="src" style="display:none" required><option value="">Select</option><option value="Indeed">Indeed</option><option value="LinkedIn">LinkedIn</option><option value="Friend">Friend</option></select>
    <div class="nice-select" tabindex="0"><span class="current">Select</span><ul class="list">
      <li data-value="" class="option selected">Select</li><li data-value="Indeed" class="option">Indeed</li><li data-value="LinkedIn" class="option">LinkedIn</li><li data-value="Friend" class="option">Friend</li></ul></div></div>
  <div class="q"><p>Interview transcripts: we may use AI to transcribe interviews. Do you agree?</p>
    <div data-testid="RadioButtons-transcripts"><label><input type="checkbox" value="yes"> Yes, I consent</label><label><input type="checkbox" value="no"> No, I don't consent</label></div></div>
  <fieldset class="q"><legend>Would you be willing to relocate to Lisbon? *</legend><label><input type="radio" name="relo" value="Yes" required> Yes</label><label><input type="radio" name="relo" value="No"> No</label></fieldset>
  <button type="submit" id="submit">Submit application</button>
</form>
<script>
const nice = document.querySelector('.nice-select');
const select = document.getElementById('src');
nice.addEventListener('click', (event) => {
  const option = event.target.closest('.option');
  if (option && nice.classList.contains('open')) {
    select.value = option.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    nice.querySelector('.current').textContent = option.textContent;
    nice.querySelectorAll('.option').forEach((entry) => entry.classList.toggle('selected', entry === option));
  }
  nice.classList.toggle('open');
});
const group = document.querySelector('[data-testid^="RadioButtons"]');
group.addEventListener('change', (event) => { for (const box of group.querySelectorAll('input')) if (box !== event.target) box.checked = false; });
</script></body></html>`;

const PAGES = { '/plain': PLAIN, '/combos': COMBOS, '/widgets': WIDGETS };

// ---- Chrome with the extension ----
async function launch() {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: !HEADFUL, pipe: true, protocolTimeout: 600000, defaultViewport: HEADFUL ? null : { width: 1280, height: 900 },
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run', '--disable-popup-blocking', '--window-size=1300,950'],
  });
  const target = await browser.waitForTarget((entry) => entry.type() === 'service_worker' && entry.url().includes('service-worker.js'), { timeout: 30000 });
  const worker = await target.worker();
  for (let waited = 0; waited < 30000; waited += 250) {
    if (await worker.evaluate(() => Boolean(self.__qtsAutoApplyApi)).catch(() => false)) break;
    await sleep(250);
  }
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ authToken: 'replay-test', authExpiresAt: Date.now() + 3600 * 1000, qtsSessionUser: { id: 'replay', role: 'manager', displayName: 'Replay' } });
  });
  return { browser, worker };
}

/** The extension's Auto Apply fill on the page at urlPath (no AI), as a real run's first visit. */
async function fill(worker, urlPath) {
  return worker.evaluate(async (app, docs, url) => {
    const [tab] = await chrome.tabs.query({ url: `${url}*` });
    app.job.url = tab.url;
    app.applyDocuments = docs;
    app.documentsFolder = docs.folder;
    Object.assign(app, { cleanedBoxes: new Set(), stuckBoxes: new Map(), uploadedFileNames: new Set(), resumeAutofillTried: false, verifiedSites: new Set(),
      clearedSites: new Set(), aiRefused: new Map(), answerCache: new Map(), seedCleanOnce: false, destinationConfirmed: true, tabMoved: true });
    const started = Date.now();
    const report = await self.__qtsAutoApplyApi.fillPage(tab.id, app, async () => {}, 1, { noAi: true, onlyEmpty: false, again: false, stop: async () => false });
    const ms = Date.now() - started;
    // The application ends here: its real-input debugger is let go, as a finished run does.
    await releaseDebugger(tab.id);
    return { ms, problems: (report.problems || []).map((entry) => entry.message), timings: report.report?.timingsMs || {} };
  }, APPLICATION, DOCUMENTS, `${BASE}${urlPath}`);
}

let server;
let chrome;
const results = [];
test.before(async () => {
  if (skip) return;
  server = http.createServer((request, response) => {
    const page = PAGES[new URL(request.url, BASE).pathname];
    response.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page || 'not found');
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  chrome = await launch();
});
test.after(async () => {
  if (results.length) {
    console.log('\nReplay fill times:');
    for (const entry of results) console.log(`  ${entry.name.padEnd(10)} ${(entry.ms / 1000).toFixed(1).padStart(5)} s   ${Object.entries(entry.timings).map(([key, value]) => `${key} ${(value / 1000).toFixed(1)}`).join(', ')}`);
  }
  await chrome?.browser.close().catch(() => {});
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

// A fresh tab per page. (Between pages, Chrome in this test sometimes drops the tab the previous fill used;
// a page that does not load in 8 s is opened once more in a new tab.)
async function openPage(urlPath) {
  for (let attempt = 0; ; attempt += 1) {
    const page = await chrome.browser.newPage();
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    try {
      await page.goto(`${BASE}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.bringToFront();
      return page;
    } catch (error) {
      await page.close().catch(() => {});
      if (attempt >= 2) throw error;
    }
  }
}
async function run(name, urlPath) {
  const page = await openPage(urlPath);
  const outcome = await fill(chrome.worker, urlPath);
  results.push({ name, ...outcome });
  return { page, outcome };
}

test('plain form (Greenhouse / Workable): boxes, a list, radios, consent and both PDFs', { skip, timeout: 180000 }, async () => {
  const { page, outcome } = await run('plain', '/plain');
  const state = await page.evaluate(() => ({
    fn: document.getElementById('fn').value, ln: document.getElementById('ln').value, em: document.getElementById('em').value,
    ph: document.getElementById('ph').value, li: document.getElementById('li').value, city: document.getElementById('city').value,
    hear: document.getElementById('hear').value, relo: document.querySelector('[name=relo]:checked')?.value, spon: document.querySelector('[name=spon]:checked')?.value,
    msg: document.getElementById('msg').value, cv: document.getElementById('cv').files[0]?.name, cl: document.getElementById('cl').files[0]?.name,
    privacy: document.getElementById('privacy').checked,
  }));
  assert.deepEqual({ ...state, msg: state.msg.startsWith('Dear Hiring Manager') }, {
    fn: 'Alex', ln: 'Morgan', em: 'alex.morgan.qts.test@example.com', ph: '+40721234567', li: 'https://www.linkedin.com/in/alex-morgan-qts-test',
    city: 'Bucharest', hear: 'LinkedIn', relo: 'No', spon: 'No', msg: true, cv: 'Alex Morgan.pdf', cl: 'Alex Morgan_Cover_Letter.pdf', privacy: true,
  }, `problems: ${JSON.stringify(outcome.problems)}`);
  assert.deepEqual(outcome.problems, []);
});

test('Eightfold lists (Telekom): country code, language, Yes/No lists picked; phone without its code; uploads listed', { skip, timeout: 240000 }, async () => {
  const { page, outcome } = await run('combos', '/combos');
  const state = await page.evaluate(() => ({
    fn: document.getElementById('fn').value, ph: document.getElementById('ph').value, rec: document.getElementById('rec').value,
    picked: window.picked, cv: document.querySelector('#cv-done .file')?.textContent, att: document.querySelector('#att-done .file')?.textContent,
  }));
  assert.deepEqual(state, {
    fn: 'Alex', ph: '721234567', rec: 'N/A',
    picked: { cc: '🇷🇴 (+40) Romania', lang: 'English', emp: 'No', open: 'Yes', auth: 'Yes' },
    cv: 'Alex Morgan.pdf', att: 'Alex Morgan_Cover_Letter.pdf',
  }, `problems: ${JSON.stringify(outcome.problems)}`);
  assert.deepEqual(outcome.problems, []);
});

test('nice-select (SoftServe), a tick group (Revolut People) and relocation', { skip, timeout: 180000 }, async () => {
  const { page, outcome } = await run('widgets', '/widgets');
  const state = await page.evaluate(() => ({
    fn: document.getElementById('fn').value, src: document.getElementById('src').value,
    shown: document.querySelector('.nice-select .current').textContent,
    consent: [...document.querySelectorAll('[data-testid^="RadioButtons"] input')].filter((box) => box.checked).map((box) => box.value),
    relo: document.querySelector('[name=relo]:checked')?.value,
  }));
  assert.deepEqual(state, { fn: 'Alex', src: 'LinkedIn', shown: 'LinkedIn', consent: ['yes'], relo: 'No' }, `problems: ${JSON.stringify(outcome.problems)}`);
  assert.deepEqual(outcome.problems, []);
});
