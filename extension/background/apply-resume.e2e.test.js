// End-to-end test of the REAL extension in Chrome: a job page stays open while the extension is
// reloaded (as after an update). Apply turned on again takes the page up again (its panel comes
// back on the same tab, nothing is reopened), and Submitted still saves the bid when the
// application record is gone (the server answers 409), from the job itself. Against a local mock
// QTS server on 127.0.0.1; nothing leaves this machine. Run with: npm run test:apply-e2e (skipped
// when Chrome is not installed; QTS_CHROME sets it).
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

const PORT = 47125;
const BASE = `http://127.0.0.1:${PORT}`;
const log = { claims: 0, resumed: [], submitted: [], results: [], savedFromJob: [], released: [] };

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Apply</title></head><body>
<form onsubmit="event.preventDefault()">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="hear">How did you hear about us? *</label><input id="hear" required></div>
  <button type="submit">Submit application</button>
</form></body></html>`;

const APPLICATION = {
  attemptId: '00000000-0000-4000-8000-00000000a101',
  aiMode: 'gemini', autoSubmit: false, reviewMode: 'every_step',
  job: {
    id: '00000000-0000-4000-8000-00000000b101', url: `${BASE}/form/1`, title: 'Data Engineer', company: 'Acme',
    location: 'Remote', workType: 'Full-time', salary: null, description: 'Spark.',
    resumeFolder: null, resumeSavedOn: null, promptName: null, templateName: null, resumeText: 'CV', coverLetterText: null,
  },
  candidate: { candidateId: '00000000-0000-4000-8000-00000000c101', firstName: 'Radu', lastName: 'Star', email: 'radu.test@example.com' },
  profileDetails: { experiences: [], educations: [] },
  savedAnswers: [], exchangeRates: null, rememberedChoices: [], answerPrompt: null, siteAccountPassword: null,
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    const data = JSON.parse(body || '{}');
    const json = (reply, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(reply)); };
    if (url.pathname === '/form/1') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }); return res.end(FORM); }
    if (url.pathname === '/api/extension/apply/claim') { log.claims += 1; return json({ success: true, application: log.claims === 1 ? APPLICATION : null }); }
    if (url.pathname === '/api/extension/apply/resume') { log.resumed.push(data); return json({ success: true, application: APPLICATION }); }
    if (url.pathname === '/api/extension/apply/heartbeat') return json({ success: true, leaseSeconds: 600 });
    if (url.pathname === '/api/extension/apply/review') return json({ success: true });
    // The application record is gone (its hold ran out while the extension was away).
    if (url.pathname === '/api/extension/apply/submitted') { log.submitted.push(data); return json({ success: false, message: 'This application is no longer held by this Chrome.' }, 409); }
    if (url.pathname === '/api/extension/apply/result') { log.results.push(data); return json({ success: false, message: 'Not waiting.' }, 409); }
    if (url.pathname === '/api/extension/apply/save-bid') { log.savedFromJob.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/release') { log.released.push(data); return json({ success: true }); }
    return json({ success: true });
  });
});

const until = async (what, check, ms = 60000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await Promise.race([Promise.resolve().then(check).catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}.`);
};

