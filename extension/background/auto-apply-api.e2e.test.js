// End-to-end test of Auto Apply with APIs in the REAL extension in Chrome (service worker, form
// engine, answer rules, review panel) against a local mock QTS server with synthetic forms. The AI is
// the mock's fixed rules: no Gemini, Groq or job site is called, and nothing leaves this machine.
// The only Submit clicks are the test playing the Manager on the local form.
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
const skip = CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).';

const PORT = 47133;
const BASE = `http://127.0.0.1:${PORT}`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

const EVENT_LOG = `<script>
  window.events = [];
  for (const type of ['input', 'change']) document.addEventListener(type, (event) => window.events.push({ type, id: event.target.id,
    value: event.target.type === 'file' ? [...event.target.files].map((file) => file.name).join() : event.target.value }), true);
</script>`;
const FORM_END = `<script>
  document.getElementById('app').addEventListener('submit', (event) => { event.preventDefault(); fetch('/page-submitted', { method: 'POST' }); });
</script>`;

// A form someone else has already filled: old text, an old choice, a tick, and an attached file.
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>${EVENT_LOG}
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required value="Old Name"></div>
  <div><label for="em">Email *</label><input id="em" type="email" required value="old@person.com"></div>
  <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
  <div><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option selected>Indeed</option><option>LinkedIn</option></select></div>
  <div><label for="mot">What motivates you in your work? *</label><textarea id="mot" required>Someone else's answer</textarea></div>
  <div id="cv-box"><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required><div id="old-file"><span>old_person_cv.pdf</span> <button type="button" id="rm" aria-label="Remove file">×</button></div></div>
  <div><label><input type="checkbox" id="privacy" required checked> I agree to the privacy policy *</label></div>
  <div><label for="ref">Referral code</label><input id="ref" value="KEEP-123"></div>
  <button type="submit" id="submit">Submit application</button>
</form>
<script>document.getElementById('rm').addEventListener('click', () => document.getElementById('old-file').remove());</script>${FORM_END}
</body></html>`;

// A question that appears after another answer.
const FORM_DYN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dyn - Apply</title></head><body>
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="car">Do you own a car? *</label><select id="car" required><option value="">Select…</option><option>Yes</option><option>No</option></select></div>
  <div id="more" hidden><label for="model">Which car model do you drive? *</label><input id="model" required disabled></div>
  <button type="submit" id="submit">Submit application</button>
</form>
<script>
  document.getElementById('car').addEventListener('change', (event) => {
    const yes = event.target.value === 'Yes';
    document.getElementById('more').hidden = !yes;
    document.getElementById('model').disabled = !yes;
  });
</script>${FORM_END}
</body></html>`;

// Two steps in one page, moved on only by the site's own Next.
const FORM_STEPS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Steps - Apply</title></head><body>
<form id="app">
  <div id="step1">
    <h2>Details</h2>
    <div><label for="fn">First name *</label><input id="fn" required></div>
    <div><label for="em">Email *</label><input id="em" type="email" required></div>
    <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
    <div><label for="extra">Anything else you would like to share?</label><textarea id="extra"></textarea></div>
    <button type="button" id="next1">Next</button>
  </div>
  <div id="step2" style="display:none">
    <h2>About you</h2>
    <div><label for="mot">What motivates you in your work? *</label><textarea id="mot" required></textarea></div>
    <div><label for="note">What is your favourite colour? *</label><input id="note" required></div>
    <button type="button" id="back2">Back</button>
    <button type="submit" id="submit">Submit application</button>
  </div>
</form>
<script>
  const show = (n) => { document.getElementById('step1').style.display = n === 1 ? '' : 'none'; document.getElementById('step2').style.display = n === 2 ? '' : 'none'; };
  document.getElementById('next1').addEventListener('click', () => show(2));
  document.getElementById('back2').addEventListener('click', () => show(1));
</script>${FORM_END}
</body></html>`;

const SMALL_FORM = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Site - Apply</title></head><body>${body}
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <button type="submit" id="submit">Submit application</button>
</form>${FORM_END}
</body></html>`;

