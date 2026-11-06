// Real MV3 worker, extension page, IndexedDB, directory handles, reader and form uploads.
// Only the native OS chooser is replaced with an origin-private directory. Local mock API only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));
const paths = {
  resumePath: 'QTS_Resume/Manager/Candidate/Run/Candidate (1).pdf',
  coverLetterPath: 'QTS_Resume/Manager/Candidate/Run/Candidate_Cover_Letter (2).pdf',
};
const resume = [...Buffer.from('%PDF-1.7\nOriginal resume\n'), 0, 255, 128, 42];
const cover = [...Buffer.from('%PDF-1.7\nOriginal cover letter\n'), 255, 0, 128, 17];

async function until(label, check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickFolderTool(page) {
  const client = await page.createCDPSession();
  try {
    const find = (node) => {
      const index = node.attributes?.indexOf('data-action');
      if (index >= 0 && node.attributes[index + 1] === 'apply_pdf_folder') return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const match = find(child);
        if (match) return match;
      }
      return null;
    };
    const node = await until('the visible Apply PDFs folder tool', async () => {
      const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
      const candidate = find(root);
      if (!candidate) return null;
      await client.send('DOM.scrollIntoViewIfNeeded', { nodeId: candidate.nodeId });
      const { model } = await client.send('DOM.getBoxModel', { nodeId: candidate.nodeId }).catch(() => ({}));
      return model?.width ? model : null;
    });
    const [x1, y1, , , x3, y3] = node.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  } finally {
    await client.detach();
  }
}

