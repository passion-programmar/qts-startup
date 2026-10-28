// End-to-end test of the REAL extension in Chrome: its service worker, the Apply runner, the form
// engine, and the answer rules, against a local mock QTS server on 127.0.0.1. The mock hands out one
// test job, serves a two-step test application form, and plays the AI by fixed rules. Test mode
// (qtsApplyDryRun) fills every step and stops before Submit. Nothing leaves this machine; nothing is
// submitted. Run with: npm run test:apply-e2e (skipped when Chrome is not installed; QTS_CHROME sets it).
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

const PORT = 47123;
const BASE = `http://127.0.0.1:${PORT}`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const log = { requests: [], aiPrompts: [], released: null, pageSubmitted: false, pageLoads: 0, claims: 0 };

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme - Apply</title></head><body>
<header><label>Language <select id="lang" onchange="location.href='/form?locale='+this.value"><option>English</option><option>Deutsch</option><option>Polski</option><option>Español</option></select></label></header>
<form id="app" onsubmit="event.preventDefault(); fetch('/page-submitted', { method: 'POST' }); window.submitted = true;">
 <div id="step1">
  <h2>Personal information</h2>
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="ph">Phone *</label><div class="row"><span class="dial">🇷🇴 +40</span><input id="ph" type="tel" required></div></div>
  <div><label for="co">Country *</label><select id="co" required><option value="">Select…</option><option>Poland</option><option>Romania</option></select></div>
  <div><label for="rg">Region *</label><select id="rg" required><option value="">Select a country first</option></select></div>
  <div><label for="yrs">Years of experience in machine learning? *</label><input id="yrs" role="combobox" aria-controls="yrs-l" required><ul id="yrs-l" role="listbox" hidden></ul></div>
  <fieldset><legend>Are you willing to relocate? *</legend><label><input type="radio" name="rel" value="y">Yes</label><label><input type="radio" name="rel" value="n">No</label></fieldset>
  <div id="more"></div>
  <div><label for="gh">GitHub username *</label><input id="gh" required></div>
  <div><label for="cl">Cover letter</label><div class="toolbar"><button type="button" aria-pressed="false">Bold</button><button type="button" aria-pressed="false">Italic</button></div>
    <div class="editor" contenteditable="true"><br></div><textarea id="cl" name="cover_letter" style="display:none"></textarea></div>
  <div><label class="required" for="cv">Resume</label><input id="cv" type="file" accept=".pdf"><div class="hint">Allowed formats: .pdf</div></div>
  <button type="button" id="next">Next</button>
 </div>
 <div id="step2" style="display:none">
  <h2>A few questions</h2>
  <div><label for="tools">Which tools have you used? (Select all that apply) *</label><select id="tools" multiple required><option>Docker</option><option>Kubernetes</option><option>Terraform</option></select></div>
  <div><label for="why">Why do you want to join Acme? *</label><textarea id="why" required maxlength="600"></textarea></div>
  <div><label for="lvl">Python level *</label><input id="lvl" role="combobox" aria-controls="lvl-l" required><ul id="lvl-l" role="listbox"></ul></div>
  <button type="submit" id="submit">Submit application</button>
 </div>
</form>
<script>
  fetch('/page-loaded', { method: 'POST' });
  const regions = { Poland: ['Mazowieckie', 'Pomorskie'], Romania: ['Cluj', 'Bihor'] };
  const co = document.getElementById('co'), rg = document.getElementById('rg');
  co.addEventListener('change', () => { rg.innerHTML = '<option value="">Select…</option>' + (regions[co.value] || []).map((r) => '<option>' + r + '</option>').join(''); });
  const yrs = document.getElementById('yrs'), yl = document.getElementById('yrs-l');
  yrs.addEventListener('focus', () => { yl.innerHTML = ['0-2 years', '3-5 years', '6+ years'].map((o) => '<li role="option">' + o + '</li>').join(''); yl.hidden = false; });
  yl.addEventListener('click', (e) => { if (e.target.getAttribute('role') === 'option') { yrs.value = e.target.textContent; yl.hidden = true; } });
  document.querySelectorAll('input[name=rel]').forEach((r) => r.addEventListener('change', () => {
    document.getElementById('more').innerHTML = r.value === 'y' ? '<label for="where">Where would you relocate to?</label><input id="where">' : '';
  }));
  document.getElementById('next').addEventListener('click', () => {
    const missing = ['fn', 'ln', 'em', 'ph', 'co', 'rg', 'yrs'].filter((id) => !document.getElementById(id).value);
    if (missing.length) return;
    document.getElementById('step1').style.display = 'none'; document.getElementById('step2').style.display = '';
  });
  const lvl = document.getElementById('lvl'), ll = document.getElementById('lvl-l');
  const levels = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
  lvl.addEventListener('input', () => { ll.innerHTML = lvl.value ? levels.filter((l) => l.toLowerCase().includes(lvl.value.toLowerCase())).map((l) => '<li role="option">' + l + '</li>').join('') : ''; });
  ll.addEventListener('click', (e) => { if (e.target.getAttribute('role') === 'option') { lvl.value = e.target.textContent; ll.innerHTML = ''; } });