const JOB_GUEST = `<!doctype html><html><body><h1>A job</h1>
  <a href="/account-login">Sign in</a> <a href="/account-login?register=1">Create account</a>
  <button id="guest" onclick="location.href='/small'">Apply as guest</button>
</body></html>`;
const JOB_BLOCKED = `<!doctype html><html><body><h1>A job</h1><p>Sign in to apply.</p><a href="/account-login">Sign in</a></body></html>`;
const ACCOUNT_LOGIN = `<!doctype html><html><body>
  <form onsubmit="event.preventDefault(); fetch('/account-login-submitted?email=' + encodeURIComponent(email.value) + '&password=' + encodeURIComponent(password.value)).then(() => { location.href = '/small'; });">
    <label for="email">Email</label><input id="email" type="email">
    <label for="password">Password</label><input id="password" name="password" type="password">
    <button type="submit">Sign in</button>
  </form>
</body></html>`;

const attempt = (n) => `00000000-0000-4000-8000-00000000a${String(n).padStart(3, '0')}`;
const jobId = (n) => `00000000-0000-4000-8000-00000000b${String(n).padStart(3, '0')}`;
const ANA = { id: '00000000-0000-4000-8000-0000000000aa', candidateId: '00000000-0000-4000-8000-0000000000aa', firstName: 'Ana', lastName: 'Test', email: 'ana.test@example.com', phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania', nationality: 'Romanian', gender: 'woman', yearsOfExperience: 6 };
const BEN = { ...ANA, id: '00000000-0000-4000-8000-0000000000bb', candidateId: '00000000-0000-4000-8000-0000000000bb', firstName: 'Ben', lastName: 'Stone', email: 'ben.stone@example.com' };
const PROMPT = 'Profile: {{candidate_profile}}\nDocs: {{resume_and_cover_letter}}\nSaved: {{saved_answers}}\nQuestions:\n{{questions}}';
const application = (n, form, candidate = ANA, query = '') => ({
  attemptId: attempt(n),
  aiMode: 'chatgpt',
  autoApplyApi: true,
  // Super Admin's settings say "submit by itself": QTS must still stop for the Manager.
  autoSubmit: true,
  reviewMode: 'every_step',
  job: {
    id: jobId(n), url: `${BASE}/${form}?job=${n}${query}`, title: 'Backend Engineer', company: 'Globex', location: 'Remote', workType: 'Remote', salary: null,
    description: 'We use Python and AWS.', resumeFolder: 'C:\\test-folder', resumeSavedOn: 'Test Chrome', promptName: 'Test prompt', templateName: 'Test template',
    resumeText: 'Backend Engineer since 2019.', coverLetterText: 'Dear Hiring Manager,\nHello.\nKind regards',
  },
  candidate: candidate,
  profileDetails: { experiences: [], educations: [] },
  savedAnswers: [],
  exchangeRates: null,
  rememberedChoices: [],
  answerPrompt: { id: 'p', template: PROMPT },
  siteAccountPassword: 'SavedEmployerPassword123!',
});

function aiReply(prompt) {
  const marker = prompt.lastIndexOf('Questions:\n');
  let questions = [];
  try { questions = JSON.parse(prompt.slice(marker + 11).split('\n')[0]); } catch { questions = []; }
  mock.asked.push(questions.map((question) => question.question.replace(/\s*\*\s*$/, '')));
  const person = /"email":"ben\.stone/.test(prompt) ? BEN : ANA;
  return JSON.stringify({ answers: questions.map((question) => {
    const value = (text) => ({ id: question.id, value: text, status: 'ready' });
    if (/first name/i.test(question.question)) return value(person.firstName);
    if (/last name/i.test(question.question)) return value(person.lastName);
    if (/email/i.test(question.question)) return value(mock.wrongEmail ? 'someone.else@example.com' : person.email);
    if (/phone/i.test(question.question)) return value(person.phone);
    if (/hear about/i.test(question.question)) return value('LinkedIn');
    if (/motivates/i.test(question.question)) return value('Building reliable services.');
    if (/own a car/i.test(question.question)) return value('Yes');
    if (/car model/i.test(question.question)) return value('Dacia Logan');
    if (/colour/i.test(question.question)) return value('Blue');
    return { id: question.id, value: null, status: 'review', reason: 'not in the documents' };
  }) });
}

const mock = {};
function resetMock(options = {}) {
  Object.assign(mock, {
    log: [], answers: 0, prompts: [], asked: [], released: [], reviews: [], submitted: [], results: [], accountLogins: [], cookies: [],
    pageSubmitted: 0, claims: 0, byAttempt: {}, queue: options.queue || [],
    autoApplyParallelLimit: options.autoApplyParallelLimit ?? 1,
    answerDelay: options.answerDelay || 0,
    aiMode: options.aiMode || 'rules',
    wrongEmail: options.wrongEmail === true,
  });
}
resetMock();

const SIGNED_IN = '<header>Signed in as <b>ben.stone@example.com</b> <a href="/logout">Sign out</a></header>';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    mock.log.push({ at: Date.now(), method: req.method, path: url.pathname });
    const data = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    const json = (payload, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(payload)); };
    const html = (text, headers = {}) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(text); };
    const cookie = req.headers.cookie || '';
    if (url.pathname === '/form') return html(FORM);
    if (url.pathname === '/dyn') return html(FORM_DYN);
    if (url.pathname === '/steps') return html(FORM_STEPS);
    if (url.pathname === '/small') return html(SMALL_FORM(''));
    if (url.pathname === '/job-guest') return html(JOB_GUEST);
    if (url.pathname === '/job-blocked') return html(JOB_BLOCKED);
    if (url.pathname === '/account-login') return html(ACCOUNT_LOGIN);
    if (url.pathname === '/account-login-submitted') {
      mock.accountLogins.push({ email: url.searchParams.get('email'), password: url.searchParams.get('password') });
      return json({});
    }
    // A site that remembers: a session cookie and a draft in the browser's storage.
    if (url.pathname === '/site') {
      mock.cookies.push({ job: url.searchParams.get('job'), cookie });
      const who = url.searchParams.get('who');
      return html(SMALL_FORM(`<script>window.draftFound = localStorage.getItem('draft'); localStorage.setItem('draft', ${JSON.stringify(who)});</script>`), { 'Set-Cookie': `site_session=${who}; Path=/` });
    }
    // Shows another account for as long as its cookie is there.
    if (url.pathname === '/signed-in') {
      mock.cookies.push({ job: url.searchParams.get('job'), cookie });
      return html(SMALL_FORM(cookie.includes('site_session=ben') ? SIGNED_IN : ''));
    }
    if (url.pathname === '/unknown-account') return html(SMALL_FORM('<header><a href="/logout">Sign out</a></header>'));
    // Another account appears only after QTS has filled the form.
    if (url.pathname === '/late-account') {
      return html(SMALL_FORM(`<div id="late"></div><script>document.addEventListener('input', (event) => { if (event.target.id === 'em') document.getElementById('late').innerHTML = ${JSON.stringify(SIGNED_IN)}; }, true);</script>`));
    }
    if (url.pathname === '/blank') return html('<!doctype html><title>Blank</title><h1>Blank</h1>');
    if (url.pathname === '/page-submitted') { mock.pageSubmitted += 1; return json({}); }
    if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { canUseApply: true, autoApplyParallelLimit: mock.autoApplyParallelLimit } });
    if (url.pathname === '/api/extension/apply/claim') {
      mock.claims += 1;
      const selection = data.selection;
      const index = selection
        ? mock.queue.findIndex((entry) => entry.candidate.id === selection.candidateId && selection.jobIds.includes(entry.job.id))
        : 0;
      const next = index >= 0 ? mock.queue.splice(index, 1)[0] || null : null;
      if (next) mock.byAttempt[next.attemptId] = next;
      return json({ success: true, application: next });
    }
    if (url.pathname === '/api/extension/apply/resume') return json({ success: true, application: mock.byAttempt[data.attemptId] || null });
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 120, reviewMode: 'every_step', autoSubmit: true });
    if (url.pathname === '/api/extension/apply/answers') {
      mock.answers += 1;
      if (mock.aiMode === 'quota') return json({ success: false, retry: false, message: 'Every key has used its limit for today.' }, 429);
      const prompt = (data.turns || []).at(-1)?.text || '';
      mock.prompts.push(prompt);
      setTimeout(() => json({ success: true, reply: aiReply(prompt) }), mock.answerDelay);
      return undefined;
    }
    if (url.pathname === '/api/extension/apply/documents') {
      const { firstName, lastName } = mock.byAttempt[url.searchParams.get('attemptId')].candidate;
      return json({ success: true, documents: {
        resumePath: `QTS_Resume/Manager/${firstName} ${lastName}/Run/${firstName} ${lastName}.pdf`,
        coverLetterPath: `QTS_Resume/Manager/${firstName} ${lastName}/Run/${firstName} ${lastName}_Cover_Letter.pdf`,
      } });
    }
    if (url.pathname === '/api/extension/apply/review') { mock.reviews.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/submitted') { mock.submitted.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/result') { mock.results.push(data); return json({ success: true, result: 'confirmed' }); }
    if (url.pathname === '/api/extension/apply/release') { mock.released.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/browsers/heartbeat') return json({ success: true, generationStopVersion: 0, applyStopVersion: 0, minWorkExtensionVersion: '1.36.0' });
    return json({ success: true });
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(200);
  }
}

