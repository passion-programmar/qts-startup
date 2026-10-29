// End-to-end test of Auto Apply in the REAL extension in Chrome (service worker, Auto Apply controller,
// automatic engine, form engine, answer rules, review panel) against a local mock QTS server on
// 127.0.0.1 with synthetic application forms. The mock plays Gemini by fixed rules (never real AI).
// Nothing leaves this machine. The only Submit clicks are the test playing the Manager on the local
// form. QTS_E2E_HEADFUL=1 shows the Chrome window; QTS_E2E_SHOTS=<folder> saves screenshots.
// Run with: npm run test:apply-e2e (skipped when Chrome is not installed; QTS_CHROME sets it).
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
const HEADFUL = process.env.QTS_E2E_HEADFUL === '1';
const SHOTS = process.env.QTS_E2E_SHOTS || null;
const skip = CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).';

const PORT = 47131;
const BASE = `http://127.0.0.1:${PORT}`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

// Three steps: details and uploads; questions (two with approved answers, one nothing answers); consent.
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>
<form id="app" onsubmit="event.preventDefault(); fetch('/page-submitted', { method: 'POST' }); window.submitted = (window.submitted || 0) + 1;">
 <div id="step1">
  <h2>Your details</h2>
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
  <div><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required></div>
  <div><label for="cvl">Cover letter</label><input id="cvl" type="file" accept=".pdf"></div>
  <button type="button" id="next1">Next</button>
 </div>
 <div id="step2" style="display:none">
  <h2>Questions</h2>
  <div><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option>Indeed</option><option>LinkedIn</option><option>Other</option></select></div>
  <fieldset><legend>Will you be able to work from our office twice a week? *</legend><label><input type="radio" name="office" value="Yes">Yes</label><label><input type="radio" name="office" value="No">No</label></fieldset>
  <div><label for="mot">What motivates you in your work? *</label><textarea id="mot" required></textarea></div>
  <div><label for="extra">Anything else you would like to share?</label><textarea id="extra"></textarea></div>
  <button type="button" id="next2">Next</button>
 </div>
 <div id="step3" style="display:none">
  <h2>Consent</h2>
  <div><label><input type="checkbox" id="privacy" required> I agree to the privacy policy *</label></div>
  <button type="submit" id="submit">Submit application</button>
 </div>
</form>
<script>
  fetch('/page-loaded', { method: 'POST' });
  const show = (n) => { for (const i of [1, 2, 3]) document.getElementById('step' + i).style.display = i === n ? '' : 'none'; };
  document.getElementById('next1').addEventListener('click', () => {
    if (['fn', 'ln', 'em', 'ph'].some((id) => !document.getElementById(id).value) || !document.getElementById('cv').files.length) return;
    show(2);
  });
  document.getElementById('next2').addEventListener('click', () => {
    if (!document.getElementById('hear').value || !document.querySelector('input[name=office]:checked') || !document.getElementById('mot').value) return;
    show(3);
  });
</script></body></html>`;

// Two steps for AI: details; then questions the AI answers (two supported, two not) and consent.
const FORM_AI = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Initech - Apply</title></head><body>
<form id="app" onsubmit="event.preventDefault(); fetch('/page-submitted', { method: 'POST' }); window.submitted = (window.submitted || 0) + 1;">
 <div id="step1">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required></div>
  <div><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option>Indeed</option><option>LinkedIn</option></select></div>
  <button type="button" id="next1">Next</button>
 </div>
 <div id="step2" style="display:none">
  <div><label for="mot">What motivates you in your work? *</label><textarea id="mot" required></textarea></div>
  <div><label for="dj">How many years of experience with Django do you have? *</label><input id="dj" type="number" required></div>
  <div><label for="cloud">Which cloud platform have you used most?</label><select id="cloud"><option value="">Select…</option><option>AWS</option><option>GCP</option><option>Azure</option></select></div>
  <div><label for="extra">Anything else you would like to share?</label><textarea id="extra"></textarea></div>
  <div><label><input type="checkbox" id="privacy" required> I agree to the privacy policy *</label></div>
  <button type="submit" id="submit">Submit application</button>
 </div>
</form>
<script>
  document.getElementById('next1').addEventListener('click', () => {
    if (!document.getElementById('fn').value || !document.getElementById('cv').files.length || !document.getElementById('hear').value) return;
    document.getElementById('step1').style.display = 'none'; document.getElementById('step2').style.display = '';
  });
</script></body></html>`;

const attempt = (n) => `00000000-0000-4000-8000-00000000a${String(n).padStart(3, '0')}`;
const APPROVED = [
  { questionKey: 'how did you hear about this position', questionText: 'How did you hear about this position?', answer: 'LinkedIn', note: null, scope: 'everyone' },
  { questionKey: 'will you be able to work from our office twice a week', questionText: 'Will you be able to work from our office twice a week?', answer: 'Yes', note: null, scope: 'everyone' },
  { questionKey: 'do you hold a forklift licence', questionText: 'Do you hold a forklift licence?', answer: 'No', note: null, scope: 'everyone' },
];
const application = (n, form = 'form') => ({
  attemptId: attempt(n),
  aiMode: 'chatgpt',
  // Super Admin's settings say "submit by itself": Auto Apply must still wait for the Manager.
  autoSubmit: true,
  reviewMode: 'every_step',
  job: {
    id: `00000000-0000-4000-8000-00000000b${String(n).padStart(3, '0')}`, url: `${BASE}/${form}?job=${n}`, title: 'Backend Engineer', company: form === 'form' ? 'Globex' : 'Initech',
    location: 'Remote', workType: 'Remote', salary: null, description: 'We use Python, Django and Kubernetes on AWS. 5+ years of backend work.',
    resumeFolder: 'C:\\test-folder', resumeSavedOn: 'Test Chrome', promptName: 'Test prompt', templateName: 'Test template',
    resumeText: 'Ana Test — Backend Engineer since 2019. Python, Django, AWS, PostgreSQL. Built payment services.',
    coverLetterText: 'Dear Hiring Manager,\nI would like to join your team.\nKind regards,\nAna Test',
  },
  candidate: {
    firstName: 'Ana', lastName: 'Test', email: 'ana.test@example.com', phone: '+40264484948',
    city: 'Cluj-Napoca', country: 'Romania', nationality: 'Romanian', yearsOfExperience: 6,
  },
  savedAnswers: APPROVED,
  exchangeRates: null,
  rememberedChoices: [],
  answerPrompt: null,
});

/** Plays Gemini by fixed rules: two answers the documents support, two they do not. */
function aiReply(prompt) {
  const NL = String.fromCharCode(10);
  const marker = prompt.lastIndexOf('Questions:' + NL);
  let questions = [];
  try { questions = JSON.parse(prompt.slice(marker + 11).split(NL)[0]); } catch { questions = []; }
  return JSON.stringify({ answers: questions.map((q) => {
    if (/motivates/i.test(q.question)) return { id: q.id, value: 'Building reliable Python payment services on AWS, as I have done since 2019.', status: 'ready' };
    if (/django/i.test(q.question)) return { id: q.id, value: '9', status: 'ready' };
    if (/cloud/i.test(q.question)) return { id: q.id, value: 'AWS', status: 'ready' };
    if (/anything else/i.test(q.question)) return { id: q.id, value: 'I am a certified Kubernetes administrator.', status: 'ready' };
    return { id: q.id, value: null, status: 'review', reason: 'not in the documents' };
  }) });
}

// What the mock serves and records; each test resets it.
const mock = {};
function resetMock(options = {}) {
  Object.assign(mock, {
    log: [], answers: 0, prompts: [], heartbeats: 0, heartbeatLog: [], released: [], reviews: [], submitted: [], results: [], proposals: [], resumes: 0,
    pageSubmitted: 0, claims: 0, byAttempt: {}, queue: options.queue || [], claimStatus: options.claimStatus || 200,
    canUseApply: options.canUseApply ?? true, stopVersion: 0, fail429: options.fail429 || 0, heartbeat409: false,
    // 'rules' (fixed answers), 'invalid' (no JSON), 'quota' (429 every time), 'hang' (never answers).
    aiMode: options.aiMode || 'rules',
  });
}
resetMock();

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const at = Date.now();
    mock.log.push({ at, method: req.method, path: url.pathname });
    const data = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    const json = (payload, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(payload)); };
    const html = (text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(text); };
    if (url.pathname === '/form') return html(FORM);
    if (url.pathname === '/form-ai') return html(FORM_AI);
    if (url.pathname === '/form-gpt') return html(FORM_GPT);
    if (url.pathname === '/blank') return html('<!doctype html><title>Job page</title><h1>A job</h1>');
    if (url.pathname === '/page-submitted') { mock.pageSubmitted += 1; return json({}); }
    if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { canUseApply: mock.canUseApply } });
    if (url.pathname === '/api/extension/apply/claim') {
      mock.claims += 1;
      if (mock.claimStatus !== 200) return json({ success: false, message: 'Apply is not turned on for your account.' }, mock.claimStatus);
      const next = mock.queue.shift() || null;
      if (next) mock.byAttempt[next.attemptId] = next;
      return json({ success: true, application: next });
    }
    if (url.pathname === '/api/extension/apply/resume') {
      mock.resumes += 1;
      return json({ success: true, application: mock.byAttempt[data.attemptId] || null });
    }
    if (url.pathname === '/api/extension/apply/heartbeat') {
      mock.heartbeats += 1;
      mock.heartbeatLog.push({ at, attemptId: data.attemptId });
      if (mock.heartbeat409) return json({ success: false, message: 'This application is no longer held by this Chrome.' }, 409);
      return json({ success: true, leaseSeconds: 120, reviewMode: 'every_step', autoSubmit: true });
    }
    if (url.pathname === '/api/extension/apply/answers') {
      mock.answers += 1;
      if (mock.aiMode === 'hang') return undefined;
      if (mock.aiMode === 'quota') return json({ success: false, message: 'Every Gemini key has reached its limit; try again later.' }, 429);
      if (mock.aiMode === 'invalid') return json({ success: true, reply: 'Sorry, I can only answer in plain words: the candidate is great.' });
      if (mock.fail429 > 0) { mock.fail429 -= 1; return json({ success: false, message: 'Every Gemini key is busy; try again shortly.' }, 429); }
      const prompt = (data.turns || []).at(-1)?.text || '';
      mock.prompts.push(prompt);
      return json({ success: true, reply: aiReply(prompt) });
    }
    if (url.pathname === '/api/extension/apply/documents') {
      return json({ success: true, documents: { folder: 'C:\\test-folder', resume: { filename: 'Ana_Test_CV.pdf', base64: pdf }, coverLetter: { filename: 'Ana_Test_Cover.pdf', base64: pdf } } });
    }
    if (url.pathname === '/api/extension/apply/propose-answers') {
      mock.proposals.push(data);
      return json({ success: true, results: (data.items || []).map((item) => ({ question: item.question, ok: true })) });
    }
    if (url.pathname === '/api/extension/apply/review') { mock.reviews.push({ at, ...data }); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/submitted') { mock.submitted.push({ at, ...data }); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/result') { mock.results.push({ at, ...data }); return json({ success: true, result: data.submitted ? 'confirmed' : 'failed' }); }
    if (url.pathname === '/api/extension/apply/release') { mock.released.push({ at, ...data }); return json({ success: true }); }
    if (url.pathname === '/api/extension/browsers/heartbeat') {
      return json({ success: true, generationStopVersion: 0, applyStopVersion: mock.stopVersion, minWorkExtensionVersion: '1.36.0' });
    }
    return json({ success: true });
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeoutMs, label) {
  if (process.env.QTS_E2E_TRACE) console.log(`[trace] waiting: ${label}`);
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(250);
  }
}

