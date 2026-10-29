// End-to-end test of the REAL extension in Chrome: the Resume page's Download printed in this Chrome
// (content/qts-site-bridge.js → QTS_PRINT_DOCUMENTS → shared/resume-print-requests.js and
// shared/chrome-pdf.js). Invalid requests print nothing, identical requests made together print
// once, different ones print each, a failed print can be retried, and no print tab or request is
// left behind. Against a local mock QTS site on 127.0.0.1; nothing leaves this machine. The /pdf page
// speaks the bridge protocol of src/app/pdf/pdf-workspace.tsx. Run with: npm run test:apply-e2e
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

const PORT = 47127;
const OTHER_PORT = 47128;
const BASE = `http://127.0.0.1:${PORT}`;
const templates = path.join(root, 'public', 'resume-templates');
const sample = JSON.parse(fs.readFileSync(path.join(templates, 'data', 'sample-full.json'), 'utf8'));
const job = (template, fullName = sample.candidate.fullName) => ({
  template,
  data: { ...sample, candidate: { ...sample.candidate, fullName }, theme: { ...sample.theme, template } },
});

const PAGE = `<!doctype html><meta charset="utf-8"><title>Resume</title><body><script>
window.ask = (message, timeoutMs) => new Promise((resolve) => {
  const requestId = crypto.randomUUID();
  const done = (answer) => { window.removeEventListener('message', listen); clearTimeout(timer); resolve(answer); };
  const listen = (event) => {
    if (event.source !== window || !event.data || typeof event.data !== 'object' || event.data.source !== 'qts-extension') return;
    if (event.data.requestId === requestId) done(event.data);
  };
  const timer = setTimeout(() => done(null), timeoutMs);
  window.addEventListener('message', listen);
  window.postMessage({ source: 'qts-app', requestId, ...message }, window.location.origin);
});
</script></body>`;

const log = { api: [], failTemplates: false };
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
function serve(req, res) {
  const url = new URL(req.url, BASE);
  if (url.pathname === '/pdf') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  } else if (url.pathname.startsWith('/resume-templates/')) {
    // A print that cannot load its template fails at once.
    if (log.failTemplates) {
      req.socket.destroy();
      return;
    }
    const file = path.join(templates, decodeURIComponent(url.pathname.slice('/resume-templates/'.length)));
    if (!file.startsWith(templates) || !fs.existsSync(file)) res.writeHead(404).end();
    else res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  } else {
    if (url.pathname.startsWith('/api/')) log.api.push(`${req.method} ${url.pathname}`);
    res.writeHead(404).end();
  }
}
const server = http.createServer(serve);
const otherSite = http.createServer(serve);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isPdf = (base64) => typeof base64 === 'string' && Buffer.from(base64, 'base64').subarray(0, 5).toString() === '%PDF-';

