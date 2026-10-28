// End-to-end test of the REAL extension in Chrome as the Manager's assistant: its service worker, the
// Apply queue, the form engine, and the panel, against a local mock QTS server on 127.0.0.1. Two job
// pages open at once (the first in front). On every page of a job's journey (the job page, a tab it
// opens, a form's steps, a pop-up) QTS fills, as soon as boxes show, only the résumé, the cover
// letter, profile facts, and reusable answers; never what the Manager typed, never a search or
// newsletter box, never a sign-in or create-account form (the Manager types those, copying the site
// account password from the panel). The site's buttons are never
// watched: only Submitted on the panel saves a bid; Cancel or a closed page records nothing.
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

const PORT = 47124;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'S1te-Acc0unt!';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const log = { claims: [], submitted: [], results: [], released: [], reviews: 0, documents: 0 };

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

// A job page with the site's search in its header and a newsletter in its footer.
const JOB_PAGE = page('Data Engineer at Acme', `
<header><form role="search" onsubmit="event.preventDefault()"><label for="sq">City</label><input id="sq"><button>Search jobs</button></form></header>
<main><h1>Data Engineer</h1><p>About the job: Spark, Airflow.</p><a href="/form/1" class="button" target="_blank">Apply now</a></main>
<footer><form class="newsletter" onsubmit="event.preventDefault()"><label for="nl">Email</label><input id="nl" type="email"><button>Subscribe</button></form></footer>`);

const form = (number) => page(`Apply ${number}`, `
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
</form>`);

// An employer's site: sign in, create an account, then a form in steps with a pop-up.
const LOGIN = page('Sign in', `
<form id="login" onsubmit="event.preventDefault(); location.href = '/register/4';">
  <label for="lu">Email or username</label><input id="lu" type="text">
  <label for="lp">Password</label><input id="lp" type="password">
  <button type="submit">Sign in</button>
</form>`);
const REGISTER = page('Create account', `
<form id="reg" onsubmit="event.preventDefault(); location.href = '/steps/4';">
  <label for="rf">First name</label><input id="rf"><label for="rl">Last name</label><input id="rl">
  <label for="re">Email</label><input id="re" type="email">
  <label for="rp">Password</label><input id="rp" type="password"><label for="rc">Confirm password</label><input id="rc" type="password">
  <button type="submit">Create account</button>
</form>`);
const STEPS = page('Application', `
<form id="steps" onsubmit="event.preventDefault(); window.submitted = true;"><div id="step">
  <label for="e1">Email *</label><input id="e1" type="email" required>
  <button type="button" id="next">Next</button>
</div></form>
<script>
document.getElementById('next').onclick = () => {
  document.getElementById('step').innerHTML = '<label for="e2">Email *</label><input id="e2" type="email" required>'
    + '<label for="p2">Phone *</label><input id="p2" type="tel" value="+48 600 000 000">'
    + '<button type="button" id="more">Add address</button><button type="submit">Submit application</button>';
  document.getElementById('more').onclick = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<label for="city">City *</label><input id="city" required>';
    document.body.append(dialog);
  };
};
</script>`);

