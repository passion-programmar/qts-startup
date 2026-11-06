// Actual extension UI/worker/IndexedDB/files/reader/uploads; local mock API only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const paths = { resumePath: 'QTS_Resume/Run/Original (1).pdf', coverLetterPath: 'QTS_Resume/Run/Letter (2).pdf' };
const originalResume = [...Buffer.from('%PDF-1.7\nOriginal resume\n'), 0, 255, 128];
const originalCover = [...Buffer.from('%PDF-1.7\nOriginal letter\n'), 255, 0, 129];

async function until(label, check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function panelButton(page, className) {
  await page.bringToFront();
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node) => {
      const index = node.attributes?.indexOf('class');
      if (node.nodeName === 'BUTTON' && index >= 0 && node.attributes[index + 1].split(' ').includes(className)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    const node = find(root);
    assert.ok(node, `the actual panel shows ${className}`);
    await client.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId });
    const { model } = await client.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  } finally {
    await client.detach();
  }
}

async function connectWorker(target) {
  const session = await target.createCDPSession();
  await session.send('Runtime.enable');
  await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
  return { evaluate: (fn, ...args) => session.send('Runtime.evaluate', {
    expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
  }).then((reply) => {
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  }) };
}

test('normal Apply explicitly relinks exact original PDFs, handles conflicts, stays paused, and safely retries', { skip: !CHROME, timeout: 180000 }, async () => {
  const requests = [], queue = [], held = new Map();
  let linked = false, conflict = true, responseGate = null;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, recovery: url.searchParams.get('recovery'), body });
    if (url.pathname === '/form') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<h1>Apply for Engineer</h1><form onsubmit="event.preventDefault()"><label for="first">First name</label><input id="first"><label for="resume">Resume</label><input id="resume" type="file"><label for="cover">Cover letter</label><input id="cover" type="file"><button type="submit">Submit application</button></form>');
      return;
    }
    let reply = { success: true, features: { canUseApply: true, autoApplyParallelLimit: 1 }, rules: [], exclusions: [], leaseSeconds: 120 };
    if (url.pathname === '/api/extension/apply/claim') {
      const application = queue.shift() || null;
      if (application) held.set(application.attemptId, application);
      reply = { success: true, application };
    }
    if (url.pathname === '/api/extension/apply/resume') reply = { success: true, application: held.get(body.attemptId) };
    if (url.pathname === '/api/extension/apply/documents') {
      if (url.searchParams.get('recovery') === '1') reply = { success: true, recovery: {
        attemptId: url.searchParams.get('attemptId'), jobId: 'job', generationId: '22222222-2222-4222-8222-222222222222',
        candidateName: 'Casey Example', title: 'Engineer', company: 'Fixture', resumePath: 'QTS_Resume/Run/Original.pdf', coverLetterPath: null,
      } };
      else if (linked) reply = { success: true, documents: paths };
      else { res.statusCode = 404; reply = { success: false, code: 'PDF_RELINK_REQUIRED', message: 'The cover-letter path is missing. Link existing PDFs to confirm both original files.' }; }
    }
    if (url.pathname === '/api/extension/apply/documents/relink') {
      if (conflict) { res.statusCode = 409; reply = { success: false, message: 'The saved paths changed. Reload recovery and review both original PDFs.' }; }
      else { linked = true; reply = { success: true }; }
      if (responseGate) await responseGate;
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 30000, enableExtensions: [path.resolve('extension')], args: ['--no-first-run'] });
    console.log('[relink] Chrome launched');
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker');
    console.log('[relink] worker target found');
    let worker = await connectWorker(target);
    console.log('[relink] worker CDP connected');
    const control = await browser.newPage();
    const settingsUrl = await worker.evaluate(() => chrome.runtime.getURL('settings/apply-pdfs.html'));
    await control.goto(settingsUrl);
    await worker.evaluate(async (base) => {
      await chrome.storage.local.set({ qtsServerUrl: base });
      await self.__qtsAccountAuth.storeAuth('local-fixture-token', { id: 'manager', role: 'manager' }, Date.now() + 3600000);
    }, base);
    console.log('[relink] local auth configured');
    await control.evaluate(async (paths, resumeBytes, coverBytes) => {
      const root = await navigator.storage.getDirectory();
      const downloads = await root.getDirectoryHandle('Downloads', { create: true });
      const folder = await (await downloads.getDirectoryHandle('QTS_Resume', { create: true })).getDirectoryHandle('Run', { create: true });
      for (const [name, bytes] of [[paths.resumePath.split('/').at(-1), resumeBytes], [paths.coverLetterPath.split('/').at(-1), coverBytes], ['Original.pdf', resumeBytes]]) {
        const stream = await (await folder.getFileHandle(name, { create: true })).createWritable();
        await stream.write(new Uint8Array(bytes)); await stream.close();
      }
      await self.__qtsScannerDocumentStore.putSetting(self.__qtsApplyLocalPdfs.SETTING_KEY, await downloads.getDirectoryHandle('QTS_Resume'));
    }, paths, originalResume, originalCover);
    console.log('[relink] original local files ready');
    const action = (name) => control.evaluate((action) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action }), name);
    const info = (id) => worker.evaluate((id) => activeReviews.get(id)?.panel, id);
    const begin = async (index) => {
      linked = false;
      const id = `11111111-1111-4111-8111-11111111111${index}`;
      queue.push({ attemptId: id, aiMode: 'chatgpt', autoSubmit: false, reviewMode: 'every_step',
        job: { id: 'job', url: `${base}/form?case=${index}`, title: 'Engineer', company: 'Fixture', resumeFolder: 'QTS_Resume/Run', resumeText: 'Saved resume', coverLetterText: 'Saved letter' },
        candidate: { firstName: 'Casey', lastName: 'Example', email: 'casey@example.test' }, profileDetails: { experiences: [], educations: [] },
        savedAnswers: [], rememberedChoices: [], exchangeRates: null, answerPrompt: null, siteAccountPassword: null,
      });
      assert.equal((await action('apply')).ok, true);
      const form = await until('the application page', async () => (await browser.pages()).find(p => p.url() === `${base}/form?case=${index}`));
      await until('the recoverable pause', async () => (await info(id))?.relinkPdfs);
      return { id, form };
    };
    const openRecovery = async (id, form) => {
      const opened = browser.waitForTarget(t => t.url() === `${settingsUrl}?attemptId=${id}`);
      await panelButton(form, 'link-pdfs');
      const page = await (await opened).page();
      await page.waitForFunction(() => document.querySelector('#recovery-fields').disabled === false);
      assert.equal(await page.$eval('#resume-file', el => el.value), '');
      assert.equal(await page.$eval('#cover-file', el => el.value), '');
      return page;
    };
    const select = async (page) => {
      await page.select('#resume-file', 'Original (1).pdf'); await page.select('#cover-file', 'Letter (2).pdf');
      await page.waitForFunction(() => !document.querySelector('#confirm-originals').disabled);
      await page.click('#confirm-originals');
    };
    const docs = () => requests.filter(r => r.path === '/api/extension/apply/documents');
    const saves = () => requests.filter(r => r.path === '/api/extension/apply/documents/relink');
    const { id, form } = await begin(0);
    console.log('[relink] normal Apply paused');
    // A PDF error pauses only the uploads: the profile's first name was filled meanwhile.
    await form.$eval('#first', (box) => { box.value = ''; });
    await form.type('#first', 'Manager edit');
    assert.equal(docs().length, 1);
    assert.equal(await worker.evaluate(async (id) => (await chrome.storage.local.get('qtsApplySessions')).qtsApplySessions[id].relinkRequired, id), true);

    // Restart the worker: recoverable metadata must survive along with the original pause.
    await worker.evaluate(() => { self.beforeRelinkRestart = true; });
    const cdp = await browser.target().createCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets');
    await cdp.send('Target.closeTarget', { targetId: targetInfos.find(t => t.type === 'service_worker').targetId });
    await cdp.detach();
    console.log('[relink] old worker stopped');
    const wake = await browser.newPage(); await wake.goto(settingsUrl);
    worker = await until('the restarted worker', async () => {
      for (const target of browser.targets().filter(t => t.type() === 'service_worker')) {
        const candidate = await connectWorker(target);
        if (await candidate.evaluate(() => !self.beforeRelinkRestart && Boolean(self.__qtsApplyRunner)).catch(() => false)) return candidate;
      }
      return null;
    });
    await worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
    await until('the restored recovery action', async () => (await info(id))?.relinkPdfs);
    await wake.close(); assert.equal(docs().length, 1, 'restart never refetches a paused document');
    console.log('[relink] recoverable pause restored');

    const recovery = await openRecovery(id, form);
    console.log('[relink] recovery page opened');
    assert.equal(docs().length, 2); assert.equal(saves().length, 0);
    await select(recovery);
    assert.equal(docs().length, 2, 'selection and local preview add no API requests');
    await recovery.click('#save-links');
    await recovery.waitForFunction(() => document.querySelector('#recovery-status').textContent.includes('Reload recovery'));
    assert.equal(await recovery.$eval('#save-links', el => el.disabled), true);
    assert.equal(saves().length, 1);
    conflict = false;
    await recovery.click('#reload-recovery');
    await recovery.waitForFunction(() => !document.querySelector('#recovery-fields').disabled);
    await select(recovery); await recovery.click('#save-links');
    await recovery.waitForFunction(() => document.querySelector('#recovery-status').textContent.includes('still paused'));
    assert.equal(saves().length, 2);
    assert.deepEqual(saves()[1].body, { attemptId: id, generationId: '22222222-2222-4222-8222-222222222222',
      expectedResumePath: 'QTS_Resume/Run/Original.pdf', expectedCoverLetterPath: null, ...paths });
    assert.equal(await form.$eval('#resume', el => el.files.length), 0, 'saving cannot initiate upload');
    assert.equal((await info(id)).retryFill, true);
    await panelButton(form, 'retry-fill');
    await form.waitForFunction(() => document.querySelector('#resume').files.length === 1 && document.querySelector('#cover').files.length === 1);
    const uploaded = await form.evaluate(async () => ({ first: document.querySelector('#first').value,
      resumeName: document.querySelector('#resume').files[0].name, coverName: document.querySelector('#cover').files[0].name,
      resume: [...new Uint8Array(await document.querySelector('#resume').files[0].arrayBuffer())],
      cover: [...new Uint8Array(await document.querySelector('#cover').files[0].arrayBuffer())] }));
    assert.deepEqual(uploaded, { first: 'Manager edit', resumeName: 'Original (1).pdf', coverName: 'Letter (2).pdf', resume: originalResume, cover: originalCover });
    assert.equal(docs().length, 4, 'one failed read, two explicitly opened contexts, one explicit retry');
    assert.equal((await action('cancel_status')).ok, true);
    await until('the canceled review', async () => !(await info(id)));
    await recovery.close();

    // The metadata write has succeeded but its response arrives only after Cancel.
    const second = await begin(1);
    const pendingPage = await openRecovery(second.id, second.form);
    await select(pendingPage);
    let finish; responseGate = new Promise(resolve => { finish = resolve; });
    await pendingPage.click('#save-links');
    await until('the pending save', () => saves().length === 3);
    await action('cancel_status'); await until('cancel before response', async () => !(await info(second.id)));
    finish();
    await pendingPage.waitForFunction(() => document.querySelector('#recovery-status').textContent.includes('Apply stopped'));
    assert.equal(await info(second.id), undefined);
    assert.equal(requests.some(r => /\/generation\/|\/api\/pdf\/print|\/submitted$|\/save-bid$|\/result$/.test(r.path)), false);
    console.log('[normal Apply recovery] exact original uploads, explicit conflict resolution, persisted pause, metadata-only saves and late-response cancellation passed');
  } catch (error) {
    console.error('[relink] last local requests', requests.slice(-12));
    throw error;
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