test('after the extension restarts, Apply takes an open job page up again, and Submitted saves the bid from the job', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 240000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  const workerTarget = () => browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().includes('service-worker.js'),
    { timeout: 30000 },
  );
  // The worker driven through its own debugging session: after it restarts (same target), a new
  // session reaches the new worker, where an old handle would hang.
  const connect = async (target) => {
    const session = await target.createCDPSession();
    return {
      evaluate: (fn, ...args) => session.send('Runtime.evaluate', {
        expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
      }).then((reply) => {
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
        return reply.result.value;
      }),
    };
  };
  try {
    const firstTarget = await workerTarget();
    let worker = await connect(firstTarget);
    const turnOn = () => worker.evaluate(async (base) => {
      await chrome.storage.local.set({
        qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
        qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' },
        qtsApplyDryRun: false, qtsExtensionStatus: 'apply', qtsBrowserName: 'E2E Chrome',
      });
      self.__qtsApplyRunner.processApplyQueue();
    }, BASE);
    const formTab = async () => (await worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => ({ id: tab.id, url: tab.url }))))
      .find((tab) => tab.url.includes('/form/1'));
    const inTab = async (func, ...args) => {
      const tab = await formTab();
      const [frame] = await worker.evaluate((tabId, source, values) => chrome.scripting.executeScript({
        target: { tabId }, func: new Function(`return (${source})(...arguments)`), args: values,
      }), tab.id, func.toString(), args);
      return frame?.result;
    };

    await turnOn();
    await until('the job page filled', async () => (await inTab(() => document.getElementById('fn')?.value)) === 'Radu');
    const tabBefore = (await formTab()).id;
    // The open application is remembered with its tab.
    const sessions = await worker.evaluate(async () => (await chrome.storage.local.get('qtsApplySessions')).qtsApplySessions);
    assert.deepEqual(sessions[APPLICATION.attemptId], { jobId: APPLICATION.job.id, company: 'Acme', title: 'Data Engineer', tabIds: [tabBefore] });

    // The Manager answers a question, then the extension's worker stops (restarted, updated, asleep):
    // everything it held in memory is gone; only the remembered page is left.
    await inTab(() => { document.getElementById('hear').value = 'LinkedIn'; });
    await worker.evaluate(() => { self.__beforeStop = true; });
    const cdp = await browser.target().createCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets');
    const running = targetInfos.find((info) => info.type === 'service_worker' && info.url.includes('service-worker.js'));
    await cdp.send('Target.closeTarget', { targetId: running.targetId });
    // Something wakes a new worker (the panel's ping, the popup opened, an alarm): here the popup.
    const wake = await browser.newPage();
    await wake.goto(`chrome-extension://${new URL(firstTarget.url()).host}/popup/popup.html`).catch(() => {});
    worker = await until('a new worker', async () => {
      for (const target of browser.targets().filter((entry) => entry.type() === 'service_worker' && entry.url().includes('service-worker.js'))) {
        const candidate = await connect(target).catch(() => null);
        const fresh = candidate && await Promise.race([
          candidate.evaluate(() => !self.__beforeStop && Boolean(self.__qtsApplyRunner)).catch(() => false),
          new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
        ]);
        if (fresh) return candidate;
      }
      return null;
    }, 90000);
    assert.equal(await worker.evaluate(() => activeReviews.size), 0);

    // Apply (on again after an update): the same tab is taken up, nothing new is claimed or opened.
    await turnOn();
    await until('the application resumed', () => log.resumed.length === 1);
    assert.deepEqual(log.resumed[0], { attemptId: APPLICATION.attemptId, jobId: APPLICATION.job.id });
    await until('worked in again', () => worker.evaluate((id) => activeReviews.has(id), APPLICATION.attemptId));
    assert.equal((await formTab()).id, tabBefore);
    // The job is not opened a second time (the free place asks for another job: none here).
    assert.equal((await worker.evaluate(async () => (await chrome.tabs.query({})).filter((tab) => tab.url.includes('/form/1')).length)), 1);
    assert.equal(await inTab(() => document.querySelectorAll('[data-qts-apply-assist]').length), 1);
    // What the Manager wrote stays.
    assert.equal(await inTab(() => document.getElementById('hear').value), 'LinkedIn');

    // Submitted: the application record is gone (409), so the bid is saved from the job.
    // Sent without waiting for the reply: a saved bid closes this tab.
    await inTab((attemptId, jobId) => {
      chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', assist: true, attemptId, jobId, action: 'submitted' }).catch(() => {});
      return true;
    }, APPLICATION.attemptId, APPLICATION.job.id);
    await until('the bid saved from the job', () => log.savedFromJob.length === 1);
    assert.equal(log.savedFromJob[0].jobId, APPLICATION.job.id);
    assert.ok(log.savedFromJob[0].appliedAnswers.some((answer) => /hear about us/.test(answer.question) && answer.answer === 'LinkedIn'));
    await until('the page closed', async () => !(await formTab()));
    assert.equal(log.released.length, 0);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('qtsApplySessions')).qtsApplySessions), {});
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    server.close();
  }
});
