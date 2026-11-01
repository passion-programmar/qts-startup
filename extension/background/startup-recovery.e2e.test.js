// Actual Chrome shutdown/relaunch with a persistent synthetic extension profile. Local mocks only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));

test('Chrome relaunch automatically releases interrupted work and continues only the saved selected mode', { skip: !CHROME, timeout: 180000 }, async () => {
  const calls = [];
  let offline = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    calls.push({ url: req.url, body });
    const release = /\/(release|cancel|cancel-all)$/.test(req.url);
    let reply = { success: true, features: { canUseApply: true }, rules: [], exclusions: [] };
    if (req.url.endsWith('/generation/claim')) reply = { success: true, job: null };
    if (req.url.endsWith('/apply/claim')) reply = { success: true, application: null };
    if (release && offline) { res.statusCode = 503; reply = { success: false, message: 'Temporary local test outage' }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const artifactRoot = path.resolve('.pdf-verification'); fs.mkdirSync(artifactRoot, { recursive: true });
  const wait = async check => { const until = Date.now() + 30000; while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Automatic recovery was not observed'); };
  try {
    for (const mode of ['generation', 'auto_apply', 'cancel', 'cancel_generation']) {
      const profile = fs.mkdtempSync(path.join(artifactRoot, 'startup-recovery-'));
      let browser;
      const launch = () => require('puppeteer-core').launch({ executablePath: CHROME, userDataDir: profile, headless: true, pipe: true, enableExtensions: [path.resolve('extension')], args: ['--no-first-run'] });
      try {
        browser = await launch();
        let worker = await (await browser.waitForTarget(t => t.type() === 'service_worker')).worker();
        const scope = { mode: mode === 'generation' ? 'generation' : 'auto_apply', candidateId: '11111111-1111-4111-8111-111111111111', jobIds: ['22222222-2222-4222-8222-222222222222'] };
        await worker.evaluate(async (base, mode, scope) => {
          await chrome.storage.local.set({ qtsServerUrl: base, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager' },
            qtsExtensionStatus: mode === 'auto_apply' ? 'apply' : mode === 'cancel_generation' ? 'cancel' : mode, qtsApplyKind: 'auto', qtsWorkSelection: scope,
            ...(mode === 'generation' || mode === 'cancel_generation' ? { qtsActiveGenerationJobId: scope.jobIds[0], qtsGenerationBrowserState: { jobId: scope.jobIds[0] }, ...(mode === 'cancel_generation' ? { qtsPendingGenerationCancel: true } : {}) }
              : { qtsAutoApplyRuns: { a: { attemptId: '33333333-3333-4333-8333-333333333333', jobId: scope.jobIds[0], tabId: 99999999 } } }),
          });
        }, base, mode, scope);
        await browser.close(); browser = null;
        const before = calls.length; offline = true;
        browser = await launch();
        worker = await (await browser.waitForTarget(t => t.type() === 'service_worker')).worker();
        await wait(() => calls.slice(before).some(c => /\/(release|cancel-all)$/.test(c.url))).catch(async error => {
          const diagnostic = await worker.evaluate(async () => {
            const data = await chrome.storage.local.get(['qtsExtensionStatus', 'qtsActiveGenerationJobId', 'qtsAutoApplyRuns']);
            return { status: data.qtsExtensionStatus, generationJob: Boolean(data.qtsActiveGenerationJobId), autoRuns: Object.keys(data.qtsAutoApplyRuns || {}), alarms: (await chrome.alarms.getAll()).map(a => a.name) };
          });
          throw Error(`${mode}: ${error.message}; ${JSON.stringify(diagnostic)}; calls: ${calls.slice(before).map(c => c.url).join(', ')}`);
        });
        assert.equal(calls.slice(before).some(c => c.url.endsWith('/claim')), false, 'cleanup failure blocks new claims');
        const stored = await worker.evaluate(() => chrome.storage.local.get(['qtsActiveGenerationJobId', 'qtsAutoApplyRuns', 'qtsExtensionStatus']));
        if (mode === 'generation' || mode === 'cancel_generation') assert.equal(stored.qtsActiveGenerationJobId, scope.jobIds[0]);
        else assert.equal(Object.values(stored.qtsAutoApplyRuns)[0].pendingRelease, true);
        offline = false;
        // Fire the existing recovery alarm immediately rather than waiting 30 seconds in a test.
        await worker.evaluate(mode => chrome.alarms.create(mode === 'auto_apply' ? 'qts-apply-queue' : 'qts-generation-queue', { when: Date.now() + 50 }), mode);
        if (mode === 'cancel' || mode === 'cancel_generation') {
          await wait(async () => !(await worker.evaluate(() => chrome.storage.local.get('qtsExtensionStatus'))).qtsExtensionStatus);
          assert.equal(calls.slice(before).some(c => c.url.endsWith('/claim')), false, 'Cancel never restarts a queue');
        } else {
          const endpoint = mode === 'generation' ? '/generation/claim' : '/apply/claim';
          await wait(() => calls.slice(before).some(c => c.url.endsWith(endpoint)));
          assert.deepEqual(calls.slice(before).find(c => c.url.endsWith(endpoint)).body.selection, scope);
        }
        assert.equal(calls.slice(before).some(c => /\/submitted$|\/result$|\/generation\/start$/.test(c.url)), false);
      } finally {
        await browser?.close();
        if (path.dirname(path.resolve(profile)) !== artifactRoot) throw Error('Unexpected test profile path');
        fs.rmSync(profile, { recursive: true, force: true });
      }
    }
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
