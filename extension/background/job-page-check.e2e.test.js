// Real extension (worker and page scripts), a fake QTS server and test pages on another site. The
// job-page check reads a page that does not change once, reads it again when the page changes (new
// content, or content only revealed) but not when only QTS's own panels open, Get JD's Manual check
// and the highlighter share one reading, and the old capture path (extractors, page watcher, the
// saved "detectedJobs") no longer runs.
// Each page gets its own Chrome: under headless Puppeteer, a second new tab in a Chrome with this
// extension sometimes never starts loading (seen before these changes too).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
const skip = !CHROME;

const RULE = { id: 'rule-1', text: 'Kubernetes', textColor: '#111111', backgroundColor: '#ffee58' };
const JOB = '<h1>Senior DevOps Engineer</h1><p>Example Corp · Remote · Full-time</p><button>Apply now</button>'
  + '<h2>Responsibilities</h2><p>Run Kubernetes clusters and CI/CD pipelines.</p>'
  + '<h2>Requirements</h2><p>Five years with cloud infrastructure.</p>';
// Hidden, a button's text and the h2-h4 headings still count (innerText of an element that is not
// rendered is its text), so the hidden job has neither: only its shown text makes it a job.
const HIDDEN_JOB = '<h1>Senior DevOps Engineer</h1>'
  + '<p><strong>Responsibilities</strong>: run Kubernetes clusters and CI/CD pipelines.</p>'
  + '<p><strong>Requirements</strong>: five years with cloud infrastructure.</p>';
const PAGES = {
  '/plain': `<!doctype html><title>Weekend recipes</title><main><h1>Weekend recipes</h1>${'<p>Slow-roasted tomatoes with garlic and thyme, served warm.</p>'.repeat(40)}</main>`,
  '/job': `<!doctype html><title>Senior DevOps Engineer</title><main>${JOB}</main>`,
  // The job arrives 2.5 s after load (after the first reading, before the last try), as on
  // single-page sites.
  '/late-job': `<!doctype html><title>Careers</title><main id="m"><p>Loading…</p></main><script>setTimeout(() => { document.getElementById('m').innerHTML = ${JSON.stringify(JOB)}; }, 2500);</script>`,
  // The job is in the page from the start, hidden; 2.5 s after load only an attribute changes.
  '/revealed-job': `<!doctype html><title>Careers</title><main><p>Open roles</p><div id="job" hidden>${HIDDEN_JOB}</div></main><script>setTimeout(() => { document.getElementById('job').hidden = false; }, 2500);</script>`,
  // After load only QTS-made things change, as when a panel opens: a host, its dock style, a flag.
  '/qts-ui-only': `<!doctype html><title>Weekend recipes</title><main><h1>Weekend recipes</h1><p>Slow-roasted tomatoes.</p></main><script>setTimeout(() => {
    const host = document.createElement('div'); host.setAttribute('data-qts-get-jd-ui', ''); host.attachShadow({ mode: 'closed' }).textContent = 'Responsibilities Requirements Apply now';
    const dock = document.createElement('style'); dock.setAttribute('data-qts-get-jd-dock-style', ''); dock.textContent = 'html[data-qts-get-jd-docked="true"] body { padding-right: 300px; }';
    document.head.append(dock); document.documentElement.append(host); document.documentElement.setAttribute('data-qts-get-jd-docked', 'true');
  }, 2500);</script>`,
};
// The check's tries end about 10 s after a page opens (GET_JD_DETECTION_ATTEMPTS).
const WHOLE_CHECK_MS = 11000;