const job = (number, url, candidate) => ({
  attemptId: `00000000-0000-4000-8000-00000000a00${number}`,
  aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: `00000000-0000-4000-8000-00000000b00${number}`, url, title: `Data Engineer ${number}`, company: 'Acme',
    location: 'Remote', workType: 'Full-time · Remote', salary: null, description: 'We need Spark and Airflow.',
    resumeFolder: 'QTS\\Candidate\\Acme', resumeSavedOn: 'Test Chrome', promptName: null, templateName: null,
    resumeText: 'Data Engineer. 7 years of Spark.', coverLetterText: 'Dear Hiring Manager,\nI would like to join Acme.',
  },
  candidate,
  profileDetails: {
    experiences: [{ jobTitle: 'Data Engineer', companyName: 'Initech', location: 'Cluj', workMode: 'remote', startDate: '2019-01-01', endDate: null, isCurrent: true, description: 'Spark pipelines.' }],
    educations: [{ institution: 'UBB', degree: 'BSc', fieldOfStudy: 'Computer Science', startDate: '2012-10-01', endDate: '2015-07-01', isCurrent: false, description: null }],
  },
  savedAnswers: [{ questionKey: 'notice period', questionText: 'Notice period', answer: 'Immediately', note: null, scope: 'everyone' }],
  exchangeRates: null, rememberedChoices: [], answerPrompt: null,
  siteAccountPassword: PASSWORD,
});
const RADU = {
  candidateId: '00000000-0000-4000-8000-00000000c001', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com',
  phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania', yearsOfExperience: 7,
};
const OLA = {
  candidateId: '00000000-0000-4000-8000-00000000c002', firstName: 'Ola', lastName: 'Nowak', email: 'ola.test@example.com',
  phone: '+48600111222', city: 'Krakow', country: 'Poland', yearsOfExperience: 5,
};
const jobs = [job(1, `${BASE}/job/1`, RADU), job(2, `${BASE}/form/2`, RADU), job(3, `${BASE}/slow/3`, RADU), job(4, `${BASE}/login/4`, OLA)];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const data = JSON.parse(body || '{}');
    const json = (reply) => { res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
    const html = (text) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); res.end(text); };
    if (url.pathname === '/job/1') return html(JOB_PAGE);
    if (url.pathname.startsWith('/form/')) return html(form(url.pathname.slice(6)));
    // A site that takes long to answer: the Manager closes it while it loads.
    if (url.pathname === '/slow/3') return setTimeout(() => html(form(3)), 60000).unref();
    if (url.pathname === '/login/4') return html(LOGIN);
    if (url.pathname === '/register/4') return html(REGISTER);
    if (url.pathname === '/steps/4') return html(STEPS);
    if (url.pathname === '/api/extension/apply/claim') {
      log.claims.push(data.skipJobIds || []);
      return json({ success: true, application: jobs[log.claims.length - 1] || null });
    }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
    if (url.pathname === '/api/extension/apply/review') { log.reviews += 1; return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/documents') {
      log.documents += 1;
      return json({ success: true, documents: { folder: 'C:\\test-folder', resume: { filename: 'CV.pdf', base64: pdf }, coverLetter: { filename: 'Cover.pdf', base64: pdf } } });
    }
    if (url.pathname === '/api/extension/apply/submitted') { log.submitted.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/result') { log.results.push(data); return json({ success: true, result: 'confirmed' }); }
    if (url.pathname === '/api/extension/apply/release') { log.released.push({ ...data, at: Date.now() }); return json({ success: true }); }
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the assistant fills every page of each job\'s journey, and only Submitted on the panel saves a bid', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 420000,
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
    const tabs = () => worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => ({ id: tab.id, url: tab.url || tab.pendingUrl || '', active: tab.active })));
    const tabFor = async (part) => (await tabs()).find((tab) => tab.url.includes(part));
    const pageFor = async (part) => (await browser.pages()).find((entry) => entry.url().includes(part));
    const panelSays = (part, message) => tabFor(part).then((tab) => worker.evaluate((tabId, msg) => chrome.scripting.executeScript({
      target: { tabId }, func: (m) => chrome.runtime.sendMessage(m), args: [msg],
    }), tab.id, message));
    // What a page's boxes hold, read through the extension (a page handle can hang while its tab navigates).
    const read = async (part, ids) => {
      const tab = await tabFor(part);
      if (!tab) return null;
      const [frame] = await worker.evaluate((tabId, wanted) => chrome.scripting.executeScript({ target: { tabId }, args: [wanted], func: (list) => {
        const out = {};
        for (const id of list) {
          const box = document.getElementById(id);
          out[id] = !box ? null : box.type === 'file' ? box.files.length : box.type === 'checkbox' ? box.checked : box.value;
        }
        return out;
      } }).catch(() => [{ result: null }]), tab.id, ids);
      return frame?.result || null;
    };
    const FORM_IDS = ['fn', 'ln', 'em', 'ph', 'co', 'np', 'hear', 'why', 'cl', 'cv', 'ok'];

    // Two pages open, only the first in front; the third waits.
    await until('two job pages', async () => (await tabs()).filter((tab) => tab.url.startsWith(BASE)).length === 2);
    const open = (await tabs()).filter((tab) => tab.url.startsWith(BASE));
    assert.deepEqual(open.map((tab) => [new URL(tab.url).pathname, tab.active]), [['/job/1', true], ['/form/2', false]]);
    await pause(2000);
    assert.equal(log.claims.length, 2);
    assert.equal(log.reviews, 2);

    // A page behind the Manager's is filled with what QTS knows, and only that.
    await until('the second page filled', async () => (await read('/form/2', ['cv', 'np']))?.cv === 1);
    assert.deepEqual(await read('/form/2', FORM_IDS), {
      fn: 'Radu', ln: 'Star', em: 'radu.test@example.com', ph: '+40264484948', co: 'Romania', np: 'Immediately',
      hear: '', why: '', cl: 'Dear Hiring Manager,\nI would like to join Acme.', cv: 1, ok: false,
    });
    assert.equal(log.aiAsked, undefined);

    // The job page's search and newsletter are not the application: left empty.
    await pause(1500);
    assert.deepEqual(await read('/job/1', ['sq', 'nl']), { sq: '', nl: '' });

    // Its Apply button opens the form in a new tab, which joins the application and is filled.
    const first = await pageFor('/job/1');
    await first.click('a.button');
    await until('the first form filled', async () => {
      const values = await read('/form/1', ['fn', 'cv']);
      return values?.fn === 'Radu' && values.cv === 1;
    });
    // Closing the job page leaves the application open in the form's tab.
    await worker.evaluate(async (tabId) => chrome.tabs.remove(tabId), (await tabFor('/job/1')).id);
    await pause(1500);
    assert.equal(log.released.length, 0);
    assert.ok(await tabFor('/form/1'));

    // What the Manager types stays: QTS never fills a box twice.
    const second = await pageFor('/form/2');
    await second.bringToFront();
    await second.evaluate(() => { document.getElementById('fn').value = ''; });
    await second.type('#fn', 'Rado');
    await second.select('#hear', 'Friend');
    await second.type('#why', 'I like Spark.');
    await second.click('#ok');
    await pause(5000);
    assert.equal((await read('/form/2', ['fn'])).fn, 'Rado');
    // "Fill again": an answer QTS filled and the Manager emptied is filled again; what the Manager wrote stays.
    await second.evaluate(() => { const box = document.getElementById('np'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); });
    await panelSays('/form/2', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[1].attemptId, action: 'refill' });
    await until('filled again', async () => (await read('/form/2', ['np']))?.np === 'Immediately', 20000);
    assert.deepEqual(await read('/form/2', ['fn', 'why', 'cv']), { fn: 'Rado', why: 'I like Spark.', cv: 1 });

    // The site's own Submit is never watched: nothing is recorded.
    await second.click('button[type=submit]');
    await pause(2000);
    assert.deepEqual([log.submitted.length, log.results.length, log.released.length], [0, 0, 0]);
    assert.ok(await tabFor('/form/2'));
    // Submitted on the panel: one bid (with the form's answers) and the job row deleted.
    await panelSays('/form/2', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[1].attemptId, action: 'submitted' });
    await until('the bid saved', () => log.results.length === 1);
    assert.equal(log.submitted[0].attemptId, jobs[1].attemptId);
    assert.ok(log.submitted[0].appliedAnswers.some((answer) => /First name/.test(answer.question) && answer.answer === 'Rado'));
    assert.deepEqual([log.results[0].attemptId, log.results[0].submitted, log.results[0].removeJob], [jobs[1].attemptId, true, true]);
    await until('the second page closed', async () => !(await tabFor('/form/2')));

    // The third job's site is slow; the Manager closes it while it loads: nothing is recorded, its
    // place frees at once (not after the page would have loaded), and the fourth job opens.
    await until('the third page', async () => Boolean(await tabFor('/slow/3')));
    const closedAt = Date.now();
    await worker.evaluate(async (tabId) => chrome.tabs.remove(tabId), (await tabFor('/slow/3')).id);
    await until('the closed page released', () => log.released.length === 1, 20000);
    assert.deepEqual([log.released[0].attemptId, log.released[0].mode], [jobs[2].attemptId, 'drop']);
    assert.ok(log.released[0].at - closedAt < 10000, `released ${log.released[0].at - closedAt} ms after the close`);
    await until('the fourth page', async () => Boolean(await tabFor('/login/4')));
    assert.deepEqual(log.claims[3], [jobs[2].job.id]);

    // The fourth job (another candidate) starts on a sign-in page: the Manager's to type (QTS fills
    // nothing there); the panel holds the site account password to copy, as dots.
    await until('the sign-in panel', async () => {
      const tab = await tabFor('/login/4');
      const [frame] = await worker.evaluate((tabId) => chrome.scripting.executeScript({
        target: { tabId }, func: () => globalThis.__qtsApplyAssist ? document.querySelector('[data-qts-apply-assist]') !== null : false,
      }), tab.id);
      return frame?.result;
    });
    await pause(3000);
    assert.deepEqual(await read('/login/4', ['lu', 'lp']), { lu: '', lp: '' });
    const fourth = await pageFor('/login/4');
    await fourth.bringToFront();
    await fourth.type('#lu', 'ola.test@example.com');
    await fourth.type('#lp', PASSWORD);
    await fourth.click('#login button');
    // Create account: also the Manager's; QTS leaves it empty.
    await until('the account page', async () => Boolean(await read('/register/4', ['rf'])));
    await pause(3000);
    assert.deepEqual(await read('/register/4', ['rf', 'rl', 're', 'rp', 'rc']), { rf: '', rl: '', re: '', rp: '', rc: '' });
    const steps = await pageFor('/register/4');
    for (const [id, text] of [['#rf', 'Ola'], ['#rl', 'Nowak'], ['#re', 'ola.test@example.com'], ['#rp', PASSWORD], ['#rc', PASSWORD]]) await steps.type(id, text);
    // The first job's form keeps its own candidate.
    assert.equal((await read('/form/1', ['em'])).em, 'radu.test@example.com');

    // The application in steps, on one address: each step's new boxes are filled, the Manager's
    // phone stays, and a pop-up's box is filled when it opens.
    await steps.click('#reg button');
    await until('step 1 filled', async () => (await read('/steps/4', ['e1']))?.e1 === 'ola.test@example.com');
    const onSteps = await pageFor('/steps/4');
    await onSteps.click('#next');
    await until('step 2 filled', async () => (await read('/steps/4', ['e2']))?.e2 === 'ola.test@example.com', 15000);
    assert.equal((await read('/steps/4', ['p2'])).p2, '+48 600 000 000');
    await onSteps.click('#more');
    await until('the pop-up filled', async () => (await read('/steps/4', ['city']))?.city === 'Krakow', 15000);
    // The site's Submit on the last step: still nothing recorded until Submitted.
    await onSteps.click('button[type=submit]');
    await pause(1500);
    assert.deepEqual([log.submitted.length, log.results.length], [1, 1]);
    await panelSays('/steps/4', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[3].attemptId, action: 'submitted' });
    await until('the fourth bid', () => log.results.length === 2);
    assert.deepEqual([log.results[1].attemptId, log.results[1].removeJob], [jobs[3].attemptId, true]);
    await until('the fourth page closed', async () => !(await tabFor('/steps/4')));

    // The first job: Submitted at the bottom of the panel, one bid.
    await panelSays('/form/1', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[0].attemptId, action: 'submitted', answers: [] });
    await until('the first bid', () => log.results.length === 3);
    assert.deepEqual(log.results.map((result) => result.attemptId), [jobs[1].attemptId, jobs[3].attemptId, jobs[0].attemptId]);
    assert.deepEqual(log.submitted.map((entry) => entry.attemptId), [jobs[1].attemptId, jobs[3].attemptId, jobs[0].attemptId]);
    await until('the first page closed', async () => !(await tabFor('/form/1')));
    // The résumé was prepared once per job that uploads it (jobs 1 and 2), not on every page.
    assert.equal(log.documents, 2);
    assert.equal(log.aiAsked, undefined);

    // Apply turned off with nothing open: nothing more is recorded.
    await worker.evaluate(() => chrome.storage.local.set({ qtsExtensionStatus: null }));
    await pause(1500);
    assert.equal(log.released.length, 1);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
});