async function connectWorker(target) {
  const session = await target.createCDPSession();
  await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
  return {
    evaluate: (fn, ...args) => Promise.race([
      session.send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }).then((reply) => {
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
        return reply.result.value;
      }),
      sleep(30000).then(() => { throw new Error('the extension worker did not answer within 30 s'); }),
    ]),
  };
}

async function launch() {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: !HEADFUL, pipe: true, protocolTimeout: 600000, defaultViewport: HEADFUL ? null : { width: 1280, height: 900 },
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run', '--window-size=1300,950'],
  });
  const target = await browser.waitForTarget((entry) => entry.type() === 'service_worker' && entry.url().includes('service-worker.js'), { timeout: 30000 });
  const extensionId = new URL(target.url()).host;
  const worker = await connectWorker(target);
  await until(() => Promise.race([
    worker.evaluate(() => typeof chrome !== 'undefined' && Boolean(self.__qtsAutoApplyApi)).catch(() => false),
    sleep(3000).then(() => false),
  ]), 30000, 'the extension worker to load');
  await worker.evaluate(async (base) => {
    await chrome.storage.local.set({
      qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
      qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' }, qtsApplyDebug: true, qtsBrowserName: 'E2E Chrome',
    });
  }, BASE);
  await worker.evaluate((documentPdf) => {
    Object.defineProperty(self, '__qtsScannerDocumentStore', { configurable: true, value: { getSetting: async (key) => ({ value: key === 'applyPdfDownloadsDirectoryV1' ? {} : null }) } });
    Object.defineProperty(self, '__qtsApplyLocalPdfs', { configurable: true, value: {
      SETTING_KEY: 'applyPdfDownloadsDirectoryV1',
      readApplyDocuments: async () => ({
        resume: { filename: 'Ana_Test_CV.pdf', base64: documentPdf, mimeType: 'application/pdf' },
        coverLetter: { filename: 'Ana_Test_Cover.pdf', base64: documentPdf, mimeType: 'application/pdf' },
      }),
    } });
  }, pdf);
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup/popup.html`).catch(() => {});
  const action = (name, selection) => control.evaluate(({ act, workSelection }) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: act, ...(workSelection ? { selection: workSelection } : {}) }), { act: name, workSelection: selection });
  const storage = (keys) => worker.evaluate((k) => chrome.storage.local.get(k), keys);
  globalThis.__diag = () => worker.evaluate(() => [...activeReviews.values()].map((review) => ({ mode: review.panel?.mode, text: review.panel?.workingText, problems: review.panel?.problems, waiting: reviewWaiters.has(review.attemptId) })));
  return { browser, worker, action, storage };
}

const formPage = async (browser, prefix) => (await browser.pages()).find((page) => page.url().startsWith(`${BASE}${prefix}`));

async function waitForStep(storage, step, ms = 60000) {
  let run = null;
  try {
    return await until(async () => {
      run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
      return run && run.step === step && ['needs_you', 'final'].includes(run.phase) ? run : null;
    }, ms, `step ${step} waiting for the Manager`);
  } catch (error) {
    const { lastRun } = { lastRun: (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.last };
    if (globalThis.__diag) error.message += `; worker: ${JSON.stringify(await globalThis.__diag().catch((e) => e.message))?.slice(0, 900)}`;
    error.message += `; run: ${JSON.stringify(run)?.slice(0, 500)}; last: ${JSON.stringify(lastRun)?.slice(0, 500)}; released: ${JSON.stringify(mock.released)}`;
    throw error;
  }
}

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
const until_panel = async (page, pattern, ms = 30000) => {
  let last = '';
  try {
    return await until(async () => { last = await panelText(page).catch(() => ''); return pattern.test(last) ? last : null; }, ms, `the panel to say ${pattern}`);
  } catch (error) {
    error.message += `; the panel says: ${last.slice(-1100)}`;
    throw error;
  }
};
// Only once the worker is waiting: a click before that has nobody to answer it.
const pressPanel = (page, label) => until(async () => {
  if (!(await globalThis.__diag()).some((review) => review.waiting)) return false;
  return clickPanelButton(page, label).catch(() => false);
}, 20000, `the panel's ${label}`);
const valueOf = (page, id) => page.evaluate((box) => document.getElementById(box).value, id);