// The worker driven through its own debugging session, so a new worker (after a restart) is reached
// with a new session where an old handle would hang.
async function connectWorker(target) {
  const session = await target.createCDPSession();
  // A worker that just started may wait for its debugger before running: let it run.
  await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
  return {
    target,
    // A worker that never answers fails the test in 30 s instead of hanging the run.
    evaluate: (fn, ...args) => Promise.race([
      session.send('Runtime.evaluate', {
        expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
      }).then((reply) => {
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
        return reply.result.value;
      }),
      sleep(30000).then(() => { throw new Error('the extension worker did not answer within 30 s'); }),
    ]),
  };
}

async function launch({ ai = 'off' } = {}) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: !HEADFUL, pipe: true, protocolTimeout: 600000, defaultViewport: HEADFUL ? null : { width: 1280, height: 900 },
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run', '--window-size=1300,950'],
  });
  if (process.env.QTS_E2E_TRACE) console.log('[trace] launched');
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
  if (process.env.QTS_E2E_TRACE) console.log('[trace] worker target');
  const extensionId = new URL(target.url()).host;
  const ctx = { browser, extensionId, worker: await connectWorker(target) };
  // A worker reached right after Chrome starts may not have run its scripts yet: wait until it has.
  await until(() => Promise.race([
    ctx.worker.evaluate(() => typeof chrome !== 'undefined' && Boolean(self.__qtsAutoApply)).catch(() => false),
    sleep(3000).then(() => false),
  ]), 30000, 'the extension worker to load');
  if (process.env.QTS_E2E_TRACE) console.log('[trace] worker connected');
  await ctx.worker.evaluate(async (base, choice) => {
    await chrome.storage.local.set({
      qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
      qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' }, qtsApplyDebug: true, qtsBrowserName: 'E2E Chrome', qtsAutoApplyAi: choice,
    });
  }, BASE, ai);
  if (process.env.QTS_E2E_TRACE) console.log('[trace] storage set');
  // An extension page to send the panel's actions from, as the launcher does.
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup/popup.html`).catch(() => {});
  if (process.env.QTS_E2E_TRACE) console.log('[trace] control page');
  ctx.action = (name) => control.evaluate((a) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: a }), name);
  ctx.storage = (keys) => ctx.worker.evaluate((k) => chrome.storage.local.get(k), keys);
  ctx.phase = async () => (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0]?.phase;
  // The worker stops (restarted, updated, asleep) and a new one wakes (here: the popup opened).
  ctx.restartWorker = async () => {
    await ctx.worker.evaluate(() => { self.__beforeStop = true; });
    const cdp = await browser.target().createCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets');
    const running = targetInfos.find((info) => info.type === 'service_worker' && info.url.includes('service-worker.js'));
    await cdp.send('Target.closeTarget', { targetId: running.targetId });
    const wake = await browser.newPage();
    await wake.goto(`chrome-extension://${extensionId}/popup/popup.html`).catch(() => {});
    ctx.worker = await until(async () => {
      for (const t of browser.targets().filter((entry) => entry.type() === 'service_worker' && entry.url().includes('service-worker.js'))) {
        const candidate = await connectWorker(t).catch(() => null);
        const fresh = candidate && await Promise.race([
          candidate.evaluate(() => !self.__beforeStop && Boolean(self.__qtsAutoApply)).catch(() => false),
          sleep(3000).then(() => false),
        ]);
        if (fresh) return candidate;
      }
      return null;
    }, 30000, 'a new worker');
    await wake.close().catch(() => {});
  };
  return ctx;
}

const formPage = async (browser, prefix = '/form') => (await browser.pages()).find((page) => page.url().startsWith(`${BASE}${prefix}`));

// The review panel is in a closed shadow root: its buttons are found through the DevTools protocol
// and clicked with the real mouse, as the Manager would.
async function panelNodes(page) {
  const client = await page.createCDPSession();
  const { root: doc } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  return { client, doc };
}
async function clickPanelButton(page, label) {
  const { client, doc } = await panelNodes(page);
  try {
    const found = [];
    const walk = (node) => {
      if (node.nodeName === 'BUTTON') found.push(node);
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    };
    walk(doc);
    for (const node of found) {
      const { outerHTML } = await client.send('DOM.getOuterHTML', { nodeId: node.nodeId });
      if (outerHTML.replace(/<[^>]+>/g, '').trim() !== label) continue;
      const { model } = await client.send('DOM.getBoxModel', { nodeId: node.nodeId });
      const [x1, y1, , , x3, y3] = model.content;
      await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
      return true;
    }
    return false;
  } finally {
    await client.detach().catch(() => {});
  }
}
async function panelText(page) {
  const { client, doc } = await panelNodes(page);
  try {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === 3) text += `${node.nodeValue} `;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    };
    const host = (function find(node) {
      if (node.attributes?.includes('data-qts-apply-review')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const hit = find(child); if (hit) return hit; }
      return null;
    })(doc);
    if (host) walk(host);
    return text.replace(/\s+/g, ' ');
  } finally {
    await client.detach().catch(() => {});
  }
}
const shot = async (page, name) => { if (SHOTS && page) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {}); };
const tokens = (text) => Math.round(String(text).length / 4);

test.before(() => new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve)));
// Chrome keeps connections open: they are closed so the server (and the test run) can end.
test.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

test('Stage B: Auto Apply fills a three-step form from the profile, documents and approved answers, without AI, and waits for the Manager\'s Submit', { skip, timeout: 300000 }, async () => {
  resetMock({ queue: [application(1)] });
  const { browser, action, storage, phase } = await launch({ ai: 'off' });
  const timings = {};
  try {
    const started = Date.now();
    const reply = await action('auto_apply');
    assert.equal(reply.ok, true, reply.error);
    assert.equal((await storage(['qtsApplyKind'])).qtsApplyKind, 'auto');

    // Step 1 is filled and goes on by itself; step 2 stops: a required question nothing answers.
    const form = await until(() => formPage(browser), 30000, 'the form tab');
    await until(async () => (await phase()) === 'needs_you', 120000, 'step 2 to need the Manager');
    timings.toStep2Review = Date.now() - started;
    const run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState.runs[0];
    const step1 = await form.evaluate(() => ({
      fn: document.getElementById('fn').value, ln: document.getElementById('ln').value, em: document.getElementById('em').value, ph: document.getElementById('ph').value,
      resume: document.getElementById('cv').files.length, resumeName: document.getElementById('cv').files[0]?.name, cover: document.getElementById('cvl').files.length,
      step2: document.getElementById('step2').style.display !== 'none',
      hear: document.getElementById('hear').value, office: document.querySelector('input[name=office]:checked')?.value || null,
      mot: document.getElementById('mot').value, extra: document.getElementById('extra').value,
    }));
    assert.deepEqual([step1.fn, step1.ln, step1.em], ['Ana', 'Test', 'ana.test@example.com']);
    assert.match(step1.ph, /264484948/);
    assert.deepEqual([step1.resume, step1.cover], [1, 1]);
    assert.equal(step1.resumeName, 'Ana_Test_CV.pdf');
    assert.equal(step1.step2, true, 'step 1 went on to step 2 by itself');
    assert.equal(step1.hear, 'LinkedIn', 'an approved answer in other words');
    assert.equal(step1.office, 'Yes', 'an approved answer for the same question');
    assert.deepEqual([step1.mot, step1.extra], ['', ''], 'nothing invents an answer');
    assert.deepEqual([run.step, run.unresolved >= 2], [2, true]);
    const panel2 = await panelText(form);
    assert.match(panel2, /Left for you \(2\)/);
    assert.match(panel2, /Still empty: "What motivates you in your work\? \*"/);
    await shot(form, 'b-1-step2-needs-you');

    // The Manager writes the answer and clicks Continue on the panel: step 3 (the last one).
    await form.type('#mot', 'Building reliable systems.');
    assert.equal(await clickPanelButton(form, 'Continue →'), true, 'Continue on the panel');
    await until(async () => (await phase()) === 'final', 60000, 'the last step');
    timings.toFinalReview = Date.now() - started;
    const panel3 = await panelText(form);
    assert.match(panel3, /Review, then Submit/);
    assert.match(panel3, /I agree to the privacy policy/, 'the consent box is left for the Manager');
    await shot(form, 'b-2-final-review');

    // Automatic Submit is on for this Manager, yet nothing was submitted: Auto Apply waits.
    await sleep(3000);
    assert.equal(mock.pageSubmitted, 0);
    assert.equal(mock.submitted.length, 0);

    // The Manager ticks the box and clicks the site's Submit: only then is it recorded; Yes makes the bid.
    await form.click('#privacy');
    const clicked = Date.now();
    await form.click('#submit');
    await until(() => mock.submitted.length === 1, 20000, 'the Submit record');
    assert.ok(mock.submitted[0].at >= clicked, 'recorded only after the Manager\'s click');
    await until(async () => /Submitted successfully\?/.test(await panelText(form)), 20000, 'the Yes/No question');
    assert.equal(await clickPanelButton(form, 'Yes, submitted'), true);
    await until(() => mock.results.length === 1, 20000, 'the result');
    timings.total = Date.now() - started;
    assert.equal(mock.results[0].submitted, true);
    assert.equal(mock.pageSubmitted, 1, 'one Submit: the Manager\'s');
    assert.equal(mock.answers, 0, 'no AI with Auto Apply\'s AI off');
    assert.ok(mock.heartbeats >= 2, `heartbeats: ${mock.heartbeats}`);
    assert.equal(mock.released.length, 0);
    const sources = Object.fromEntries((mock.results[0].appliedAnswers || []).map((entry) => [entry.question, entry.source]));
    assert.equal(sources['How did you hear about us? *'], 'reusable');
    assert.equal(sources['First name *'], 'profile');
    console.log(`[auto-apply B timings] ${JSON.stringify({ ...timings, heartbeats: mock.heartbeats })}`);
  } finally {
    await browser.close();
  }
});

