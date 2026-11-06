// End-to-end test of the REAL extension in Chrome as the Manager's assistant: its service worker, the
// Apply queue, the form engine, and the panel, against a local mock QTS server on 127.0.0.1. Two job
// pages open at once. QTS follows safe application Start/Continue actions and fills only saved
// documents, profile facts, and reusable answers on visible application forms; the Manager handles
// employer accounts and submits everything. QTS never asks
// ChatGPT or clicks final Submit.
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

const PORT = 0;
let BASE = '';
const PASSWORD = 'S1te-Acc0unt!';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');
const log = { claims: [], submitted: [], results: [], released: [], reviews: 0, documents: 0, accountLogins: [], accountRegistrations: [] };

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

// A job page with the site's search in its header and a newsletter in its footer.
const JOB_PAGE = page('Data Engineer at Acme', `
<header><form role="search" onsubmit="event.preventDefault()"><label for="sq">City</label><input id="sq"><button>Search jobs</button></form></header>
<main><h1>Data Engineer</h1><p>About the job: Spark, Airflow.</p><a href="/form/1" class="button" target="_blank">Apply now</a></main>
<footer><form class="newsletter" onsubmit="event.preventDefault()"><label for="nl">Email</label><input id="nl" type="email"><button>Subscribe</button></form></footer>`);

const MANUAL_JOB_PAGE = page('Data Engineer at Acme', `
<main><h1>Data Engineer</h1><p>Continue on the employer portal.</p>
<a id="open-portal" href="/login/4" target="_blank">Open employer portal</a></main>`);

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
<form id="login" onsubmit="event.preventDefault(); fetch('/account-login?email=' + encodeURIComponent(lu.value) + '&password=' + encodeURIComponent(lp.value)).then(() => { location.href = '/register/4'; });">
  <label for="lu">Email or username</label><input id="lu" type="text">
  <label for="lp">Password</label><input id="lp" type="password">
  <button type="submit">Sign in</button>