test.before(() => new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve)));
test.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

test('the form is emptied, the AI is asked once, then documents go in and everything is filled; QTS never submits', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(1, 'form')], answerDelay: 2500 });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await until(() => mock.answers === 1, 60000, 'the AI request');
    const form = await formPage(browser, '/form');
    // While the AI is answering, nothing is in the form and nothing has been filled.
    const during = await form.evaluate(() => ({
      name: document.getElementById('fn').value, email: document.getElementById('em').value, hear: document.getElementById('hear').value,
      motivation: document.getElementById('mot').value, privacy: document.getElementById('privacy').checked,
      oldFile: Boolean(document.getElementById('old-file')), files: document.getElementById('cv').files.length, referral: document.getElementById('ref').value,
    }));
    assert.deepEqual(during, { name: '', email: '', hear: '', motivation: '', privacy: false, oldFile: false, files: 0, referral: 'KEEP-123' });

    await waitForStep(storage, 1);
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    assert.equal(await valueOf(form, 'em'), 'ana.test@example.com');
    assert.equal(await valueOf(form, 'ph'), '+40264484948');
    assert.equal(await valueOf(form, 'hear'), 'LinkedIn');
    assert.equal(await valueOf(form, 'mot'), 'Building reliable services.');
    assert.equal(await valueOf(form, 'ref'), 'KEEP-123', 'a referral code the site put there stays');
    assert.equal(await form.evaluate(() => document.getElementById('privacy').checked), true);
    assert.equal(await form.evaluate(() => document.getElementById('cv').files[0]?.name), 'Ana_Test_CV.pdf');

    // Documents first, answers after, so a site's résumé parser cannot overwrite them.
    const events = await form.evaluate(() => window.events);
    const uploadedAt = events.findIndex((event) => event.id === 'cv' && event.value === 'Ana_Test_CV.pdf');
    const filledAt = events.findIndex((event) => event.id === 'fn' && event.value === 'Ana');
    assert.ok(uploadedAt >= 0 && filledAt > uploadedAt, `upload ${uploadedAt} before fill ${filledAt}`);

    assert.equal(mock.answers, 1, 'one AI request for the whole page');
    assert.equal(mock.asked[0].length, 5, 'consent and the upload are not sent to the AI');
    assert.match(mock.prompts[0], /ana\.test@example\.com/);
    assert.doesNotMatch(mock.prompts[0], /diversityAnswers/);
    assert.doesNotMatch(mock.prompts[0], /Answer every question id/);
    assert.equal(mock.pageSubmitted, 0);
    assert.equal(mock.submitted.length, 0);
    await sleep(2000);
    assert.equal(mock.pageSubmitted, 0, 'QTS never submits by itself');

    await form.click('#submit');
    await until(() => mock.pageSubmitted === 1, 15000, 'the Manager\'s own Submit');
  } finally { await browser.close(); }
});