test('Stage C: approved answers first, then one Gemini batch for the step (retried after a 429), every answer filled, one the documents do not show provisional until accepted or edited (Submit held till then); corrections proposed as drafts', { skip, timeout: 300000 }, async () => {
  resetMock({ queue: [application(10, 'form-ai')], fail429: 1 });
  const { browser, action, storage, phase } = await launch({ ai: 'gemini' });
  try {
    const started = Date.now();
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/form-ai'), 30000, 'the form tab');
    await until(async () => (await phase()) === 'final', 120000, 'the last step');
    const toReview = Date.now() - started;
    const state = await form.evaluate(() => ({
      fn: document.getElementById('fn').value, hear: document.getElementById('hear').value,
      mot: document.getElementById('mot').value, dj: document.getElementById('dj').value,
      cloud: document.getElementById('cloud').value, extra: document.getElementById('extra').value, privacy: document.getElementById('privacy').checked,
    }));
    // Step 1: the profile and an approved answer, no AI. Step 2: one AI batch; supported answers filled.
    assert.deepEqual([state.fn, state.hear], ['Ana', 'LinkedIn']);
    assert.match(state.mot, /Python payment services on AWS/);
    assert.equal(state.cloud, 'AWS');
    // Filled too, though the documents do not show them: 9 years (the profile says 6) and a
    // certification only the job names.
    assert.deepEqual([state.dj, state.extra, state.privacy], ['9', 'I am a certified Kubernetes administrator.', false]);
    assert.equal(mock.prompts.length, 1, 'one AI batch for the step');
    assert.equal(mock.answers, 2, 'the 429 was tried once more');
    const prompt = mock.prompts[0];
    assert.doesNotMatch(prompt, /ana\.test@example\.com|264484948/, 'no contact details in the prompt');
    const asked = JSON.parse(prompt.slice(prompt.lastIndexOf('Questions:\n') + 11).split('\n')[0]).map((q) => q.question);
    assert.deepEqual(asked, ['What motivates you in your work? *', 'How many years of experience with Django do you have? *', 'Which cloud platform have you used most?', 'Anything else you would like to share?'],
      'only the open questions are sent; the profile and approved answers covered the rest');
    assert.match(prompt, /What motivates you/);
    const panel = await until(async () => { const text = await panelText(form); return /Provisional Gemini answers/.test(text) ? text : null; }, 20000, 'the review with its provisional answers').catch(() => panelText(form));
    assert.match(panel, /Provisional Gemini answers: accept or edit 2 of 2 before Submit/);
    assert.match(panel, /How many years of experience with Django do you have\? \* = "9" · step 2 · it says 9\+ years; the profile says 6/);
    assert.match(panel, /Anything else you would like to share\? = "I am a certified Kubernetes administrator\." · step 2 · it names Kubernetes/);
    await shot(form, 'c-1-final-review');

    // The Manager corrects the Django years and proposes the corrections as drafts (never approved here).
    await form.$eval('#dj', (box) => { box.value = ''; });
    await form.type('#dj', '6');
    assert.equal(await clickPanelButton(form, 'Propose my changes'), true);
    await until(() => mock.proposals.length === 1, 20000, 'the proposal');
    const proposed = mock.proposals[0].items.map((item) => `${item.question} = ${item.answer}`);
    assert.ok(proposed.some((entry) => /Django.*= 6$/.test(entry)), proposed.join('; '));
    await until(async () => /sent to Super Admin as draft reusable answers/.test(await panelText(form)), 20000, 'the notice');
    await shot(form, 'c-2-proposed');

    // The site's Submit is held while one provisional answer (the certification) is neither accepted
    // nor edited; accepting it lets the Manager's Submit through.
    await form.click('#privacy');
    await form.click('#submit');
    await sleep(2000);
    assert.equal(mock.submitted.length, 0, 'Submit held back');
    assert.equal(await form.evaluate(() => window.submitted || 0), 0, 'the page did not submit');
    const held = await panelText(form);
    assert.match(held, /Submit was held: accept or edit each provisional answer first/);
    assert.match(held, /accept or edit 1 of 2 before Submit/, 'the edited Django answer counts as settled');
    assert.equal(await clickPanelButton(form, 'Accept'), true);
    await until(async () => /all 2 accepted or edited/.test(await panelText(form)), 20000, 'every provisional answer settled');
    await shot(form, 'c-3-provisional-settled');
    // Submit stays the Manager's; Yes records the answers with their sources.
    await form.click('#submit');
    await until(() => mock.submitted.length === 1, 20000, 'the Submit record');
    await until(async () => /Submitted successfully\?/.test(await panelText(form)), 20000, 'Yes/No');
    assert.equal(await clickPanelButton(form, 'Yes, submitted'), true);
    await until(() => mock.results.length === 1, 20000, 'the result');
    const sources = Object.fromEntries(mock.results[0].appliedAnswers.map((entry) => [entry.question, entry.source]));
    assert.equal(sources['What motivates you in your work? *'], 'ai');
    assert.equal(sources['How many years of experience with Django do you have? *'], 'manager');
    assert.equal(mock.answers, 2, 'no AI request after the review');
    const last = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState.last;
    console.log(`[auto-apply C] ${JSON.stringify({ toFinalReviewMs: toReview, aiBatches: mock.prompts.length, aiHttpRequests: mock.answers, promptChars: prompt.length, promptTokensEst: tokens(prompt), aiCallsCounted: last?.aiCalls, accuracy: '4/4 filled (2 provisional: 1 edited, 1 accepted before Submit)' })}`);
  } finally {
    await browser.close();
  }
});