</form>`);
const REGISTER = page('Create account', `
<form id="reg" onsubmit="event.preventDefault(); fetch('/account-register?firstName=' + encodeURIComponent(rf.value) + '&lastName=' + encodeURIComponent(rl.value) + '&email=' + encodeURIComponent(re.value) + '&password=' + encodeURIComponent(rp.value) + '&confirmation=' + encodeURIComponent(rc.value)).then(() => { location.href = '/steps/4'; });">
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
    + '<label for="p2">Phone *</label><input id="p2" type="tel" required>'
    + '<label for="co">Country *</label><select id="co" required><option value="">Select…</option><option>Poland</option><option>Romania</option></select>'
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
  savedAnswers: [{ questionKey: 'notice period', questionText: 'Notice period', answer: 'Immediately', note: null, scope: 'candidate' }], // Notice is a candidate fact: never from an all-candidates answer.
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
let jobs = [];

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
    if (url.pathname === '/manual/4') return html(MANUAL_JOB_PAGE);
    if (url.pathname === '/login/4') return html(LOGIN);
    if (url.pathname === '/register/4') return html(REGISTER);
    if (url.pathname === '/steps/4') return html(STEPS);
    if (url.pathname === '/account-login') {
      log.accountLogins.push({ email: url.searchParams.get('email'), password: url.searchParams.get('password') });
      return json({});
    }
    if (url.pathname === '/account-register') {
      log.accountRegistrations.push({
        firstName: url.searchParams.get('firstName'),
        lastName: url.searchParams.get('lastName'),
        email: url.searchParams.get('email'),
        password: url.searchParams.get('password'),
        confirmation: url.searchParams.get('confirmation'),
      });
      return json({});
    }
    if (url.pathname === '/api/extension/features/me') {
      return json({ success: true, features: { autoApplyParallelLimit: 2 } });
    }
    if (url.pathname === '/api/extension/apply/claim') {
      log.claims.push(data.skipJobIds || []);
      return json({ success: true, application: jobs[log.claims.length - 1] || null });
    }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
    if (url.pathname === '/api/extension/apply/review') { log.reviews += 1; return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/documents') {
      log.documents += 1;
      return json({ success: true, documents: {
        resumePath: 'QTS_Resume/Manager/Candidate/Run/CV.pdf',
        coverLetterPath: 'QTS_Resume/Manager/Candidate/Run/Cover.pdf',
      } });
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

test('normal Apply navigates safely, fills saved values, and pauses for manual account steps', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 420000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  jobs = [job(1, `${BASE}/job/1`, RADU), job(4, `${BASE}/manual/4`, OLA)];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  try {
    const workerEval = async (func, ...args) => {
      const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
      const worker = await target.worker();
      if (!worker) throw new Error('The extension service worker is not running.');
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
        configurable: true,
        value: { getSetting: async (key) => ({ value: key === 'applyPdfDownloadsDirectoryV1' ? {} : null }) },
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
    const tabs = () => workerEval(async () => (await chrome.tabs.query({})).map((tab) => ({ id: tab.id, url: tab.url || tab.pendingUrl || '', active: tab.active })));
    const tabFor = async (part) => (await tabs()).find((tab) => tab.url.includes(part));
    const pageFor = async (part) => (await browser.pages()).find((page) => page.url().includes(part));
    const execute = async (part, func, args = []) => {
      const page = await pageFor(part);
      return page ? (await page.evaluate(func, ...args) ?? null) : null;
    };
    const panelSays = async (part, message) => {
      const tab = await tabFor(part);
      if (!tab) throw new Error(`Could not find the application tab for ${part}.`);
      return workerEval((tabId, value) => chrome.scripting.executeScript({
        target: { tabId }, func: (payload) => chrome.runtime.sendMessage(payload), args: [value],
      }), tab.id, message);
    };
    const read = async (part, ids) => {
      return execute(part, (wanted) => {
        const out = {};
        for (const id of wanted) {
          const box = document.getElementById(id);
          out[id] = !box ? null : box.type === 'file' ? box.files.length : box.type === 'checkbox' ? box.checked : box.value;
        }
        return out;
      }, [ids]);
    };
    const FORM_IDS = ['fn', 'ln', 'em', 'ph', 'co', 'np', 'hear', 'why', 'cl', 'cv', 'ok'];
    const knownFormValues = {
      fn: 'Radu', ln: 'Star', em: 'radu.test@example.com', ph: '+40264484948', co: 'Romania', np: 'Immediately',
      hear: '', why: '', cl: 'Dear Hiring Manager,\nI would like to join Acme.', cv: 1, ok: false,
    };

    try {
      await until('the application form and manual sign-in page', async () => {
      const paths = (await tabs()).filter((tab) => tab.url.startsWith(BASE)).map((tab) => new URL(tab.url).pathname);
      return paths.includes('/form/1') && paths.includes('/manual/4');
      });
    } catch (error) {
      console.error('Initial Apply state:', JSON.stringify({ claims: log.claims, reviews: log.reviews, tabs: await tabs() }));
      throw error;
    }
    await until('both review panels', () => log.reviews === 2);
    try {
      await until('application form controls', async () => await read('/form/1', FORM_IDS) !== null, 15000);
    } catch (error) {
      console.error('Form tab after navigation:', JSON.stringify(await tabs()));
      throw error;
    }
    await until('manual job page controls', async () => await execute('/manual/4', () => Boolean(document.querySelector('#open-portal'))));
    try {
      await until('saved normal Apply values', async () => {
        const values = await read('/form/1', FORM_IDS);
        return values?.fn === knownFormValues.fn && values?.cv === knownFormValues.cv && values?.np === knownFormValues.np;
      });
    } catch (error) {
      console.error('Normal Apply form state:', JSON.stringify({
        values: await read('/form/1', FORM_IDS),
        status: await execute('/form/1', () => document.querySelector('[data-qts-apply-assist]')?.shadowRoot?.querySelector('.status')?.textContent || null),
        documents: log.documents,
      }));
      throw error;
    }
    assert.deepEqual(await read('/form/1', FORM_IDS), knownFormValues);
    assert.equal(log.documents, 1);
    assert.equal(log.aiAsked, undefined);
    assert.deepEqual(log.accountLogins, []);
    assert.deepEqual(log.accountRegistrations, []);

    await execute('/manual/4', () => document.querySelector('#open-portal').click());
    await until('the new sign-in tab opened from the Manager click', async () => Boolean(await tabFor('/login/4')));
    await until('the sign-in page panel', async () => await execute('/login/4', () => Boolean(document.querySelector('[data-qts-apply-assist]'))));
    assert.deepEqual(await read('/login/4', ['lu', 'lp']), { lu: '', lp: '' });
    await execute('/login/4', (email, password) => {
      document.querySelector('#lu').value = email;
      document.querySelector('#lp').value = password;
      document.querySelector('#login button').click();
      return true;
    }, ['ola.test@example.com', PASSWORD]);
    await until('the sign-in page to advance', async () => Boolean(await tabFor('/register/4')));
    await until('registration controls', async () => await read('/register/4', ['rf', 'rl', 're', 'rp', 'rc']) !== null);
    assert.deepEqual(log.accountLogins, [{ email: 'ola.test@example.com', password: PASSWORD }]);
    assert.deepEqual(await read('/register/4', ['rf', 'rl', 're', 'rp', 'rc']), { rf: '', rl: '', re: '', rp: '', rc: '' });

    await execute('/register/4', (password) => {
      document.querySelector('#rf').value = 'Ola';
      document.querySelector('#rl').value = 'Nowak';
      document.querySelector('#re').value = 'ola.test@example.com';
      document.querySelector('#rp').value = password;
      document.querySelector('#rc').value = password;
      document.querySelector('#reg button').click();
      return true;
    }, [PASSWORD]);
    await until('the application form after manual account steps', async () => Boolean(await tabFor('/steps/4')));
    await until('application step controls', async () => await read('/steps/4', ['e1']) !== null);
    await until('the form panel to finish navigation', () => log.reviews === 2);
    assert.equal((await read('/steps/4', ['e1'])).e1, '');
    assert.deepEqual(log.accountRegistrations, [{
      firstName: 'Ola', lastName: 'Nowak', email: 'ola.test@example.com',
      password: PASSWORD, confirmation: PASSWORD,
    }]);
    assert.equal(log.documents, 1);
    assert.equal(log.aiAsked, undefined);

    // The Manager can mark Submitted at any time; this saves the bid, removes the row and closes
    // the application's tabs without QTS clicking the employer's Submit.
    await panelSays('/form/1', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[0].attemptId, action: 'submitted', answers: [] });
    await until('the first job saved and its tabs closed', async () => log.results.length === 1 && !(await tabFor('/form/1')));
    assert.deepEqual([log.results[0].attemptId, log.results[0].submitted, log.results[0].removeJob], [jobs[0].attemptId, true, true]);
    assert.equal(await execute('/steps/4', () => window.submitted), null);
    await execute('/steps/4', (email) => {
      document.querySelector('#e1').value = email;
      document.querySelector('#next').click();
    }, ['ola.test@example.com']);
    await until('profile and reusable values on the visible next form step', async () => {
      const values = await read('/steps/4', ['e2', 'p2', 'co']);
      return values?.e2 === 'ola.test@example.com' && values.p2 === '+48600111222' && values.co === 'Poland';
    });
    assert.deepEqual(await read('/steps/4', ['e2', 'p2', 'co']), {
      e2: 'ola.test@example.com', p2: '+48600111222', co: 'Poland',
    });
    await execute('/steps/4', () => document.querySelector('#more').click());
    await until('profile city on the new form control', async () => (await read('/steps/4', ['city']))?.city === 'Krakow');
    // The Manager's click on the employer's Submit does not itself save in QTS.
    await execute('/steps/4', () => document.querySelector('button[type=submit]').click());
    await pause(500);
    assert.equal(await execute('/steps/4', () => window.submitted), true);
    assert.equal(log.results.length, 1);
    await panelSays('/steps/4', { type: 'QTS_APPLY_PANEL', assist: true, attemptId: jobs[1].attemptId, action: 'submitted', answers: [] });
    await until('the second bid saved', () => log.results.length === 2);
    assert.deepEqual([log.results[1].attemptId, log.results[1].submitted, log.results[1].removeJob], [jobs[1].attemptId, true, true]);
    assert.equal(log.submitted.length, 2);
    assert.equal(log.documents, 1);
    assert.equal(log.aiAsked, undefined);
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
});