test('authorized Managers configure one persistent read-only folder and both Apply modes upload its exact original bytes', { skip: !CHROME, timeout: 240000 }, async () => {
  let canUseApply = false;
  const queue = [], requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    requests.push({ path: pathname, body });
    if (pathname === '/job' || pathname === '/form') {
      res.setHeader('Content-Type', 'text/html');
      res.end(pathname === '/job' ? '<h1>Synthetic job</h1>' : `<h1>Apply for Engineer</h1><form onsubmit="event.preventDefault()">
        <label for="first">First name</label><input id="first" required>
        <label for="last">Last name</label><input id="last" required>
        <label for="email">Email</label><input id="email" type="email" required>
        <label for="resume">Resume</label><input id="resume" type="file" required>
        <label for="cover">Cover letter</label><input id="cover" type="file">
        <button type="submit">Submit application</button></form>`);
      return;
    }
    let reply = { success: true, rules: [], exclusions: [], features: { canUseApply, autoApplyParallelLimit: 1 }, leaseSeconds: 120 };
    if (pathname === '/api/extension/apply/claim') reply = { success: true, application: queue.shift() || null };
    if (pathname === '/api/extension/apply/documents') reply = { success: true, documents: paths };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(path.resolve('.pdf-verification'), { recursive: true });
  const profile = fs.mkdtempSync(path.resolve('.pdf-verification/apply-folder-profile-'));
  const launch = () => require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, userDataDir: profile, enableExtensions: [path.resolve('extension')], args: ['--no-first-run'] });
  let browser;
  try {
    console.log('[folder setup] launching Chrome');
    browser = await launch();
    console.log('[folder setup] waiting for extension worker');
    let target = await browser.waitForTarget((t) => t.type() === 'service_worker');
    let worker = await target.worker();
    const settingsUrl = await worker.evaluate(() => chrome.runtime.getURL('settings/apply-pdfs.html'));
    const control = await browser.newPage();
    await control.goto(settingsUrl);
    await control.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'denied');
    assert.equal(await control.$eval('#choose-folder', (b) => b.disabled), true, 'signed out cannot configure');
    console.log('[folder setup] signed-out access refused');

    await worker.evaluate(async (base) => {
      await chrome.storage.local.set({ qtsServerUrl: base });
      await self.__qtsAccountAuth.storeAuth('synthetic-token', { id: 'manager', role: 'manager' }, Date.now() + 3600000);
    }, base);
    const action = (page, name) => page.evaluate((action) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action }), name);
    assert.equal((await action(control, 'apply_pdf_folder')).ok, false, 'Manager without Apply access cannot open setup');
    await control.reload();
    await control.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'denied');
    canUseApply = true;
    console.log('[folder setup] unauthorized Manager refused; opening supported launcher');

    const job = await browser.newPage();
    await job.goto(`${base}/job`);
    await job.bringToFront();
    const jobTabId = await until('job tab', () => worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, `${base}/job`));
    await until('supported Manager launcher', () => job.$('[data-qts-page-launcher]'));
    await worker.evaluate(async (id) => {
      await getManagerExtensionFeatures(true);
      await chrome.scripting.executeScript({ target: { tabId: id }, func: async () => {
        await globalThis.__qtsPageLauncher.syncTextHighlightAction(true);
        globalThis.__qtsPageLauncher.setOpen(true);
      } });
    }, jobTabId);
    await clickFolderTool(job);
    console.log('[folder setup] clicked folder tool');
    let folderPanel = await until('in-panel folder settings', () => job.frames().find((frame) => frame.url().endsWith('/settings/apply-pdf-folder-panel.html')));
    console.log('[folder setup] embedded folder settings opened in the QTS panel');
    await folderPanel.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'unconfigured');
    assert.equal(await folderPanel.evaluate(() => window.top === window), false);
    await folderPanel.evaluate(() => {
      window.pickerCalled = false;
      window.showDirectoryPicker = async () => {
        window.pickerCalled = true;
        throw new Error('The embedded panel must not invoke the native picker.');
      };
    });
    await folderPanel.evaluate(() => document.getElementById('choose-folder').click());
    let settings = await until('top-level folder chooser', async () => {
      const chooser = browser.targets().find((target) => target.type() === 'page' && target.url().endsWith('/settings/apply-pdf-folder-panel.html'));
      return chooser ? chooser.page() : null;
    });
    console.log('[folder setup] top-level folder chooser opened in a compact extension window');
    assert.equal(await folderPanel.evaluate(() => window.pickerCalled), false, 'embedded panel does not call the native picker');
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'unconfigured');
    assert.equal(await settings.evaluate(() => typeof showDirectoryPicker), 'function', 'native picker is available in a top-level extension window');
    assert.equal(await settings.evaluate(() => window.top === window), true);
    assert.equal(await worker.evaluate(() => self.__qtsRuntimeConfig.features.applicationAutomation), false);

    await settings.evaluate(async (paths, resume, cover) => {
      const root = await navigator.storage.getDirectory();
      const downloads = await root.getDirectoryHandle('Downloads', { create: true });
      for (const [name, bytes] of [[paths.resumePath, resume], [paths.coverLetterPath, cover]]) {
        const segments = name.split('/');
        const filename = segments.pop();
        let folder = downloads;
        for (const segment of segments) folder = await folder.getDirectoryHandle(segment, { create: true });
        const output = await (await folder.getFileHandle(filename, { create: true })).createWritable();
        await output.write(new Uint8Array(bytes));
        await output.close();
      }
      window.showDirectoryPicker = async (options) => {
        window.pickerOptions = options;
        window.pickerUserGesture = navigator.userActivation.isActive;
        return downloads.getDirectoryHandle('QTS_Resume');
      };
    }, paths, resume, cover);
    await settings.click('#choose-folder');
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'ready');
    console.log('[folder setup] selected real directory handle');
    assert.deepEqual(await settings.evaluate(() => window.pickerOptions), { mode: 'read', startIn: 'downloads' });
    assert.equal(await settings.evaluate(() => window.pickerUserGesture), true);
    await folderPanel.evaluate(() => window.dispatchEvent(new Event('focus')));
    await folderPanel.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'ready'
      && document.getElementById('folder-status').textContent.includes('Folder saved'));
    await settings.goto(settings.url());
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'ready');

    // Persist a real structured-cloned directory handle through a complete Chrome/worker restart.
    await browser.close();
    browser = await launch();
    console.log('[folder setup] Chrome restarted');
    target = await browser.waitForTarget((t) => t.type() === 'service_worker');
    worker = await target.worker();
    settings = await browser.newPage();
    await settings.goto(settingsUrl);
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'ready');
    const read = await worker.evaluate(async (paths) => {
      const saved = await self.__qtsScannerDocumentStore.getSetting(self.__qtsApplyLocalPdfs.SETTING_KEY);
      return self.__qtsApplyLocalPdfs.readApplyDocuments(saved.value, paths);
    }, paths);
    assert.deepEqual([...Buffer.from(read.resume.base64, 'base64')], resume);
    assert.deepEqual([...Buffer.from(read.coverLetter.base64, 'base64')], cover);
    console.log('[folder setup] stored handle and exact bytes survived restart');

    // Simulate a revoked grant on UI reopen; no unsolicited permission request is permitted.
    await settings.evaluate(() => {
      window.originalQuery = FileSystemDirectoryHandle.prototype.queryPermission;
      const originalRequest = FileSystemDirectoryHandle.prototype.requestPermission;
      FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt';
      FileSystemDirectoryHandle.prototype.requestPermission = async function(options) {
        window.restoreUserGesture = navigator.userActivation.isActive;
        window.restoreOptions = options;
        const permission = await originalRequest.call(this, options);
        FileSystemDirectoryHandle.prototype.queryPermission = window.originalQuery;
        return permission;
      };
      window.dispatchEvent(new Event('focus'));
    });
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'revoked');
    assert.match(await settings.$eval('#folder-status', (s) => s.textContent), /Allow saved folder access/);
    assert.equal(await settings.$eval('#choose-folder', (b) => b.disabled), false);
    await settings.click('#restore-access');
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'ready');
    assert.equal(await settings.evaluate(() => window.restoreUserGesture), true);
    assert.deepEqual(await settings.evaluate(() => window.restoreOptions), { mode: 'read' });
    await settings.reload();
    await settings.waitForFunction(() => document.getElementById('folder-status').dataset.state === 'ready');

    for (const [index, mode] of ['apply', 'auto_apply'].entries()) {
      queue.push({
        attemptId: `11111111-1111-4111-8111-11111111111${index}`, aiMode: 'chatgpt', autoSubmit: false, reviewMode: 'every_step',
        job: { id: `22222222-2222-4222-8222-22222222222${index}`, url: `${base}/form?mode=${mode}`, title: 'Engineer', company: 'Fixture', resumeFolder: 'QTS_Resume/Manager/Candidate/Run', resumeText: 'Saved resume', coverLetterText: 'Saved letter' },
        candidate: { firstName: 'Casey', lastName: 'Example', email: 'casey@example.test' },
        profileDetails: { experiences: [], educations: [] }, savedAnswers: [], rememberedChoices: [], exchangeRates: null, answerPrompt: null, siteAccountPassword: null,
      });
      await worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplyAi: 'off' }));
      assert.equal((await action(settings, mode)).ok, true, `${mode} starts after authorization`);
      console.log(`[folder setup] started ${mode}`);
      const form = await until(`${mode} form`, async () => (await browser.pages()).find((p) => p.url().startsWith(`${base}/form?mode=${mode}`)));
      await form.waitForFunction(() => document.getElementById('resume').files.length === 1 && document.getElementById('cover').files.length === 1, { timeout: 45000 });
      const uploaded = await form.evaluate(async () => {
        const file = async (id) => { const f = document.getElementById(id).files[0]; return { name: f.name, bytes: [...new Uint8Array(await f.arrayBuffer())] }; };
        return { resume: await file('resume'), cover: await file('cover') };
      });
      assert.deepEqual(uploaded.resume, { name: 'Candidate (1).pdf', bytes: resume });
      assert.deepEqual(uploaded.cover, { name: 'Candidate_Cover_Letter (2).pdf', bytes: cover });
      console.log(`[folder setup] original bytes uploaded by ${mode}`);
      assert.equal((await action(settings, 'cancel_status')).ok, true);
      await until(`${mode} stopped`, async () => (await worker.evaluate(() => chrome.storage.local.get('qtsExtensionStatus'))).qtsExtensionStatus == null);
    }
    assert.equal(requests.filter((r) => r.path === '/api/extension/apply/documents').length, 2);
    assert.equal(requests.some((r) => r.path === '/api/pdf/print' || /\/generation\/|\/submitted$|\/result$|\/answers$/.test(r.path)), false, 'no PDF rendering, Generation, AI or submission');
  } catch (error) {
    console.error('[folder setup] diagnostic', JSON.stringify({ lastRequests: requests.slice(-8).map((r) => r.path), targets: browser?.targets().map((t) => t.url()) }));
    throw error;
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