test('restart recovery: a restarted worker goes on at the same step in the same tab without asking the AI again, and after Submit only asks Yes/No', { skip, timeout: 300000 }, async () => {
  resetMock({ queue: [application(20, 'form-ai')] });
  const ctx = await launch({ ai: 'gemini' });
  const { browser } = ctx;
  try {
    assert.equal((await ctx.action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/form-ai'), 30000, 'the form tab');
    await until(async () => (await ctx.phase()) === 'final', 120000, 'the last step');
    const aiBefore = mock.answers;
    const stored = (await ctx.storage(['qtsAutoApplyRuns'])).qtsAutoApplyRuns[attempt(20)];
    assert.deepEqual([stored.step, stored.phase, stored.submitted], [2, 'final', false]);

    // The Manager starts typing; then the worker stops: everything in memory is gone. A new one (the
    // queue alarm) takes it up again.
    // (Over the AI's filled answer: the Manager replaces it.)
    await form.$eval('#extra', (box) => { box.value = ''; });
    await form.type('#extra', 'Typed before the restart.');
    const restartedAt = Date.now();
    await ctx.restartWorker();
    await ctx.worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    // The resumed run itself (not the state published before the restart) waiting on the review.
    await until(async () => {
      const run = (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
      return mock.resumes === 1 && run?.resumed === true && run.phase === 'final';
    }, 60000, 'the resumed review');
    const resumeMs = Date.now() - restartedAt;
    assert.equal((await browser.pages()).filter((page) => page.url().startsWith(`${BASE}/form-ai`)).length, 1, 'the same tab, no new one');
    assert.equal(mock.answers, aiBefore, 'no AI request again: answers and refusals kept');
    assert.match(await form.evaluate(() => document.getElementById('mot').value), /Python payment services/);
    assert.match(await panelText(form), /Review, then Submit/);
    await shot(form, 'r-1-resumed');

    // What the Manager changed before the restart stays (the step is not filled again).
    assert.equal(await form.evaluate(() => document.getElementById('extra').value), 'Typed before the restart.');
    // The Manager submits; then the worker restarts again: only Yes/No, the Submit is not recorded again.
    await form.type('#dj', '6');
    await form.click('#privacy');
    await form.click('#submit');
    await until(() => mock.submitted.length === 1, 20000, 'the Submit record').catch(async (error) => {
      console.log('[debug]', JSON.stringify({ phase: await ctx.phase(), runs: (await ctx.storage(['qtsAutoApplyRuns'])).qtsAutoApplyRuns, panel: (await panelText(form)).slice(0, 500), log: mock.log.slice(-10).map((r) => r.path), pageSubmitted: mock.pageSubmitted }));
      throw error;
    });
    await until(async () => (await ctx.storage(['qtsAutoApplyRuns'])).qtsAutoApplyRuns?.[attempt(20)]?.submitted === true, 20000, 'the stored Submit');
    await ctx.restartWorker();
    await ctx.worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    await until(async () => /Submitted successfully\?/.test(await panelText(form)), 60000, 'Yes/No after the second restart');
    await shot(form, 'r-2-confirm-after-restart');
    assert.equal(await clickPanelButton(form, 'Yes, submitted'), true);
    await until(() => mock.results.length === 1, 20000, 'the result');
    assert.equal(mock.submitted.length, 1, 'Submit recorded once');
    assert.equal(mock.pageSubmitted, 1, 'the site got one Submit, the Manager\'s');
    assert.equal(mock.resumes, 1, 'a submitted application is not taken again');
    await until(async () => !Object.keys((await ctx.storage(['qtsAutoApplyRuns'])).qtsAutoApplyRuns || {}).length, 10000, 'the record removed');
    console.log(`[auto-apply restart] ${JSON.stringify({ resumeMs, aiRequests: mock.answers })}`);
  } finally {
    await browser.close();
  }
});

test('modes, permission, "Apply this page", Cancel and Stop all: refused without Apply or beside another mode; stopped quickly; the job only given back', { skip, timeout: 300000 }, async () => {
  resetMock({ canUseApply: false });
  const ctx = await launch({ ai: 'off' });
  const { browser, action, storage, phase } = ctx;
  const results = {};
  try {
    // No Apply permission for this Manager: Auto Apply does not start.
    const refused = await action('auto_apply');
    assert.equal(refused.ok, false);
    assert.match(refused.error, /not turned on/);

    // Assisted Apply on: Auto Apply is refused, and the other way round.
    mock.canUseApply = true;
    assert.equal((await action('apply')).ok, true);
    assert.match((await action('auto_apply')).error, /Apply is running in this Chrome/);
    await action('cancel_status');
    await until(async () => (await storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 20000, 'Apply off');

    // Auto Apply holds a job: Apply, Generation, and "Apply this page" are refused.
    mock.queue.push(application(2));
    assert.equal((await action('auto_apply')).ok, true);
    await until(async () => (await phase()) === 'needs_you', 120000, 'step 2');
    assert.match((await action('apply')).error, /Auto Apply is running in this Chrome/);
    assert.match((await action('generation')).error, /Apply is running in this Chrome/);
    const jobPage = await browser.newPage();
    await jobPage.goto(`${BASE}/blank`);
    const tabId = await until(() => ctx.worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, `${BASE}/blank`), 10000, 'the job page tab');
    // What the launcher sends, from the page's own tab.
    const ask = (message) => ctx.worker.evaluate(async (id, msg) => (await chrome.scripting.executeScript({
      target: { tabId: id }, func: (m) => chrome.runtime.sendMessage(m), args: [msg],
    }))[0]?.result, tabId, message);
    assert.deepEqual(await ask({ type: 'QTS_APPLY_PAGE_ACCOUNTS' }), { ok: true, applyOn: false, applications: [] });
    const started = await ask({ type: 'QTS_APPLY_PAGE_START', jobId: application(99).job.id });
    assert.equal(started.ok, false);
    assert.match(started.error, /Auto Apply is running in this Chrome/);
    assert.equal(mock.log.filter((entry) => entry.path === '/api/extension/apply/start-job').length, 0, 'no assisted start reached the server');
    await jobPage.close();

    // Stop all on the Jobs page ends the claim: the next Auto Apply heartbeat (every 15 s) sees it,
    // and the application stops at once, given back only.
    mock.heartbeat409 = true;
    const stopAt = Date.now();
    await until(() => mock.released.length === 1, 30000, 'the release after the claim ended');
    results.stopAllViaClaimMs = mock.released[0].at - stopAt;
    assert.deepEqual([mock.released[0].attemptId, mock.released[0].mode], [attempt(2), 'later']);
    await until(async () => !(await formPage(browser)), 20000, 'the form tab to close');
    mock.heartbeat409 = false;
    await action('cancel_status');

    // Stop all through the browser heartbeat's stop counter (another Chrome stopped it all).
    mock.queue.push(application(4));
    assert.equal((await action('auto_apply')).ok, true);
    await until(async () => (await phase()) === 'needs_you', 120000, 'step 2 again');
    await ctx.worker.evaluate(() => sendBrowserHeartbeat());
    mock.stopVersion = 1;
    const counterAt = Date.now();
    await ctx.worker.evaluate(() => sendBrowserHeartbeat());
    await until(() => mock.released.length === 2, 30000, 'the release after Stop all');
    results.stopAllCounterMs = mock.released[1].at - counterAt;
    assert.equal(mock.released[1].mode, 'later');
    const afterStop = await storage(['qtsExtensionStatus', 'qtsApplyKind']);
    assert.notEqual(afterStop.qtsExtensionStatus, 'apply');
    assert.equal(afterStop.qtsApplyKind ?? null, null);

    // Cancel while a step is being filled: interrupted at once, the tab closed, the job given back.
    mock.queue.push(application(3));
    assert.equal((await action('auto_apply')).ok, true);
    await until(async () => (await phase()) === 'filling', 60000, 'filling');
    await sleep(800);
    const cancelAt = Date.now();
    await action('cancel_status');
    await until(() => mock.released.length === 3, 60000, 'the release after Cancel');
    results.cancelMs = mock.released[2].at - cancelAt;
    assert.deepEqual([mock.released[2].attemptId, mock.released[2].mode], [attempt(3), 'later']);
    assert.ok(results.cancelMs < 2000, `Cancel took ${results.cancelMs} ms`);
    assert.equal(mock.submitted.length, 0);

    // The permission taken away: the next claim is refused and Auto Apply stops.
    mock.claimStatus = 403;
    assert.equal((await action('auto_apply')).ok, true);
    await until(async () => (await storage(['qtsExtensionStatus'])).qtsExtensionStatus == null, 30000, 'Auto Apply to stop on 403');
    console.log(`[auto-apply stop timings] ${JSON.stringify(results)}`);
  } finally {
    await browser.close();
  }
});

// ---- Mocked Gemini failures, and ChatGPT as the real AI (Stage C) ----

// Cancel and Stop all at every point that matters: as the form opens, while the AI is asked, the
// moment the review is ready (before it waits for the Manager), during the review, and after the
// worker restarted. Each time: the job given back, no heartbeat for it afterwards (no live claim),
// the form's tab closed, nothing submitted, nothing left to resume, no ChatGPT switch held.
test('Cancel and Stop all at every point: no live claim, no tab left open, nothing submitted', { skip, timeout: 900000 }, async () => {
  resetMock();
  const ctx = await launch({ ai: 'off' });
  const results = {};
  const statusOf = () => ctx.storage(['qtsExtensionStatus']).then((stored) => stored.qtsExtensionStatus);
  // Stop all as another Chrome or the Jobs page does it: the browser heartbeat's stop counter.
  await ctx.worker.evaluate(() => sendBrowserHeartbeat());
  const stopAll = async () => { mock.stopVersion += 1; await ctx.worker.evaluate(() => sendBrowserHeartbeat()); };
  const stop = (how) => (how === 'cancel' ? ctx.action('cancel_status') : stopAll());
  // expectOff: false when only this application's claim ended (Auto Apply goes on with other jobs).
  const check = async (name, n, stoppedAt, { expectOff = true } = {}) => {
    const id = attempt(n);
    const released = await until(() => mock.released.find((entry) => entry.attemptId === id), 40000, `${name}: the job given back`);
    await until(async () => !(await formPage(ctx.browser, '/form')), 20000, `${name}: the form tab closed`);
    if (expectOff) await until(async () => (await statusOf()) !== 'apply', 20000, `${name}: Auto Apply off`);
    // Longer than one Auto Apply heartbeat (15 s): a live claim would be renewed meanwhile.
    await sleep(17000);
    const renewedAfter = mock.heartbeatLog.filter((entry) => entry.attemptId === id && entry.at > released.at).length;
    const stored = await ctx.storage(['qtsAutoApplyRuns']);
    const held = await ctx.worker.evaluate(async () => (await chrome.storage.session.get('qtsAutoApplyChatSwitch')).qtsAutoApplyChatSwitch || null);
    const openTabs = await ctx.worker.evaluate(async (prefix) => (await chrome.tabs.query({})).filter((tab) => tab.url.startsWith(prefix)).length, `${BASE}/form`);
    const outcome = {
      releaseMs: released.at - stoppedAt, mode: released.mode, renewedAfter, openFormTabs: openTabs,
      submitted: mock.submitted.filter((entry) => entry.attemptId === id).length, pageSubmitted: mock.pageSubmitted,
      leftToResume: Object.keys(stored.qtsAutoApplyRuns || {}).length, chatSwitchHeld: Boolean(held),
    };
    results[name] = outcome;
    assert.equal(outcome.mode, 'later', `${name}: only given back`);
    assert.equal(outcome.renewedAfter, 0, `${name}: no heartbeat after the job was given back`);
    assert.equal(outcome.openFormTabs, 0, `${name}: no form tab left`);
    assert.equal(outcome.submitted, 0, `${name}: nothing submitted`);
    assert.equal(outcome.pageSubmitted, 0, `${name}: the site got no Submit`);
    assert.equal(outcome.leftToResume, 0, `${name}: nothing left to resume`);
    assert.equal(outcome.chatSwitchHeld, false, `${name}: no ChatGPT switch held`);
  };
  const begin = async (n, form = 'form') => {
    mock.queue.push(application(n, form));
    assert.equal((await ctx.action('auto_apply')).ok, true);
    return until(() => formPage(ctx.browser, `/${form}`), 30000, `the form tab ${n}`);
  };
  const reachPhase = (wanted, label) => until(async () => wanted.includes(await ctx.phase()), 120000, label);
  try {
    let n = 200;
    for (const how of ['cancel', 'stop']) {
      // 1. As the form opens, before anything is filled.
      await ctx.worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplyAi: 'off' }));
      n += 1;
      await begin(n);
      let at = Date.now();
      await stop(how);
      await check(`${how}: as the form opens`, n, at);

      // 2. While the AI is asked (it never answers here).
      await ctx.worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplyAi: 'gemini', qtsAutoApplyAiLimits: { timeoutMs: 120000 } }));
      mock.aiMode = 'hang';
      n += 1;
      const asked = mock.answers;
      await begin(n, 'form-ai');
      await until(() => mock.answers > asked, 120000, 'the AI asked');
      await sleep(1000);
      at = Date.now();
      await stop(how);
      await check(`${how}: while the AI is asked`, n, at);
      mock.aiMode = 'rules';
      await ctx.worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplyAi: 'off' }));

      // 3. The moment the review is ready, before it waits for the Manager: stopped from inside the
      // worker as the last step's state is published (the race an early Cancel or Stop all ran into).
      n += 1;
      await ctx.worker.evaluate((byCancel) => {
        const onState = (changes, area) => {
          if (area !== 'local' || !['final', 'needs_you'].includes(changes.qtsAutoApplyState?.newValue?.runs?.[0]?.phase)) return;
          chrome.storage.onChanged.removeListener(onState);
          stopWorkSlotLocally();
          self.__stoppedAtFinal = Date.now();
          if (!byCancel) self.__stoppedBy = 'stop';
        };
        chrome.storage.onChanged.addListener(onState);
      }, how === 'cancel');
      await begin(n);
      await until(() => ctx.worker.evaluate(() => self.__stoppedAtFinal || null), 120000, 'stopped at the review');
      at = await ctx.worker.evaluate(() => self.__stoppedAtFinal);
      await ctx.worker.evaluate(() => { delete self.__stoppedAtFinal; });
      await check(`${how}: the moment the review is ready`, n, at);

      // 4. During the review (Stop all here: the claim ended on the Jobs page, seen by the next heartbeat).
      n += 1;
      await begin(n);
      await reachPhase(['final', 'needs_you'], 'the review');
      await sleep(1500);
      at = Date.now();
      if (how === 'cancel') await ctx.action('cancel_status');
      else mock.heartbeat409 = true;
      await check(`${how}: during the review`, n, at, { expectOff: how === 'cancel' });
      mock.heartbeat409 = false;
      if (how === 'stop') {
        await stopAll();
        await until(async () => (await statusOf()) !== 'apply', 20000, 'Auto Apply off after the stop counter');
      }

      // 5. After the worker restarted, at the resumed review.
      n += 1;
      await begin(n);
      await reachPhase(['final', 'needs_you'], 'the review before the restart');
      await sleep(1500);
      await ctx.restartWorker();
      await ctx.worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
      await until(async () => {
        const run = (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
        return run?.resumed && ['final', 'needs_you'].includes(run.phase);
      }, 120000, 'the resumed review');
      const tabs = await ctx.worker.evaluate(async (prefix) => (await chrome.tabs.query({})).filter((tab) => tab.url.startsWith(prefix)).length, `${BASE}/form`);
      assert.equal(tabs, 1, 'the same form tab, not a second one');
      at = Date.now();
      await stop(how);
      await check(`${how}: after a restart`, n, at);
    }
    console.log(`[auto-apply stop points] ${JSON.stringify(results)}`);
  } finally {
    if (Object.keys(results).length) console.log(`[auto-apply stop points partial] ${JSON.stringify(results)}`);
    await ctx.worker.evaluate(() => chrome.storage.local.remove('qtsAutoApplyAiLimits')).catch(() => {});
    await ctx.browser.close();
  }
});