test('an AI answer that changes a profile fact is replaced by the profile, and the Manager is told', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(2, 'small')], wrongEmail: true });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    assert.equal(await valueOf(form, 'em'), 'ana.test@example.com');
    await until_panel(form, /someone\.else@example\.com.*QTS used the profile/);
  } finally { await browser.close(); }
});

test('when the AI has no answers nothing is filled, and Ask AI again finishes the page', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(3, 'small')], aiMode: 'quota' });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    assert.equal(mock.answers, 1, 'a day\'s limit is not retried');
    assert.equal(await valueOf(form, 'fn'), '');
    assert.equal(await valueOf(form, 'em'), '');
    await until_panel(form, /filled nothing on this page/);
    mock.aiMode = 'rules';
    await pressPanel(form, 'Ask AI again');
    await waitForStep(storage, 1);
    await until(async () => await valueOf(form, 'em') === 'ana.test@example.com', 30000, 'the page to be filled');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a question that appears after an answer is asked alone', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(4, 'dyn')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/dyn');
    assert.equal(await valueOf(form, 'model'), 'Dacia Logan');
    assert.equal(mock.answers, 2);
    assert.deepEqual(mock.asked[1], ['Which car model do you drive?']);
  } finally { await browser.close(); }
});

test('the Manager moves the form on; each step is filled once and their edits are never overwritten', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(5, 'steps')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/steps');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    await sleep(3000);
    assert.equal(await form.evaluate(() => document.getElementById('step2').style.display), 'none', 'QTS does not press Next');
    assert.equal(mock.answers, 1);

    // The Manager changes an answer and presses the site's own Next.
    await form.focus('#ph');
    await form.keyboard.down('Control');
    await form.keyboard.press('KeyA');
    await form.keyboard.up('Control');
    await form.keyboard.type('+40 700 000 111');
    await form.click('#next1');
    await waitForStep(storage, 2);
    assert.equal(await valueOf(form, 'mot'), 'Building reliable services.');
    assert.equal(await valueOf(form, 'note'), 'Blue');
    assert.equal(mock.answers, 2, 'one more request, for the new step');
    assert.deepEqual(mock.asked[1].sort(), ['What is your favourite colour?', 'What motivates you in your work?']);

    // Back on step 1: nothing is emptied or filled again.
    await form.click('#back2');
    await waitForStep(storage, 1);
    await sleep(2000);
    assert.equal(await valueOf(form, 'ph'), '+40 700 000 111', 'the Manager\'s edit stays');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    assert.equal(mock.answers, 2, 'no AI request for a step already filled');
    assert.equal(mock.pageSubmitted, 0);
  } finally { await browser.close(); }
});