</script></body></html>`;

const application = {
  attemptId: '00000000-0000-4000-8000-000000000e2e',
  aiMode: 'gemini',
  autoSubmit: false,
  reviewMode: 'every_step',
  job: {
    id: '00000000-0000-4000-8000-0000000000aa', url: `${BASE}/form`, title: 'Machine Learning Engineer', company: 'Acme',
    location: 'Remote', workType: 'Remote', salary: null,
    description: 'We need an ML engineer with Python, Docker, and Kubernetes experience.',
    resumeFolder: 'C:\\test-folder', resumeSavedOn: 'Test Chrome', promptName: 'Test prompt', templateName: 'Test template',
    resumeText: 'Radu Star — ML Engineer. 7 years of Python, Docker, Kubernetes.', coverLetterText: 'Dear Hiring Manager,\nI would like to join Acme as an ML engineer.\nKind regards,\nRadu Star',
  },
  candidate: {
    firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com', phone: '+40264484948',
    city: 'Cluj-Napoca', country: 'Romania', province: 'Cluj', nationality: 'Romanian',
    willingToRelocate: true, needsSponsorship: false, yearsOfExperience: 7, githubUrl: null,
  },
  savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null,
};

/** Plays Gemini: answers the questions in the prompt by fixed rules (never real AI). */
function aiReply(text) {
  // The questions: the JSON list after "Questions:" (first ask) or after "fixing each problem:" (follow-up).
  const NL = String.fromCharCode(10);
  const marker = text.includes('Questions:' + NL) ? text.lastIndexOf('Questions:' + NL) + 11 : text.indexOf('fixing each problem:' + NL) + 21;
  const line = text.slice(marker).split(NL)[0];
  let questions = [];
  try { questions = JSON.parse(line); } catch { questions = []; }
  return JSON.stringify({ answers: questions.map((q) => {
    if (/github/i.test(q.question)) return { id: q.id, value: null, status: 'review', reason: 'No GitHub account in the profile or résumé.' };
    if (q.choicesUnknown) return { id: q.id, value: ['Advanced', 'Expert'], status: 'ready' };
    if (Array.isArray(q.options) && q.options.length) {
      return { id: q.id, value: q.multiple ? q.options.slice(0, 2).join(' | ') : q.options[q.options.length - 1], status: 'ready' };
    }
    if (q.type === 'textarea') return { id: q.id, value: 'I want to join Acme because my 7 years of Python and Kubernetes match the role.', status: 'ready' };
    return { id: q.id, value: 'Germany', status: 'ready' };
  }) });
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    log.requests.push(`${req.method} ${url.pathname}`); log.lastRequests = [...(log.lastRequests || []).slice(-6), `${new Date().toISOString().slice(11, 19)} ${req.method} ${url.pathname}`];
    const json = (data) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/form') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(FORM); }
    if (url.pathname === '/page-loaded') { log.pageLoads += 1; return json({}); }
    if (url.pathname === '/page-submitted') { log.pageSubmitted = true; return json({}); }
    if (url.pathname === '/api/extension/apply/claim') {
      log.claims += 1;
      return json({ success: true, application: log.claims === 1 ? application : null });
    }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 120, reviewMode: 'every_step', autoSubmit: false });
    if (url.pathname === '/api/extension/apply/answers') {
      const turns = JSON.parse(body || '{}').turns || [];
      const prompt = turns[turns.length - 1]?.text || '';
      log.aiPrompts.push(prompt);
      return json({ success: true, reply: aiReply(prompt) });
    }
    if (url.pathname === '/api/extension/apply/documents') {
      return json({ success: true, documents: { folder: 'C:\\test-folder', resume: { filename: 'Radu_Star_CV.pdf', base64: pdf }, coverLetter: { filename: 'Radu_Star_Cover.pdf', base64: pdf } } });
    }
    if (url.pathname === '/api/extension/apply/release') { log.released = JSON.parse(body || '{}'); return json({ success: true }); }
    return json({ success: true });
  });
});

test('the real runner applies to a two-step form: profile, documents, dependent lists, AI, checks, and stops before Submit', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 240000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  const reports = [];
  try {
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
    const worker = await target.worker();
    worker.on('console', async (message) => {
      if (!message.text().startsWith('[QTS Apply] step-report')) return;
      const args = await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => null)));
      reports.push(args[1]);
    });
    await worker.evaluate(async (base) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: true, qtsApplyDebug: true, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
      });
    }, BASE);
    await worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    for (let waited = 0; waited < 180000 && !log.released; waited += 1000) await new Promise((resolve) => setTimeout(resolve, 1000));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const form = (await browser.pages()).find((page) => page.url().startsWith(`${BASE}/form`));
    const state = await form.evaluate(() => {
      const value = (id) => document.getElementById(id)?.value ?? null;
      return {
        step2: document.getElementById('step2').style.display !== 'none',
        fn: value('fn'), em: value('em'), ph: value('ph'), co: value('co'), rg: value('rg'), yrs: value('yrs'),
        relocate: document.querySelector('input[name=rel]:checked')?.value || null, where: value('where'), gh: value('gh'),
        editor: document.querySelector('.editor').textContent, resume: document.getElementById('cv').files.length,
        bold: document.querySelector('.toolbar button').getAttribute('aria-pressed'),
        tools: [...document.getElementById('tools').selectedOptions].map((o) => o.text), why: value('why'), lvl: value('lvl'),
        submitted: Boolean(window.submitted),
      };
    });
    // Stopped before Submit, the page never reloaded (its language switcher left alone), nothing submitted.
    assert.equal(log.released?.mode, 'test');
    assert.match(log.released.reason, /everything is filled; stopped before Submit/);
    assert.equal(log.pageSubmitted, false);
    assert.equal(state.submitted, false);
    assert.equal(log.pageLoads, 1);
    // Step 1: profile facts (phone beside its +40 picker), the dependent region, the AI's list pick,
    // the relocation follow-up from the AI (never the yes/no fact), cover letter in the rich editor,
    // the CSS-required résumé, the toolbar untouched, the missing GitHub left for the Manager.
    assert.deepEqual([state.fn, state.em, state.ph, state.co, state.rg], ['Radu', 'radu.test@example.com', '264484948', 'Romania', 'Cluj']);
    assert.equal(state.yrs, '6+ years');
    assert.deepEqual([state.relocate, state.where], ['y', 'Germany']);
    assert.match(state.editor, /Dear Hiring Manager,\s*I would like to join Acme/);
    assert.equal(state.resume, 1);
    assert.equal(state.bold, 'false');
    assert.equal(state.gh, '');
    // Step 2: a native multi-select, a written answer, a list found only by searching.
    assert.equal(state.step2, true);
    assert.deepEqual(state.tools, ['Docker', 'Kubernetes']);
    assert.match(state.why, /join Acme/);
    assert.equal(state.lvl, 'Expert');
    // One AI request per batch of open questions (two rounds on step 1, one on step 2), no repeats.
    assert.equal(log.aiPrompts.length, 3);
    // The step reports: what was verified, what needs the Manager, and why.
    const [first, second] = reports;
    assert.equal(first.step, 1);
    assert.deepEqual(first.plan.filter((entry) => entry.status === 'needs_review').map((entry) => entry.question), ['GitHub username *']);
    assert.equal(first.failedAttempts, 0);
    assert.deepEqual([second.step, second.verified, second.needsReview], [2, 3, 0]);
  } finally {
    await browser.close();
    server.close();
  }
});