async function visit(pathname, { getJdMode = null, watchMs = WHOLE_CHECK_MS } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    calls.push(req.url);
    const page = PAGES[req.url.split('?')[0]];
    if (page) {
      res.setHeader('Content-Type', 'text/html');
      return res.end(page);
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/extension/highlights')) return res.end(JSON.stringify({ success: true, rules: [RULE] }));
    if (req.url.startsWith('/api/extension/get-jd/mode')) return res.end(JSON.stringify({ success: true, mode: getJdMode || 'gemini' }));
    return res.end(JSON.stringify({ success: true, managerId: 'manager', rules: [], exclusions: [], features: {} }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Puppeteer stays off the worker, as a restarted worker would stay paused under it.
  const browser = await require('puppeteer-core').launch({
    executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.resolve('extension')],
    targetFilter: (target) => target.type() !== 'service_worker', args: ['--no-first-run'],
  });
  try {
    const session = await browser.target().createCDPSession();
    let extensionId = null;
    for (let i = 0; i < 100 && !extensionId; i += 1) {
      const { targetInfos } = await session.send('Target.getTargets');
      const worker = targetInfos.find((target) => target.type === 'service_worker' && target.url.includes('/background/service-worker.js'));
      if (worker) extensionId = new URL(worker.url).host;
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(extensionId, 'the extension loaded');
    const control = await browser.newPage();
    await control.goto(`chrome-extension://${extensionId}/signin/signin.html`);
    await control.evaluate(({ serverUrl, rule }) => chrome.storage.local.set({
      qtsServerUrl: serverUrl, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000,
      qtsSessionUser: { id: 'manager', role: 'manager' }, qtsGetJdOn: false,
      // The Manager's Chrome already has the shared highlight rule.
      qtsGlobalTextHighlightsCache: [rule], qtsGlobalTextHighlightsFetchedAt: Date.now(),
    }), { serverUrl: base, rule: RULE });
    if (getJdMode) {
      // As the launcher's Get JD row does; Get JD then takes the tabs opened after it.
      const turnedOn = await control.evaluate(() => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: 'get_jd' }));
      assert.equal(turnedOn.ok, true, JSON.stringify(turnedOn));
    }

    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    const scripts = [];
    cdp.on('Debugger.scriptParsed', (event) => scripts.push(event.url));
    await cdp.send('Debugger.enable');
    // Another site than the QTS server's, as real job sites are.
    await page.goto(`${base.replace('127.0.0.1', 'localhost')}${pathname}`, { waitUntil: 'load' });
    await new Promise((resolve) => setTimeout(resolve, watchMs));
    const count = (part) => scripts.filter((url) => url.includes(part)).length;
    return {
      // Each reading of the page injects the detection file again.
      readings: count('/shared/job-page-detection.js'),
      extractors: count('/content/extractors/'),
      panelWatch: count('/content/job-panel-watch.js'),
      highlights: await page.evaluate(() => document.querySelectorAll('mark[data-qts-text-highlight]').length),
      detectedJobs: (await control.evaluate(() => chrome.storage.local.get('detectedJobs'))).detectedJobs,
      calls,
    };
  } finally {
    await browser.close();
    server.close();
  }
}

test('a page that is not a job is read once over the whole check and gets no highlights', { skip, timeout: 60000 }, async () => {
  const result = await visit('/plain');
  assert.equal(result.readings, 1, 'read once, not on every try');
  assert.equal(result.highlights, 0);
});

test('a job page is read once and highlighted, and the old capture path no longer runs', { skip, timeout: 60000 }, async () => {
  const result = await visit('/job', { watchMs: 6000 });
  assert.equal(result.readings, 1);
  assert.ok(result.highlights > 0, 'the rule is highlighted on the job page');
  assert.equal(result.extractors, 0, 'no job extractors injected');
  assert.equal(result.panelWatch, 0, 'no job panel watcher injected');
  assert.equal(result.detectedJobs, undefined, 'no captured job saved');
});

test('a job that arrives after the page loads is still found: the changed page is read again', { skip, timeout: 60000 }, async () => {
  const result = await visit('/late-job');
  assert.ok(result.highlights > 0, 'found once its content arrived');
  assert.ok(result.readings >= 2, `read again after the change (${result.readings})`);
});

test('a job that is only revealed later (one attribute changes) is still found', { skip, timeout: 60000 }, async () => {
  const result = await visit('/revealed-job');
  assert.ok(result.highlights > 0, 'found once it was shown');
  assert.ok(result.readings >= 2, `read again after the change (${result.readings})`);
});

test("QTS's own panels opening on a page do not make it read again", { skip, timeout: 60000 }, async () => {
  const result = await visit('/qts-ui-only');
  assert.equal(result.readings, 1);
  assert.equal(result.highlights, 0);
});

test("Get JD's Manual check and the highlighter share one reading of the page", { skip, timeout: 60000 }, async () => {
  const result = await visit('/plain', { getJdMode: 'manual' });
  assert.ok(result.calls.some((url) => url.startsWith('/api/extension/get-jd/mode')), 'Get JD checked the page in Manual mode');
  assert.equal(result.readings, 1, 'one reading for both');
  assert.equal(result.highlights, 0);
});
