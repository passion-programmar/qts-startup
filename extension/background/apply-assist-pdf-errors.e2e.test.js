// Local API, real MV3 runner/panel/reader and real origin-private files. No external applications.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));
const paths = { resumePath: 'QTS_Resume/Run/Resume (1).pdf', coverLetterPath: 'QTS_Resume/Run/Letter (2).pdf' };
const pdf = [...Buffer.from('%PDF-1.7\nSaved original bytes\n'), 0, 255, 128];

async function until(label, check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function retryButton(page, buttonClass = 'retry-fill', text = null) {
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node) => {
      const index = node.attributes?.indexOf('class');
      if (node.nodeName === 'BUTTON' && index >= 0 && node.attributes[index + 1].split(' ').includes(buttonClass) && (!text || JSON.stringify(node.children).includes(text))) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    const node = find(root);
    assert.ok(node, `the actual panel shows ${buttonClass}`);
    await client.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId });
    const { model } = await client.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  } finally {
    await client.detach();
  }
}

async function setPanelValue(page, className, value) {
  const client = await page.createCDPSession();
  try {
    const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node) => {
      const index = node.attributes?.indexOf('class');
      if (index >= 0 && node.attributes[index + 1].split(' ').includes(className)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = find(child); if (found) return found; }
      return null;
    };
    const node = find(root); assert.ok(node, `panel control ${className} exists`);
    const { object } = await client.send('DOM.resolveNode', { nodeId: node.nodeId });
    await client.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(value) { this.value = value; this.dispatchEvent(new Event("change", { bubbles: true })); this.dispatchEvent(new Event("input", { bubbles: true })); }', arguments: [{ value }] });
  } finally { await client.detach(); }
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