test('the Resume page prints in this Chrome: checked, once per request, retried after a failure, nothing left over', {
  skip: CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).',
  timeout: 300000,
}, async () => {
  const puppeteer = require('puppeteer-core');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  await new Promise((resolve) => otherSite.listen(OTHER_PORT, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 600000,
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run'],
  });
  try {
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'), { timeout: 30000 });
    const worker = await target.worker();
    await worker.evaluate(async (base) => chrome.storage.local.set({ qtsServerUrl: base }), BASE);
    const page = await browser.newPage();
    await page.goto(`${BASE}/pdf`);
    const ask = (message, timeoutMs = 75000) => page.evaluate((m, t) => window.ask(m, t), message, timeoutMs);
    // The bridge listens once the worker has confirmed this is the QTS site.
    for (let tries = 0; !(await ask({ type: 'ping' }, 500))?.print; tries += 1) {
      assert.ok(tries < 20, 'the bridge answered');
      await sleep(250);
    }

    // The hidden tabs chrome-pdf.js prints in, counted while `run` goes on.
    const printTabs = async () => (await worker.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.id + ' ' + (tab.url || tab.pendingUrl || ''))))
      .filter((tab) => / about:blank$|\/resume-templates\//.test(tab));
    const startTabs = (await printTabs()).length;
    async function counting(run) {
      let most = 0;
      let watching = true;
      const watcher = (async () => {
        while (watching) {
          most = Math.max(most, (await printTabs().catch(() => [])).length - startTabs);
          await sleep(40);
        }
      })();
      try {
        return { result: await run(), most: () => most };
      } finally {
        watching = false;
        await watcher;
      }
    }

    // A valid résumé and cover letter.
    const valid = await counting(() => ask({ type: 'print-documents', job: job('harvard') }));
    assert.equal(valid.result.ok, true);
    assert.ok(isPdf(valid.result.resume) && isPdf(valid.result.coverLetter));
    assert.equal(valid.most(), 1);

    // Invalid requests: refused with a reason, and no print tab is opened.
    for (const [bad, reason] of [
      [{ ...job('harvard'), data: 'x' }, /no résumé data/],
      [{ template: 'harvard' }, /no résumé data/],
      [{ ...job('harvard'), data: { ...job('harvard').data, candidate: {} } }, /candidate name/],
      [undefined, /no document/],
      [{ ...job('harvard'), template: 'no-such-template' }, /QTS templates/],
    ]) {
      const refused = await counting(() => ask({ type: 'print-documents', job: bad }));
      assert.equal(refused.result.ok, false);
      assert.equal(refused.result.invalid, true);
      assert.match(refused.result.error, reason);
      assert.equal(refused.result.resume, undefined);
      assert.equal(refused.most(), 0);
    }

    // Two identical requests at once: one print tab, the same files for both.
    const same = await counting(() => Promise.all([
      ask({ type: 'print-documents', job: job('classic') }),
      ask({ type: 'print-documents', job: job('classic') }),
    ]));
    assert.deepEqual(same.result.map((answer) => answer.ok), [true, true]);
    assert.equal(same.result[0].resume, same.result[1].resume);
    assert.equal(same.result[0].coverLetter, same.result[1].coverLetter);
    assert.equal(same.most(), 1);

    // Two different requests at once: each prints, and each gets its own files.
    const different = await counting(() => Promise.all([
      ask({ type: 'print-documents', job: job('classic', 'Ana Pop') }),
      ask({ type: 'print-documents', job: job('classic', 'Ion Ionescu') }),
    ]));
    assert.deepEqual(different.result.map((answer) => answer.ok), [true, true]);
    assert.notEqual(different.result[0].resume, different.result[1].resume);
    assert.equal(different.most(), 2);

    // A print that fails answers { ok: false } (the page then asks the server); the retry prints.
    log.failTemplates = true;
    const failed = await ask({ type: 'print-documents', job: job('swiss') });
    log.failTemplates = false;
    assert.deepEqual({ ok: failed.ok, invalid: failed.invalid }, { ok: false, invalid: undefined });
    const retried = await ask({ type: 'print-documents', job: job('swiss') });
    assert.equal(retried.ok, true);
    assert.ok(isPdf(retried.resume));

    // Another site is refused by the worker itself.
    const other = await browser.newPage();
    await other.goto(`http://127.0.0.1:${OTHER_PORT}/pdf`);
    const otherTab = await worker.evaluate(async (prefix) => (await chrome.tabs.query({})).find((tab) => tab.url.startsWith(prefix))?.id, `http://127.0.0.1:${OTHER_PORT}`);
    const direct = await worker.evaluate(async (tabId, j) => (await chrome.scripting.executeScript({
      target: { tabId }, func: (m) => chrome.runtime.sendMessage(m), args: [{ type: 'QTS_PRINT_DOCUMENTS', job: j }],
    }))[0]?.result, otherTab, job('harvard'));
    assert.equal(direct.ok, false);
    assert.match(direct.error, /Only the QTS site/);

    // Nothing left: no print tab, no request held, no server call.
    await sleep(500);
    assert.equal((await printTabs()).length, startTabs);
    assert.equal(await worker.evaluate(() => self.__qtsResumePrints.inFlightCount()), 0);
    assert.deepEqual(log.api, []);
  } finally {
    await browser.close();
    for (const site of [server, otherSite]) {
      site.closeAllConnections?.();
      site.close();
    }
  }
});