test('a way in without an account comes first, even beside Sign in', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(6, 'job-guest')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.ok(await formPage(browser, '/small'), 'the form is reached');
    assert.deepEqual(mock.accountLogins, [], 'nobody signed in');
  } finally { await browser.close(); }
});

test('signing in happens only when nothing else leads on', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(7, 'job-blocked')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.deepEqual(mock.accountLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!' }]);
    assert.ok(await formPage(browser, '/small'));
  } finally { await browser.close(); }
});

test('a site last used for another candidate is cleared before it opens; the same candidate keeps it', { skip, timeout: 240000 }, async () => {
  resetMock({ queue: [application(8, 'site', ANA, '&who=ana'), application(9, 'site', ANA, '&who=ana2'), application(10, 'site', BEN, '&who=ben')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const stepFor = async (job) => {
      const page = await until(async () => {
        const found = (await browser.pages()).find((entry) => entry.url().includes(`job=${job}`));
        const run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
        return found && run?.jobId === jobId(job) && ['needs_you', 'final'].includes(run.phase) ? found : null;
      }, 60000, `job ${job} to wait for the Manager`);
      return page;
    };
    const first = await stepFor(8);
    assert.equal(await first.evaluate(() => window.draftFound), null);
    await pressPanel(first, 'Skip');

    const second = await stepFor(9);
    assert.equal(mock.cookies.find((entry) => entry.job === '9').cookie, 'site_session=ana', 'the same candidate keeps the session');
    assert.equal(await second.evaluate(() => window.draftFound), 'ana');
    await pressPanel(second, 'Skip');

    const third = await stepFor(10);
    assert.equal(mock.cookies.find((entry) => entry.job === '10').cookie, '', 'another candidate starts with no session');
    assert.equal(await third.evaluate(() => window.draftFound), null, 'and with no stored draft');
    assert.equal(await valueOf(third, 'fn'), 'Ben');
  } finally { await browser.close(); }
});

test('a page signed in as someone else is signed out before anything is filled', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(11, 'signed-in')] });
  const { browser, action, storage } = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/blank`);
    await page.evaluate(() => { document.cookie = 'site_session=ben; path=/'; });
    await page.close();
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/signed-in');
    assert.equal(mock.cookies[0].cookie, 'site_session=ben', 'it opened signed in as someone else');
    assert.equal(mock.cookies.at(-1).cookie, '', 'it was opened again signed out');
    assert.equal(await form.evaluate(() => document.body.innerText.includes('Signed in as')), false);
    assert.equal(await valueOf(form, 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('an account QTS cannot name waits for the Manager, and no AI request goes out before', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(12, 'unknown-account')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/unknown-account'), 30000, 'the page');
    await until_panel(form, /account QTS cannot identify/);
    assert.equal(mock.answers, 0);
    assert.equal(await valueOf(form, 'fn'), '');
    await pressPanel(form, 'Continue →');
    await waitForStep(storage, 1);
    assert.equal(mock.answers, 1);
    assert.equal(await valueOf(form, 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('another account showing at the end holds the site\'s Submit', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(13, 'late-account')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/late-account');
    await until_panel(form, /Candidate check.*signed in as ben\.stone@example\.com/);
    await form.click('#submit');
    await until_panel(form, /Submit was held/);
    await sleep(800);
    assert.equal(mock.pageSubmitted, 0);
  } finally { await browser.close(); }
});

test('a job taken up again in a new tab is filled again, from the answers it already has', { skip, timeout: 150000 }, async () => {
  const job = application(15, 'small');
  resetMock({ queue: [job] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.equal(mock.answers, 1);
    await action('cancel_status');
    await until(() => mock.released.length === 1, 20000, 'the application to be given back');
    await until(async () => (await storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 20000, 'the run to stop');
    await until(async () => !(await formPage(browser, '/small')), 20000, 'the old tab to close');

    mock.queue.push(job);
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/small'), 30000, 'the form again');
    await waitForStep(storage, 1);
    await until(async () => await valueOf(form, 'em') === 'ana.test@example.com', 30000, 'the page to be filled');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    assert.equal(mock.answers, 1, 'the answers already given are used again');
  } finally { await browser.close(); }
});

test('choosing another candidate stops what was under way for the first', { skip, timeout: 120000 }, async () => {
  const job = application(14, 'small');
  resetMock({ queue: [job], answerDelay: 15000 });
  const { browser, action, worker } = await launch();
  try {
    const selection = { candidateId: ANA.id, jobIds: [jobId(14)] };
    assert.equal((await action('auto_apply', selection)).ok, true);
    await until(() => mock.answers === 1, 60000, 'the AI request');
    const form = await formPage(browser, '/small');
    await worker.evaluate((candidateId) => chrome.storage.local.set({ qtsWorkSelection: { mode: 'auto_apply', candidateId, jobIds: [] } }), BEN.id);
    await until(() => mock.released.length === 1, 20000, 'the application to be given back');
    assert.equal(mock.released[0].attemptId, attempt(14));
    assert.match(mock.released[0].reason, /Another candidate was chosen/);
    await sleep(500);
    const left = await form.evaluate(() => document.getElementById('fn')?.value).catch(() => '');
    assert.ok(!left, 'nothing was filled for the old candidate');
  } finally { await browser.close(); }
});