test('Assisted Apply pauses on exact-path/file/permission errors, retries only on request, survives restart, and cannot refill after Cancel', { skip: !CHROME, timeout: 240000 }, async () => {
  const requests = [], queue = [], held = new Map();
  let answerRows = [];
  let pathsAvailable = true, documentsGate = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/form') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<h1>Apply for Engineer</h1><form onsubmit="event.preventDefault()">
        <label for="first">First name</label><input id="first" required>
        <label for="last">Last name</label><input id="last" required>
        <label for="email">Email</label><input id="email" type="email" required>
        <label for="resume">Resume</label><input id="resume" type="file" required>
        <label for="cover">Cover letter</label><input id="cover" type="file">
        <button type="submit">Submit application</button></form>`);
      return;
    }
    let reply = { success: true, features: { canUseApply: true, autoApplyParallelLimit: 1 }, rules: [], exclusions: [], leaseSeconds: 120 };
    if (url.pathname === '/api/extension/apply/claim') {
      const application = queue.shift() || null;
      if (application) held.set(application.attemptId, application);
      reply = { success: true, application };
    }
    if (url.pathname === '/api/extension/apply/resume') reply = { success: true, application: held.get(body.attemptId) };
    if (url.pathname === '/api/extension/apply/answer-library') {
      assert.ok(held.has(body.attemptId));
      if (body.action === 'save') answerRows = [{ id: '77777777-7777-4777-8777-777777777777', version: '123.000001', scope: 'manager', questionText: body.answer.question, answer: body.answer.answer, variants: [] }];
      if (body.action === 'delete') { assert.equal(body.answer.version, answerRows[0].version); answerRows = []; }
      reply = { success: true, savedAnswers: answerRows, editableAnswers: answerRows };
    }
    if (url.pathname === '/api/extension/apply/documents') {
      if (documentsGate) await documentsGate;
      if (pathsAvailable) reply = { success: true, documents: paths };
      else { res.statusCode = 404; reply = { success: false, message: 'The exact Generation PDF paths are unavailable. Run Generation again before applying.' }; }
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.resolve('extension')], args: ['--no-first-run'] });
    let target = await browser.waitForTarget((t) => t.type() === 'service_worker');
    let worker = await connectWorker(target);
    // Keep an extension page open before initializing IndexedDB-backed auth in a fresh profile.
    const control = await browser.newPage();
    await control.goto(await worker.evaluate(() => chrome.runtime.getURL('settings/apply-pdfs.html')));
    await worker.evaluate(async (base) => {
      await chrome.storage.local.set({ qtsServerUrl: base });
      await self.__qtsAccountAuth.storeAuth('local-fixture-token', { id: 'manager', role: 'manager' }, Date.now() + 3600000);
    }, base);
    const prepareFiles = (missingCover = false) => control.evaluate(async (paths, bytes, missingCover) => {
      const root = await navigator.storage.getDirectory();
      const downloads = await root.getDirectoryHandle('Downloads', { create: true });
      const folder = await (await downloads.getDirectoryHandle('QTS_Resume', { create: true })).getDirectoryHandle('Run', { create: true });
      for (const pathname of [paths.resumePath, paths.coverLetterPath]) {
        const filename = pathname.split('/').at(-1);
        if (missingCover && pathname === paths.coverLetterPath) { await folder.removeEntry(filename).catch(() => {}); continue; }
        const output = await (await folder.getFileHandle(filename, { create: true })).createWritable();
        await output.write(new Uint8Array(bytes));
        await output.close();
      }
      await self.__qtsScannerDocumentStore.putSetting(self.__qtsApplyLocalPdfs.SETTING_KEY, downloads);
    }, paths, pdf, missingCover);
    const action = (name) => control.evaluate((action) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action }), name);
    const docsCount = () => requests.filter((r) => r.path === '/api/extension/apply/documents').length;
    const info = (id) => worker.evaluate((id) => {
      const review = activeReviews.get(id);
      return review ? { panel: review.panel, stopped: review.assistant.stopped, busy: review.assistant.navigationRuns.size } : null;
    }, id);
    const begin = async (index) => {
      const id = `11111111-1111-4111-8111-11111111111${index}`;
      queue.push({ attemptId: id, aiMode: 'chatgpt', autoSubmit: false, reviewMode: 'every_step',
        job: { id: `22222222-2222-4222-8222-22222222222${index}`, url: `${base}/form?case=${index}`, title: 'Engineer', company: 'Fixture', resumeFolder: 'QTS_Resume/Run', resumeText: 'Saved resume', coverLetterText: 'Saved letter' },
        candidate: { firstName: 'Casey', lastName: 'Example', email: 'casey@example.test' }, profileDetails: { experiences: [], educations: [] },
        savedAnswers: [], rememberedChoices: [], exchangeRates: null, answerPrompt: null, siteAccountPassword: null,
      });
      const started = await action('apply');
      assert.equal(started.ok, true, JSON.stringify(started));
      const form = await until('the application tab', async () => (await browser.pages()).find((p) => p.url() === `${base}/form?case=${index}`));
      return { id, form };
    };
    const paused = (id) => until('the actionable paused panel', async () => { const state = await info(id); return state?.panel?.retryFill && !state.busy ? state.panel : null; });
    const stop = async (id) => {
      assert.equal((await action('cancel_status')).ok, true);
      await until('cancel cleanup', async () => !(await info(id)) && (await worker.evaluate(() => chrome.storage.local.get('qtsExtensionStatus'))).qtsExtensionStatus == null);
    };

    for (const [index, failure] of ['paths', 'file', 'permission'].entries()) {
      await prepareFiles(failure === 'file');
      pathsAvailable = failure !== 'paths';
      if (failure === 'permission') await worker.evaluate(() => {
        self.originalFolderQuery = FileSystemDirectoryHandle.prototype.queryPermission;
        FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt';
      });
      const before = docsCount();
      let { id, form } = await begin(index);
      const panel = await paused(id);
      console.log(`[Assisted Apply PDF] ${failure}: actionable error displayed`);
      assert.match(panel.status, /Autofill paused.*Retry autofill/);
      assert.match(panel.problems[0].message, failure === 'paths' ? /saved PDF paths.*QTS administrator/i : failure === 'permission' ? /permission is unavailable.*Apply PDFs folder/ : /existing Generation PDFs.*exact saved files/);
      if (failure === 'file') assert.match(panel.problems[0].message, /could not be found|missing|not found/i, 'the native missing-file cause is retained');
      assert.equal(docsCount(), before + 1);
      assert.equal((await worker.evaluate(async (id) => (await chrome.storage.local.get('qtsApplySessions')).qtsApplySessions[id], id)).fillError, panel.problems[0].message);
      await form.type('#first', 'Manager edit');
      await worker.evaluate(async (id) => {
        const tab = activeReviews.get(id).tabId;
        await chrome.scripting.executeScript({ target: { tabId: tab }, func: async (id) => {
          for (let i = 0; i < 3; i++) await chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', assist: true, attemptId: id, action: 'fields_changed' });
        }, args: [id] });
      }, id);
      assert.equal(docsCount(), before + 1, 'ordinary page events never retry a paused read');
      if (failure === 'paths') {
        // The toolbar must reveal this application, not toggle the launcher hidden behind it.
        await worker.evaluate(async (id) => {
          const tabId = activeReviews.get(id).tabId;
          await chrome.scripting.executeScript({ target: { tabId }, func: () => {
            globalThis.__qtsApplyAssist.remove();
          } });
          const reply = await sendToolbarClick(await chrome.tabs.get(tabId));
          if (reply?.ok !== true) throw new Error('Toolbar did not restore the owned Apply panel.');
        }, id);
        await form.waitForSelector('[data-qts-apply-assist]');
        assert.equal(docsCount(), before + 1, 'toolbar restoration does not retry paused PDFs');
        await retryButton(form, 'pause-fill');
        await until('Manager pause', async () => (await info(id))?.panel?.manualPaused === true);
        const claimsBeforeHandoff = requests.filter((request) => request.path === '/api/extension/apply/claim').length;
        const child = await worker.evaluate(async (id, url) => chrome.tabs.create({ openerTabId: activeReviews.get(id).tabId, url }), id, `${base}/form?child=1`);
        const childPage = await until('owned child tab', async () => (await browser.pages()).find((page) => page.url() === `${base}/form?child=1`));
        await childPage.waitForSelector('[data-qts-apply-assist]');
        assert.equal(docsCount(), before + 1, 'child panel does not retry paused PDFs');
        await until('original tab closes after continuation panel is ready', () => form.isClosed());
        assert.deepEqual(await worker.evaluate((id) => [...activeReviews.get(id).tabIds], id), [child.id]);
        assert.equal(requests.filter((request) => request.path === '/api/extension/apply/claim').length, claimsBeforeHandoff, 'closing the parent does not claim a replacement job');
        form = childPage;
        await form.type('#first', 'Manager edit');
        console.log('[Assisted Apply panel] continuation replaced the original without retrying PDFs or ending the attempt');
        // Stop just the worker; retain the same form/tab and saved pause.
        await worker.evaluate(() => { self.__task2BeforeStop = true; });
        const cdp = await browser.target().createCDPSession();
        const { targetInfos } = await cdp.send('Target.getTargets');
        const old = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('service-worker.js'));
        await cdp.send('Target.closeTarget', { targetId: old.targetId });
        await cdp.detach();
        const wake = await browser.newPage();
        await wake.goto(control.url());
        worker = await until('the new worker context', async () => {
          for (const entry of browser.targets().filter((t) => t.type() === 'service_worker')) {
            const candidate = await connectWorker(entry);
            if (await candidate.evaluate(() => !self.__task2BeforeStop && Boolean(self.__qtsApplyRunner)).catch(() => false)) return candidate;
          }
          return null;
        });
        await wake.close();
        await worker.evaluate(() => { self.__qtsApplyRunner.processApplyQueue(); });
        const restored = await paused(id);
        assert.equal(restored.problems[0].message, panel.problems[0].message);
        assert.equal(restored.manualPaused, true, 'Manager pause survives continuation and worker restart');
        await retryButton(form, 'pause-fill');
        await until('explicit Resume clears only Manager pause', async () => (await info(id))?.panel?.manualPaused === false);
        assert.equal((await info(id)).panel.retryFill, true, 'Resume cannot bypass the separate PDF error');
        assert.equal(docsCount(), before + 1, 'restart preserves the pause without retrying documents');
        console.log('[Assisted Apply PDF] pause restored after worker restart');
      }
      if (failure === 'file') {
        await retryButton(form);
        await until('the explicit retry request', () => docsCount() === before + 2);
        await paused(id);
        assert.equal(docsCount(), before + 2, 'an unsuccessful explicit retry pauses again exactly once');
      }
      pathsAvailable = true;
      await prepareFiles();
      if (failure === 'permission') await worker.evaluate(() => { FileSystemDirectoryHandle.prototype.queryPermission = self.originalFolderQuery; });
      await retryButton(form);
      await form.waitForFunction(() => document.getElementById('resume').files.length === 1 && document.getElementById('cover').files.length === 1);
      const uploaded = await form.evaluate(async () => ({ first: document.getElementById('first').value,
        resume: [...new Uint8Array(await document.getElementById('resume').files[0].arrayBuffer())],
        cover: [...new Uint8Array(await document.getElementById('cover').files[0].arrayBuffer())],
      }));
      assert.deepEqual(uploaded, { first: 'Manager edit', resume: pdf, cover: pdf });
      await until('the cleared error', async () => { const state = await info(id); return state && !state.panel.retryFill && !state.panel.filling && !state.panel.problems.length; });
      if (failure === 'paths') {
        await retryButton(form, 'pause-fill');
        await until('Manager pause before explicit answer edits', async () => (await info(id))?.panel?.manualPaused === true);
        await retryButton(form, 'card-head', 'Reusable answers');
        await retryButton(form, 'answer-editor-open');
        await until('answer library loaded', () => requests.some((r) => r.path.endsWith('/answer-library') && r.body.action === 'load'));
        await until('answer editor load finished', () => worker.evaluate((id) => !activeReviews.get(id).assistant.answerEditBusy, id));
        await setPanelValue(form, 'answer-editor-select', 'new');
        await setPanelValue(form, 'answer-editor-question', 'Additional details');
        await setPanelValue(form, 'answer-editor-value', 'Explicit Manager answer');
        assert.equal(requests.filter((r) => r.path.endsWith('/answer-library') && r.body.action === 'save').length, 0);
        await retryButton(form, 'answer-editor-save');
        await until('explicit answer saved', () => answerRows.length === 1);
        await until('answer save finished', () => worker.evaluate((id) => !activeReviews.get(id).assistant.answerEditBusy, id));
        assert.equal((await info(id)).panel.manualPaused, true);
        assert.equal(await form.$eval('#first', (node) => node.value), 'Manager edit');
        await setPanelValue(form, 'answer-editor-select', `saved:${answerRows[0].id}`);
        await retryButton(form, 'answer-editor-delete');
        await until('explicit answer deleted', () => answerRows.length === 0);
        assert.equal((await info(id)).panel.manualPaused, true);
        assert.equal(await form.$eval('#first', (node) => node.value), 'Manager edit');
        console.log('[Assisted Apply answers] explicit Save/Delete preserved Manager edits and pause');
      }
      await stop(id);
      const release = requests.filter((r) => r.path === '/api/extension/apply/release').at(-1);
      assert.equal(release.body.mode, 'drop');
      console.log(`[Assisted Apply PDF] ${failure}: paused, recovered, original bytes preserved, cancelled safely`);
    }

    // A PDF request that finishes after Cancel cannot upload or republish an old panel.
    let unblock;
    documentsGate = new Promise((resolve) => { unblock = resolve; });
    await worker.evaluate(() => {
      self.testFills = 0;
      const originalFill = fillAndCheck;
      fillAndCheck = (...args) => { self.testFills++; return originalFill(...args); };
      const originalFetch = fetchApplyDocuments;
      fetchApplyDocuments = async (...args) => { try { return await originalFetch(...args); } finally { self.testReadFinished = true; } };
    });
    const count = docsCount();
    const { id } = await begin(3);
    await until('the pending PDF request', () => docsCount() === count + 1);
    await stop(id);
    unblock();
    await until('the cancelled PDF read to finish', () => worker.evaluate(() => self.testReadFinished === true));
    assert.equal(await worker.evaluate(() => self.testFills), 0);
    assert.equal(await info(id), null);
    assert.equal(await worker.evaluate(async (id) => Boolean((await chrome.storage.local.get('qtsApplySessions')).qtsApplySessions?.[id]), id), false);
    assert.equal(requests.some((r) => /\/submitted$|\/result$|\/save-bid$|\/generation\/|\/answers$|\/api\/pdf\/print/.test(r.path)), false);
  } catch (error) {
    console.error('Local PDF error test requests:', requests.slice(-12).map((r) => r.path));
    throw error;
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