test('Gemini failures (mocked): invalid JSON, quota exhausted, no answer in time, request budget; each ends at the review with the questions left for the Manager', { skip, timeout: 420000 }, async () => {
  resetMock();
  const ctx = await launch({ ai: 'gemini' });
  const cases = {};
  const runCase = async (name, n, { aiMode, limits = {} }) => {
    mock.aiMode = aiMode;
    await ctx.worker.evaluate((value) => chrome.storage.local.set({ qtsAutoApplyAiLimits: value }), limits);
    mock.queue.push(application(n, 'form-ai'));
    const before = mock.answers;
    const started = Date.now();
    assert.equal((await ctx.action('auto_apply')).ok, true);
    const form = await until(() => formPage(ctx.browser, '/form-ai'), 30000, `${name}: the form tab`);
    await until(async () => ['final', 'needs_you'].includes(await ctx.phase()), 180000, `${name}: the review`);
    const values = await form.evaluate(() => ({ mot: document.getElementById('mot').value, dj: document.getElementById('dj').value, cloud: document.getElementById('cloud').value }));
    const panel = await panelText(form);
    cases[name] = { ms: Date.now() - started, requests: mock.answers - before, values, panel: (panel.match(/(Gemini did not answer[^)]*\)|Fill by hand: "[^"]+"[^.]*)/g) || []).slice(0, 2) };
    if (process.env.QTS_E2E_TRACE) console.log(`[trace] case ${name}: ${JSON.stringify(cases[name])}${cases[name].panel.length ? '' : ` panel: ${panel.replace(/^.*?Review/s, 'Review').slice(0, 700)}`}`);
    await shot(form, `e-${name}`);
    await ctx.action('cancel_status');
    await until(async () => (await ctx.storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 30000, `${name}: off`);
    await until(async () => !(await formPage(ctx.browser, '/form-ai')), 20000, `${name}: tab closed`);
    return cases[name];
  };
  try {
    // Not JSON: the follow-up asks once more, then the required questions are the Manager's.
    const invalid = await runCase('invalid-json', 40, { aiMode: 'invalid' });
    assert.equal(invalid.requests, 2, 'the answer and one follow-up');
    assert.deepEqual([invalid.values.mot, invalid.values.dj, invalid.values.cloud], ['', '', '']);
    assert.ok(invalid.panel.length, 'the review says what was not answered');
    // Quota exhausted (429 every time): tried twice more after 3 s and 10 s, then left for the Manager.
    const quota = await runCase('quota', 41, { aiMode: 'quota' });
    assert.equal(quota.requests, 3);
    assert.ok(quota.ms >= 13000, `${quota.ms} ms`);
    assert.match(quota.panel.join(' '), /Gemini did not answer/);
    // No answer in time (5 s here): the same bounded retries, never a stall.
    const hang = await runCase('timeout', 42, { aiMode: 'hang', limits: { timeoutMs: 5000 } });
    assert.equal(hang.requests, 3);
    assert.match(hang.panel.join(' '), /Gemini did not answer.*did not answer in time/);
    // The application's request budget (1 here) stops the follow-up a bad reply would need.
    const budget = await runCase('budget', 43, { aiMode: 'invalid', limits: { budget: 1 } });
    assert.equal(budget.requests, 1);
    assert.match(budget.panel.join(' '), /limit of 1 AI requests/);
    assert.equal(mock.submitted.length, 0);
    console.log(`[auto-apply gemini mock] ${JSON.stringify(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, { ms: v.ms, requests: v.requests }])))}`);
  } finally {
    await ctx.worker.evaluate(() => chrome.storage.local.remove('qtsAutoApplyAiLimits')).catch(() => {});
    await ctx.browser.close();
  }
});

// Three steps: details (profile and two approved answers); questions for the AI (what the résumé
// supports, what it does not); the Python question again (answered from the application's cache).
const FORM_GPT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Initech - Apply</title></head><body>
<form onsubmit="event.preventDefault(); fetch('/page-submitted', { method: 'POST' }); window.submitted = (window.submitted || 0) + 1;">
 <div id="s1">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required></div>
  <div><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option>Indeed</option><option>LinkedIn</option></select></div>
  <fieldset><legend>Will you require visa sponsorship now or in the future? *</legend><label><input type="radio" name="visa" value="Yes">Yes</label><label><input type="radio" name="visa" value="No">No</label></fieldset>
  <button type="button" id="n1">Next</button>
 </div>
 <div id="s2" style="display:none">
  <div><label for="why">Why do you want to work at Initech? *</label><textarea id="why" required maxlength="600"></textarea></div>
  <div><label for="py">How many years of professional Python experience do you have? *</label><input id="py" type="number" required></div>
  <div><label for="db">Which database have you used the most? *</label><select id="db" required><option value="">Select…</option><option>PostgreSQL</option><option>MongoDB</option><option>Oracle</option></select></div>
  <div><label for="cka">Do you hold a Certified Kubernetes Administrator (CKA) certification? *</label><select id="cka" required><option value="">Select…</option><option>Yes</option><option>No</option></select></div>
  <div><label for="rust">How many years of experience with Rust do you have?</label><input id="rust" type="number"></div>
  <div><label for="led">Describe a project you led. *</label><textarea id="led" required maxlength="800"></textarea></div>
  <button type="button" id="n2">Next</button>
 </div>
 <div id="s3" style="display:none">
  <div><label for="py2">How many years of professional Python experience do you have? *</label><input id="py2" type="number" required></div>
  <div><label><input type="checkbox" id="privacy" required> I agree to the privacy policy *</label></div>
  <button type="submit" id="submit">Submit application</button>
 </div>
</form>
<script>
  const show = (n) => { for (const i of [1, 2, 3]) document.getElementById('s' + i).style.display = i === n ? '' : 'none'; };
  document.getElementById('n1').addEventListener('click', () => { if (document.getElementById('fn').value && document.getElementById('cv').files.length && document.getElementById('hear').value && document.querySelector('input[name=visa]:checked')) show(2); });
  document.getElementById('n2').addEventListener('click', () => { if (['why', 'py', 'db', 'cka', 'led'].every((id) => document.getElementById(id).value)) show(3); });
</script></body></html>`;
const RESUME_GPT = `Ana Test — Backend Engineer
Experience
- Backend Engineer, Fintech Co. (2019–2026): Python, Django, PostgreSQL, AWS. Led a team of 4 that rebuilt the payments API, cutting failures by 30%.
- Junior Developer, Web Agency (2018–2019): Python, JavaScript.
Skills: Python (7 years), Django, PostgreSQL, Redis, AWS, Docker.`;
const gptApplication = (n) => {
  const base = application(n, 'form-gpt');
  return {
    ...base,
    job: { ...base.job, url: `${BASE}/form-gpt?job=${n}`, company: 'Initech', resumeText: RESUME_GPT,
      description: 'Initech builds payment software. We need a backend engineer with 5+ years of Python, Django and PostgreSQL, experience on AWS, and ideally Kubernetes and Rust.',
      coverLetterText: 'Dear Hiring Manager,\nI would like to bring my payments experience to Initech.\nKind regards,\nAna Test' },
    candidate: { ...base.candidate, yearsOfExperience: 7 },
    savedAnswers: [...APPROVED, { questionKey: 'do you require visa sponsorship', questionText: 'Do you require visa sponsorship?', answer: 'No', note: null, scope: 'everyone' }],
  };
};

// The real AI locally: this Chrome's own ChatGPT tab (logged out), with the synthetic candidate only.
// Talks to chatgpt.com, so it runs only with QTS_E2E_CHATGPT=1. Accuracy is scored against what the
// synthetic résumé supports; the time of each part (tab, sending, answer) is measured.
test('ChatGPT (real AI, optional): approved answers first, one request per step, checked answers, the cache on a repeated question, review before Submit', {
  skip: skip || (process.env.QTS_E2E_CHATGPT === '1' ? false : 'set QTS_E2E_CHATGPT=1 to talk to chatgpt.com'),
  timeout: 900000,
}, async () => {
  resetMock({ queue: [gptApplication(50)] });
  const ctx = await launch({ ai: 'chatgpt' });
  try {
    const started = Date.now();
    assert.equal((await ctx.action('auto_apply')).ok, true);
    const form = await until(() => formPage(ctx.browser, '/form-gpt'), 30000, 'the form tab');
    const reached = await until(async () => {
      const run = (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
      return ['final', 'needs_you'].includes(run?.phase) && run.step >= 2 ? run : null;
    }, 780000, 'the review after ChatGPT');
    const values = await form.evaluate(() => Object.fromEntries(['fn', 'hear', 'why', 'py', 'db', 'cka', 'rust', 'led', 'py2'].map((id) => [id, document.getElementById(id).value]).concat([['visa', document.querySelector('input[name=visa]:checked')?.value || '']])));
    const run = (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState.runs[0];
    const panel = await panelText(form);
    await shot(form, 'g-1-review');
    const chatTab = (await ctx.browser.pages()).find((page) => /chatgpt\.com/.test(page.url()));
    if (chatTab) await shot(chatTab, 'g-2-chatgpt-tab');

    // Scoring: what the résumé supports is filled right; what it does not is never claimed.
    const checks = {
      'approved: how did you hear': values.hear === 'LinkedIn',
      'approved: visa sponsorship': values.visa === 'No',
      'why Initech: written and checked': values.why.length > 40,
      'Python years = 7': values.py === '7',
      'database = PostgreSQL': values.db === 'PostgreSQL',
      'CKA: never "Yes"': values.cka !== 'Yes',
      'Rust: no invented years': !values.rust || values.rust === '0',
      'project led: from the résumé': /payment|team of 4|30\s?%/i.test(values.led),
    };
    const outcome = {
      reachedStep: reached.step,
      phase: run.phase,
      totalMs: Date.now() - started,
      aiCalls: run.aiCalls,
      aiTimings: run.aiTimings,
      steps: run.steps,
      cacheOnStep3: { py2: values.py2, aiCallsAfterStep2: (run.steps.find((s) => s.step === 2) || {}).aiCalls, aiCallsAtEnd: run.aiCalls },
      accuracy: `${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`,
      checks,
      values,
      panelSays: (panel.match(/(ChatGPT did not answer[^)]*\)|Review "[^"]+": ChatGPT's answer was not filled[^.]*\.|not filled: [^·]+)/g) || []).slice(0, 6),
      geminiRequests: mock.answers,
    };
    console.log(`[auto-apply chatgpt] ${JSON.stringify(outcome)}`);
    assert.equal(mock.answers, 0, 'Gemini was not used');
    assert.equal(mock.pageSubmitted, 0, 'nothing submitted: the Manager submits');
    assert.equal(checks['approved: how did you hear'] && checks['approved: visa sponsorship'], true, 'approved answers came first');
    // A claim the résumé does not show may be filled now, but stays provisional for the Manager.
    if (!checks['CKA: never "Yes"']) assert.match(panel, /Provisional ChatGPT answers[\s\S]*CKA/i, 'an unsupported certification is provisional');
    if (!checks['Rust: no invented years']) assert.match(panel, /Provisional ChatGPT answers[\s\S]*Rust/i, 'invented Rust years are provisional');
  } finally {
    await ctx.browser.close();
  }
});

// ---- "Focus ChatGPT while answering" (Auto Apply only) ----

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
// The tab shown in the Apply window, by its address.
const shownTab = (ctx) => ctx.worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? { id: tab.id, url: tab.url } : null;
});
const autoRun = async (ctx) => (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0] || null;
const lastRun = async (ctx) => (await ctx.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.last || null;
const chatRound = (run) => (run?.aiTimings || []).find((entry) => entry.phase === 'chatgpt') || {};
async function stopAutoApply(ctx, prefix) {
  await ctx.action('cancel_status');
  await until(async () => (await ctx.storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 30000, 'Auto Apply off');
  await until(async () => !(await formPage(ctx.browser, prefix)), 30000, 'the form tab to close');
}

// Where the Manager is while ChatGPT answers, run by run in one Chrome (the same logged-out ChatGPT,
// the same synthetic candidate, form and questions), each part of the round timed:
//   focused   - the Apply window has the keyboard, ChatGPT's tab selected in it;
//   unfocused - another window has the keyboard (beside the Apply window), ChatGPT's tab selected;
//   hidden    - focus off: ChatGPT answers in a tab its window does not show;
//   covered   - (only when named in QTS_E2E_BENCH_CONDITIONS) like unfocused, but the other window
//               covers the Apply window, as a maximised editor would;
//   minimized - (only when named) the Apply window minimised, ChatGPT's tab selected in it.
// What ChatGPT's page itself saw (document.visibilityState) is sampled during the answer. Talks to
// chatgpt.com, so it runs only with QTS_E2E_CHATGPT_BENCH=<runs per condition>; QTS_E2E_BENCH_OUT=<file>
// keeps every run's numbers.
test('ChatGPT focus benchmark (optional): window focused, window not focused, tab hidden, each part of the round timed', {
  skip: skip || (Number(process.env.QTS_E2E_CHATGPT_BENCH) > 0 ? false : 'set QTS_E2E_CHATGPT_BENCH=<runs per condition> to talk to chatgpt.com'),
  timeout: 6 * 3600 * 1000,
}, async () => {
  const perCondition = Number(process.env.QTS_E2E_CHATGPT_BENCH);
  const conditions = (process.env.QTS_E2E_BENCH_CONDITIONS || 'focused,unfocused,hidden').split(',').map((name) => name.trim()).filter(Boolean);
  resetMock();
  const ctx = await launch({ ai: 'chatgpt' });
  const windows = (action, ...args) => ctx.worker.evaluate(async (name, values) => {
    const [mainId, otherId, url] = values;
    if (name === 'setup') {
      const [main] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      await chrome.windows.update(main.id, { state: 'normal', left: 0, top: 0, width: 1000, height: 900 });
      const other = await chrome.windows.create({ url, left: 1010, top: 0, width: 500, height: 500, focused: false });
      return [main.id, other.id];
    }
    if (name === 'beside') {
      await chrome.windows.update(mainId, { state: 'normal' });
      await chrome.windows.update(mainId, { left: 0, top: 0, width: 1000, height: 900 });
      return chrome.windows.update(otherId, { left: 1010, top: 0, width: 500, height: 500 });
    }
    if (name === 'cover') return chrome.windows.update(otherId, { left: 0, top: 0, width: 1000, height: 900, focused: true });
    if (name === 'minimize') return chrome.windows.update(mainId, { state: 'minimized' });
    return mainId;
  }, action, args);
  const focusWindow = (id) => ctx.worker.evaluate((windowId) => chrome.windows.update(windowId, { focused: true }), id);
  const runs = [];
  try {
    const [mainId, otherId] = await windows('setup', null, null, `${BASE}/blank`);
    // QTS_E2E_BENCH_STALL_LIMIT=<n>: a condition that ran into the 3-minute limit n times is not run again.
    const stallLimit = Number(process.env.QTS_E2E_BENCH_STALL_LIMIT) || Infinity;
    for (let i = 0; i < perCondition * conditions.length; i += 1) {
      const condition = conditions[i % conditions.length];
      if (runs.filter((entry) => entry.condition === condition && /within 3 minutes|timed out/.test(entry.error || '')).length >= stallLimit) continue;
      await ctx.worker.evaluate((value) => chrome.storage.local.set({ qtsAutoApplyChatFocus: value }), condition !== 'hidden');
      // The application opens in the main window (the one with the keyboard when it is claimed).
      await windows('beside', mainId, otherId);
      await focusWindow(mainId);
      mock.queue.push(gptApplication(100 + i));
      const started = Date.now();
      assert.equal((await ctx.action('auto_apply')).ok, true);
      const form = await until(() => formPage(ctx.browser, '/form-gpt'), 30000, 'the form tab');
      // The Manager looks at the application, then (unfocused, covered) goes to another window.
      await form.bringToFront();
      if (condition === 'unfocused') await focusWindow(otherId);
      if (condition === 'covered') await windows('cover', mainId, otherId);
      if (condition === 'minimized') await windows('minimize', mainId, otherId);
      const seen = { visible: 0, hidden: 0 };
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const run = await autoRun(ctx).catch(() => null);
          const chat = run?.phase === 'ai' ? (await ctx.browser.pages()).find((page) => /chatgpt\.com/.test(page.url())) : null;
          const state = chat ? await Promise.race([chat.evaluate(() => document.visibilityState).catch(() => null), sleep(2000).then(() => null)]) : null;
          if (state) seen[state === 'visible' ? 'visible' : 'hidden'] += 1;
          await sleep(1500);
        }
      })();
      let failure = null;
      await until(async () => {
        const run = await autoRun(ctx);
        return ['final', 'needs_you'].includes(run?.phase) && run.step >= 2;
      }, 480000, 'the review').catch((error) => { failure = error.message; });
      sampling = false;
      await sampler;
      const run = await autoRun(ctx) || await lastRun(ctx);
      const round = chatRound(run);
      const values = await form.evaluate(() => ({ py: document.getElementById('py').value, db: document.getElementById('db').value, cka: document.getElementById('cka').value, rust: document.getElementById('rust').value, why: document.getElementById('why').value })).catch(() => ({}));
      const checks = [values.py === '7', values.db === 'PostgreSQL', values.cka !== 'Yes', !values.rust || values.rust === '0', (values.why || '').length > 40];
      const shownAfter = await ctx.worker.evaluate(async (windowId) => (await chrome.tabs.query({ windowId, active: true }))[0]?.url || null, mainId);
      // What actually happened, whatever was intended: the tab selected or not, the window focused or not.
      const actual = !round.focused ? 'hidden' : round.windowFocused && round.windowFocusedEnd ? 'focused' : !round.windowFocused && !round.windowFocusedEnd ? 'unfocused' : 'mixed';
      const entry = {
        run: i + 1, condition, actual, ok: round.ok === true && !failure, tabSelected: round.focused === true, restored: round.restored === true,
        windowFocused: round.windowFocused, windowFocusedEnd: round.windowFocusedEnd, chatPageSaw: seen, formShownAfter: /\/form-gpt/.test(shownAfter || ''),
        prepareMs: round.prepareMs, sendMs: round.sendMs, answerMs: round.answerMs, parseMs: round.parseMs, roundMs: round.totalMs,
        step2Ms: (run?.steps || []).find((s) => s.step === 2)?.ms, totalMs: Date.now() - started,
        accuracy: `${checks.filter(Boolean).length}/${checks.length}`, error: round.error || failure || null,
      };
      runs.push(entry);
      console.log(`[focus bench] ${JSON.stringify(entry)}`);
      // A form left open after Cancel is recorded (with what the extension was doing), then closed here.
      await stopAutoApply(ctx, '/form-gpt').catch(async (error) => {
        const state = await ctx.storage(['qtsExtensionStatus', 'qtsAutoApplyState', 'qtsApplyKind']).catch(() => ({}));
        entry.cleanup = { error: error.message, status: state.qtsExtensionStatus ?? null, kind: state.qtsApplyKind ?? null, running: (state.qtsAutoApplyState?.runs || []).map((r) => r.phase), last: state.qtsAutoApplyState?.last?.reason || null };
        console.log(`[focus bench cleanup] ${JSON.stringify({ run: entry.run, ...entry.cleanup })}`);
        const left = await formPage(ctx.browser, '/form-gpt');
        if (left) await left.close().catch(() => {});
        await ctx.action('cancel_status').catch(() => {});
        await until(async () => (await ctx.storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 30000, 'Auto Apply off');
      });
    }
  } finally {
    const summarize = (mine) => {
      const ok = mine.filter((entry) => entry.ok);
      const stat = (key) => ({ median: median(ok.map((entry) => entry[key])), slowest: ok.length ? Math.max(...ok.map((entry) => entry[key] || 0)) : null });
      return {
        runs: mine.length, succeeded: ok.length, successRate: mine.length ? `${Math.round((ok.length / mine.length) * 100)}%` : null,
        tabSelected: mine.filter((entry) => entry.tabSelected).length, restored: mine.filter((entry) => entry.restored).length,
        chatPageVisibleSamples: mine.reduce((sum, entry) => sum + entry.chatPageSaw.visible, 0), chatPageHiddenSamples: mine.reduce((sum, entry) => sum + entry.chatPageSaw.hidden, 0),
        prepareMs: stat('prepareMs'), sendMs: stat('sendMs'), answerMs: stat('answerMs'), parseMs: stat('parseMs'), roundMs: stat('roundMs'), totalMs: stat('totalMs'),
        slowestAny: mine.length ? Math.max(...mine.map((entry) => entry.totalMs || 0)) : null,
        accuracy: ok.map((entry) => entry.accuracy),
        errors: mine.filter((entry) => !entry.ok).map((entry) => entry.error),
      };
    };
    const byIntended = Object.fromEntries(conditions.map((name) => [name, summarize(runs.filter((entry) => entry.condition === name))]));
    const byActual = Object.fromEntries([...new Set(runs.map((entry) => entry.actual))].map((name) => [name, summarize(runs.filter((entry) => entry.actual === name))]));
    console.log(`[focus bench summary] ${JSON.stringify({ byIntended, byActual })}`);
    if (process.env.QTS_E2E_BENCH_OUT) fs.writeFileSync(process.env.QTS_E2E_BENCH_OUT, JSON.stringify({ runs, byIntended, byActual }, null, 1));
    await ctx.browser.close();
  }
});

// The focus rules with a real ChatGPT tab: the Manager's own tab is never taken away; Cancel, Stop
// all, a ChatGPT page failure, and a restart leave the application's tab shown (or the Manager's).
test('ChatGPT focus (optional): manual switching, Cancel, Stop all, a ChatGPT page failure, a restart', {
  skip: skip || (process.env.QTS_E2E_CHATGPT === '1' ? false : 'set QTS_E2E_CHATGPT=1 to talk to chatgpt.com'),
  timeout: 3600 * 1000,
}, async () => {
  resetMock();
  const ctx = await launch({ ai: 'chatgpt' });
  const results = {};
  // The Manager's own tab, shown when each application starts (as a person would be on the Jobs
  // page): the form opens from it, so closing the form shows it again.
  const home = await ctx.browser.newPage();
  await home.goto(`${BASE}/blank?home=1`);
  const start = async (n) => {
    await home.bringToFront();
    mock.queue.push(gptApplication(n));
    assert.equal((await ctx.action('auto_apply')).ok, true);
    const form = await until(() => formPage(ctx.browser, '/form-gpt'), 30000, 'the form tab');
    await form.bringToFront();
    return form;
  };
  const waitAsking = () => until(async () => {
    const run = await autoRun(ctx);
    return run?.phase === 'ai' && run.ai?.focused ? run : null;
  }, 240000, 'ChatGPT asked with its tab shown');
  const aiDone = () => until(async () => {
    const run = await autoRun(ctx);
    return run && run.phase !== 'ai' && run.step >= 2 && run.phase !== 'filling' ? run : null;
  }, 480000, 'the AI round to end');
  try {
    // Every tab shown in this Chrome, in order, and every give-back of the application's tab: printed with the results.
    // Also every tab, window, and debugger call the extension makes, with where it was made from.
    await ctx.worker.evaluate(() => {
      self.__shown = [];
      const t0 = Date.now();
      const log = (line) => self.__shown.push(`${Date.now() - t0}ms ${line}`);
      chrome.tabs.onActivated.addListener(async ({ tabId }) => { const t = await chrome.tabs.get(tabId).catch(() => null); log(`shown: ${t ? t.url.slice(0, 45) : tabId}`); });
      const giveBack = giveBackChatTab;
      self.giveBackChatTab = async (id) => { const r = await giveBack(id); log(`give back ${(id || 'after restart').slice(-3)}: ${r}`); return r; };
      const where = () => (new Error().stack || '').split('\n').slice(3, 6).map((line) => line.trim().replace(/chrome-extension:\/\/[a-z]+\//, '')).join(' < ');
      for (const [api, name, key] of [[chrome.tabs, 'tabs', 'update'], [chrome.tabs, 'tabs', 'highlight'], [chrome.windows, 'windows', 'update'], [chrome.debugger, 'debugger', 'attach']]) {
        const call = api[key].bind(api);
        api[key] = (...args) => { log(`${name}.${key} ${JSON.stringify(args.slice(0, 2)).slice(0, 90)} @ ${where()}`); return call(...args); };
      }
    });
    // 1. Another tab is shown while ChatGPT answers (the Manager's click): ChatGPT's tab comes back
    // within about a second, and the application's tab after the answer.
    let form = await start(60);
    await waitAsking();
    const other = await ctx.browser.newPage();
    await other.goto(`${BASE}/blank`);
    await other.bringToFront();
    const clickedAt = Date.now();
    const back = await until(async () => {
      if (/chatgpt\.com/.test((await shownTab(ctx))?.url || '')) return 'chatgpt';
      return (await autoRun(ctx))?.phase !== 'ai' ? 'round over' : null;
    }, 30000, 'ChatGPT shown again');
    const backMs = Date.now() - clickedAt;
    await aiDone();
    const shown1 = await shownTab(ctx);
    const round1 = chatRound(await autoRun(ctx));
    results.switchedDuringWait = { back, backMs, kept: round1.kept || 0, shownAfter: shown1?.url, restored: round1.restored };
    if (back === 'chatgpt') assert.ok(backMs < 5000, 'ChatGPT\'s tab came back quickly');
    assert.match(shown1.url, /\/form-gpt/, 'the application\'s tab after the answer');
    assert.equal(round1.restored, true);
    await stopAutoApply(ctx, '/form-gpt');

    // 2. The Manager is elsewhere before the questions go out: ChatGPT's tab is never shown.
    mock.queue.push(gptApplication(61));
    assert.equal((await ctx.action('auto_apply')).ok, true);
    form = await until(() => formPage(ctx.browser, '/form-gpt'), 30000, 'the form tab');
    await other.bringToFront();
    await until(async () => (await autoRun(ctx))?.phase === 'ai', 240000, 'ChatGPT asked');
    await aiDone();
    const round2 = chatRound(await autoRun(ctx));
    results.elsewhereBefore = { focused: round2.focused, shownAfter: (await shownTab(ctx))?.url };
    assert.equal(round2.focused, false, 'not shown while the Manager looked elsewhere');
    assert.match(results.elsewhereBefore.shownAfter, /\/blank$/);
    await stopAutoApply(ctx, '/form-gpt');
    await other.close();

    // 2b. Another window has the keyboard (as when the Manager works in another program): ChatGPT's tab
    // is selected in the Apply window, the keyboard stays where it is, and the application comes back.
    form = await start(66);
    const away = await ctx.worker.evaluate(async (url) => (await chrome.windows.create({ url, left: 1010, top: 0, width: 500, height: 500, focused: true })).id, `${BASE}/blank`);
    await waitAsking();
    const keyboard = () => ctx.worker.evaluate(async () => (await chrome.windows.getLastFocused()).id);
    const during = await keyboard();
    await aiDone();
    const round2b = chatRound(await autoRun(ctx));
    const applyShown = await ctx.worker.evaluate(async (prefix) => {
      const formTab = (await chrome.tabs.query({})).find((tab) => tab.url.startsWith(prefix));
      return formTab ? (await chrome.tabs.query({ active: true, windowId: formTab.windowId }))[0]?.url : null;
    }, `${BASE}/form-gpt`);
    results.otherWindowFocused = { windowFocused: round2b.windowFocused, tabSelected: round2b.focused, restored: round2b.restored, keyboardStayed: during === away && (await keyboard()) === away, applyWindowShows: applyShown };
    assert.equal(round2b.windowFocused, false, 'the Apply window did not have the keyboard');
    assert.equal(round2b.focused, true, 'ChatGPT\'s tab was selected anyway');
    assert.equal(results.otherWindowFocused.keyboardStayed, true, 'the keyboard was not taken');
    assert.equal(round2b.restored, true);
    assert.match(applyShown || '', /\/form-gpt/);
    await stopAutoApply(ctx, '/form-gpt');
    await ctx.worker.evaluate((id) => chrome.windows.remove(id), away);

    // 3. Cancel while ChatGPT answers (its tab shown): the job is given back at once, nothing is left shown wrong.
    form = await start(62);
    await waitAsking();
    let at = Date.now();
    await ctx.action('cancel_status');
    await until(() => mock.released.some((entry) => entry.attemptId === attempt(62)), 30000, 'the release after Cancel');
    results.cancel = { releaseMs: mock.released.find((entry) => entry.attemptId === attempt(62)).at - at, mode: mock.released.at(-1).mode, shownAfter: (await shownTab(ctx))?.url };
    await until(async () => !(await formPage(ctx.browser, '/form-gpt')), 30000, 'the form tab to close');
    results.cancel.shownAfterClose = (await shownTab(ctx))?.url;
    assert.doesNotMatch(results.cancel.shownAfterClose || '', /chatgpt\.com/, 'ChatGPT is not left shown after Cancel');

    // 4. Stop all on the Jobs page while ChatGPT answers (the claim ends): stopped by the next heartbeat.
    form = await start(63);
    await waitAsking();
    mock.heartbeat409 = true;
    at = Date.now();
    await until(() => mock.released.some((entry) => entry.attemptId === attempt(63)), 40000, 'the release after Stop all');
    results.stopAll = { releaseMs: mock.released.find((entry) => entry.attemptId === attempt(63)).at - at, shownAfter: (await shownTab(ctx))?.url };
    await until(async () => !(await formPage(ctx.browser, '/form-gpt')), 30000, 'the form tab to close');
    results.stopAll.shownAfterClose = (await shownTab(ctx))?.url;
    assert.doesNotMatch(results.stopAll.shownAfterClose || '', /chatgpt\.com/, 'ChatGPT is not left shown after Stop all');
    mock.heartbeat409 = false;
    await ctx.action('cancel_status');
    await until(async () => (await ctx.storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 30000, 'off');

    // 5. ChatGPT's page cannot load: the questions come to the Manager, the application's tab comes back.
    const chatPage = (await ctx.browser.pages()).find((page) => /chatgpt\.com/.test(page.url()));
    const noPage = (request) => (request.isNavigationRequest() && /chatgpt\.com/.test(request.url()) ? request.abort() : request.continue());
    if (chatPage) {
      await chatPage.setRequestInterception(true);
      chatPage.on('request', noPage);
    }
    at = Date.now();
    form = await start(64);
    const failed = await until(async () => {
      const run = await autoRun(ctx);
      return ['final', 'needs_you'].includes(run?.phase) && run.step >= 2 ? run : null;
    }, 600000, 'the review after the failure');
    const round5 = chatRound(failed);
    results.pageFailure = { ok: round5.ok, error: round5.error, roundMs: round5.totalMs, restored: round5.restored, shownAfter: (await shownTab(ctx))?.url, panel: /ChatGPT did not answer/.test(await panelText(form)) };
    assert.equal(round5.ok, false);
    assert.equal(results.pageFailure.panel, true, 'the questions are on the review for the Manager');
    assert.match(results.pageFailure.shownAfter, /\/form-gpt/, 'the application\'s tab is shown again');
    if (chatPage) {
      chatPage.off('request', noPage);
      await chatPage.setRequestInterception(false).catch(() => {});
    }
    await stopAutoApply(ctx, '/form-gpt');

    // 5b. ChatGPT's page loads but its answer never comes (the page's request for it never returns):
    // the round ends at the wait's limit, the questions come to the Manager, the application comes back.
    const chatPage2 = (await ctx.browser.pages()).find((page) => /chatgpt\.com/.test(page.url()));
    const silenced = chatPage2 ? await chatPage2.evaluateOnNewDocument(() => {
      const fetchNow = window.fetch.bind(window);
      window.fetch = (input, init) => (/conversation/.test(String(input?.url || input)) && String(init?.method || input?.method || 'GET').toUpperCase() === 'POST'
        ? new Promise(() => {})
        : fetchNow(input, init));
    }) : null;
    form = await start(67);
    const unanswered = await until(async () => {
      const run = await autoRun(ctx);
      return ['final', 'needs_you'].includes(run?.phase) && run.step >= 2 ? run : null;
    }, 600000, 'the review after no answer');
    const round5b = chatRound(unanswered);
    // (ChatGPT may still answer by a way the page script does not reach: then the case is only recorded.)
    results.noAnswer = { simulated: round5b.ok === false, ok: round5b.ok, error: round5b.error, roundMs: round5b.totalMs, restored: round5b.restored, shownAfter: (await shownTab(ctx))?.url, panel: /ChatGPT did not answer/.test(await panelText(form)), submitted: mock.pageSubmitted };
    if (results.noAnswer.simulated) assert.equal(results.noAnswer.panel, true, 'the questions are on the review for the Manager');
    assert.match(results.noAnswer.shownAfter, /\/form-gpt/, 'the application\'s tab is shown again');
    assert.equal(mock.pageSubmitted, 0, 'nothing submitted');
    if (silenced) await chatPage2.removeScriptToEvaluateOnNewDocument(silenced.identifier).catch(() => {});
    await stopAutoApply(ctx, '/form-gpt');

    // 6. The extension restarts while ChatGPT answers (its tab shown): the application's tab comes back.
    form = await start(65);
    await waitAsking();
    await ctx.restartWorker();
    await ctx.worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    await until(async () => /\/form-gpt/.test((await shownTab(ctx))?.url || ''), 60000, 'the application\'s tab shown after the restart');
    const resumed = await until(async () => {
      const run = await autoRun(ctx);
      return run?.resumed && ['final', 'needs_you'].includes(run.phase) ? run : null;
    }, 480000, 'the resumed review');
    results.restart = { shownAfter: (await shownTab(ctx))?.url, resumedPhase: resumed.phase, step: resumed.step, submitted: mock.pageSubmitted };
    assert.equal(mock.pageSubmitted, 0, 'nothing submitted');
    console.log(`[focus scenarios] ${JSON.stringify(results)}`);
  } finally {
    if (Object.keys(results).length) console.log(`[focus scenarios partial] ${JSON.stringify(results)}`);
    console.log(`[focus scenarios tabs] ${JSON.stringify(await ctx.worker.evaluate(() => self.__shown).catch(() => null))}`);
    await ctx.browser.close();
  }
});
