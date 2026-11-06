// Actual Windows files, real MV3 worker and IndexedDB; only QTS API responses are local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((file) => file && fs.existsSync(file));
const documents = { resumePath: 'QTS_Resume/Manager/Run/Résumé (1).pdf', coverLetterPath: 'QTS_Resume/Manager/Run/Cover # % (2).pdf' };
const resume = Buffer.from('%PDF-1.7\nOriginal resume\n\x00\xff\x80', 'latin1');
const cover = Buffer.from('%PDF-1.7\nOriginal cover letter\n\xff\x00\x81', 'latin1');
async function until(label, check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function connectWorker(target) {
  const session = await target.createCDPSession();
  await session.send('Runtime.enable');
  await session.send('Runtime.runIfWaitingForDebugger');
  return { evaluate: async (fn, ...args) => {
    const reply = await session.send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  } };
}

test('direct local PDFs survive closed settings/restart, upload original bytes in both modes, and fail closed on denied access', { skip: process.platform !== 'win32' || !CHROME, timeout: 240000 }, async () => {
  let documentsAllowed = true;
  const requests = [], queue = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    requests.push({ path: pathname, body });
    if (pathname === '/job' || pathname === '/form') {
      res.setHeader('Content-Type', 'text/html');
      res.end(pathname === '/job' ? '<h1>Synthetic job</h1>' : '<h1>Apply</h1><form onsubmit="event.preventDefault()"><label>First name<input id="first" required></label><label>Last name<input id="last" required></label><label>Email<input id="email" type="email" required></label><label>Resume<input id="resume" type="file" required></label><label>Cover letter<input id="cover" type="file"></label><button type="submit">Submit application</button></form>');
      return;
    }
    let reply = { success: true, rules: [], exclusions: [], features: { canUseApply: true, autoApplyParallelLimit: 1 }, leaseSeconds: 120 };
    if (pathname === '/api/extension/apply/claim') reply = { success: true, application: queue.shift() || null };
    if (pathname === '/api/extension/apply/documents') {
      if (!documentsAllowed) { res.statusCode = 403; reply = { success: false, message: 'Application access denied.' }; }
      else reply = { success: true, documents };
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(path.resolve('.pdf-verification'), { recursive: true });
  const fixture = fs.mkdtempSync(path.resolve('.pdf-verification/direct-pdf-'));
  for (const [relative, bytes] of [[documents.resumePath, resume], [documents.coverLetterPath, cover]]) {
    const filename = path.join(fixture, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes);
  }
  const rootPath = path.join(fixture, 'QTS_Resume');
  const launch = (install = true) => require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 30000, userDataDir: path.join(fixture, 'profile'), enableExtensions: install ? [path.resolve('extension')] : true, args: ['--no-first-run'] });
  let browser;
  try {
    browser = await launch();
    let target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://') && t.url().includes('service-worker.js'));
    let worker = await connectWorker(target);
    const settingsUrl = await worker.evaluate(() => chrome.runtime.getURL('settings/apply-pdfs.html'));
    const settings = await browser.newPage(); await settings.goto(settingsUrl);
    console.log('[direct PDFs] initial settings opened');
    await settings.waitForFunction(() => document.getElementById('file-access-status').dataset.state === 'denied');
    await worker.evaluate(async (base) => {
      await chrome.storage.local.set({ qtsServerUrl: base });
      await self.__qtsAccountAuth.storeAuth('fixture-token', { id: 'manager', role: 'manager' }, Date.now() + 3600000);
    }, base);
    await settings.reload();
    await settings.waitForFunction(() => document.getElementById('file-folder-path').disabled === false);
    assert.equal(await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess()), true, 'isolated unpacked Chrome enables file URLs; this is checked rather than mocked');
    await settings.type('#file-folder-path', rootPath); await settings.click('#save-file-access');
    await settings.waitForFunction(() => document.getElementById('file-access-status').dataset.state === 'ready');
    assert.equal(await settings.$eval('#folder-picker-settings', (section) => section.hidden), true, 'inactive picker warnings are hidden');
    await settings.close();
    const assertNoSettings = async () => assert.equal((await browser.pages()).some((p) => p.url().startsWith(settingsUrl)), false);
    await assertNoSettings();
    let read = await worker.evaluate(() => fetchApplyDocuments('fixture-attempt'));
    assert.deepEqual(Buffer.from(read.resume.base64, 'base64'), resume);
    assert.deepEqual(Buffer.from(read.coverLetter.base64, 'base64'), cover);
    console.log('[direct PDFs] real bytes read with settings closed');
    await browser.close(); browser = await launch();
    target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://') && t.url().includes('service-worker.js')); worker = await connectWorker(target);
    // No extension-origin tab is opened after restart; all work comes from ordinary web tabs.
    const job = await browser.newPage(); await job.goto(`${base}/job`);
    await assertNoSettings();
    read = await worker.evaluate(() => fetchApplyDocuments('fixture-attempt'));
    assert.deepEqual(Buffer.from(read.resume.base64, 'base64'), resume);
    assert.deepEqual(Buffer.from(read.coverLetter.base64, 'base64'), cover);
    assert.equal(await worker.evaluate(async () => Boolean((await self.__qtsScannerDocumentStore.getSetting('applyPdfDownloadsDirectoryV1'))?.value)), false, 'no folder handle was granted');
    console.log('[direct PDFs] real bytes and saved configuration survived full Chrome restart');
    const action = (name) => worker.evaluate(async ({ url, name }) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
      const [reply] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (action) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action }), args: [name] });
      return reply.result;
    }, { url: `${base}/job`, name });
    for (const [i, mode] of ['apply', 'auto_apply'].entries()) {
      queue.push({ attemptId: `11111111-1111-4111-8111-11111111111${i}`, aiMode: 'chatgpt', autoSubmit: false, reviewMode: 'every_step',
        job: { id: `22222222-2222-4222-8222-22222222222${i}`, url: `${base}/form?mode=${mode}`, title: 'Engineer', company: 'Fixture', resumeFolder: 'QTS_Resume/Manager/Run', resumeText: 'Saved resume', coverLetterText: 'Saved letter' },
        candidate: { firstName: 'Casey', lastName: 'Example', email: 'casey@example.test' }, profileDetails: { experiences: [], educations: [] }, savedAnswers: [], rememberedChoices: [], exchangeRates: null, answerPrompt: null, siteAccountPassword: null });
      await worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplyAi: 'off' }));
      assert.equal((await action(mode)).ok, true);
      const form = await until(`${mode} form`, async () => (await browser.pages()).find((p) => p.url().startsWith(`${base}/form?mode=${mode}`)));
      await form.waitForFunction(() => document.getElementById('resume').files.length === 1 && document.getElementById('cover').files.length === 1, { timeout: 45000 });
      const files = await form.evaluate(async () => Promise.all(['resume', 'cover'].map(async (id) => { const file = document.getElementById(id).files[0]; return { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] }; })));
      assert.deepEqual(files, [{ name: 'Résumé (1).pdf', bytes: [...resume] }, { name: 'Cover # % (2).pdf', bytes: [...cover] }]);
      await assertNoSettings();
      console.log(`[direct PDFs] ${mode} uploaded exact original filenames and binary bytes with settings closed`);
      assert.equal((await action('cancel_status')).ok, true);
      await until(`${mode} stopped`, async () => (await worker.evaluate(() => chrome.storage.local.get('qtsExtensionStatus'))).qtsExtensionStatus == null);
    }
    // Instrument actual file fetches: server authorization must precede every read.
    console.log('[direct PDFs] checking documents authorization failure');
    await worker.evaluate(() => { self.__directPdfReads = 0; const nativeFetch = self.fetch; self.fetch = (url, ...args) => { if (String(url).startsWith('file:')) self.__directPdfReads++; return nativeFetch(url, ...args); }; });
    documentsAllowed = false;
    const denied = await worker.evaluate(async () => { try { await fetchApplyDocuments('fixture-attempt'); return null; } catch (error) { return { message: error.message, skip: error.skip, keepTab: error.keepTab }; } });
    assert.deepEqual(denied, { message: 'Application access denied.', skip: false, keepTab: true });
    assert.equal(await worker.evaluate(() => self.__directPdfReads), 0);
    console.log('[direct PDFs] unauthorized documents caused zero local reads');
    documentsAllowed = true;
    // Toggle the real Chrome setting through chrome://extensions, not a mocked permission API.
    const details = await browser.newPage();
    const extensionId = new URL(settingsUrl).host;
    await details.goto(`chrome://extensions/?id=${extensionId}`);
    // CDP can load unpacked extensions with Developer mode off; Chrome disables them on reload.
    // Match the normal unpacked-install workflow in this isolated test profile before toggling.
    await details.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    console.log('[direct PDFs] opening native Chrome permission setting');
    const point = await until('Chrome file URL permission toggle', () => details.evaluate(() => {
      const row = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-detail-view')?.shadowRoot?.querySelector('#allow-on-file-urls');
      const toggle = row?.shadowRoot?.querySelector('cr-toggle') || row;
      if (!toggle) return null;
      toggle.scrollIntoView(); const box = toggle.getBoundingClientRect(); return box.width ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    }));
    await details.mouse.click(point.x, point.y);
    console.log('[direct PDFs] clicked native Chrome permission toggle');
    // Puppeteer can retain a dead worker target after Chrome's permission-triggered reload.
    // Verify the persisted denial after a fresh restart, without reinstalling the extension.
    await browser.close(); browser = await launch(false);
    const afterRevocation = await browser.newPage(); await afterRevocation.goto(`${base}/job`);
    target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://') && t.url().includes('service-worker.js')); worker = await connectWorker(target);
    assert.equal(await worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess()), false);
    const reopened = await browser.newPage(); await reopened.goto(settingsUrl);
    await reopened.waitForFunction(() => document.getElementById('file-access-status').dataset.state === 'revoked');
    assert.equal(await reopened.$eval('#file-folder-path', (input) => input.value), rootPath);
    await reopened.close();
    console.log('[direct PDFs] native revocation and saved path persisted through restart');
    await worker.evaluate(() => { self.__directPdfReads = 0; const nativeFetch = self.fetch; self.fetch = (url, ...args) => { if (String(url).startsWith('file:')) self.__directPdfReads++; return nativeFetch(url, ...args); }; });
    const revoked = await worker.evaluate(async () => { try { await fetchApplyDocuments('fixture-attempt'); return null; } catch (error) { return { message: error.message, skip: error.skip, keepTab: error.keepTab }; } });
    assert.match(revoked.message, /Allow access to file URLs.*Retry autofill/); assert.equal(revoked.skip, false); assert.equal(revoked.keepTab, true);
    assert.equal(await worker.evaluate(() => self.__directPdfReads), 0, 'revoked permission fails before any file fetch');
    console.log('[direct PDFs] native Chrome permission revocation detected without local reads; saved configuration retained');
    assert.equal(requests.some((r) => r.path === '/api/pdf/print' || /\/generation\/|\/submitted$|\/result$|\/answers$/.test(r.path)), false);
    assert.equal(requests.some((r) => JSON.stringify(r.body).includes(JSON.stringify(rootPath).slice(1, -1)) || JSON.stringify(r.body).includes('%PDF')), false, 'no local path or PDF bytes sent to QTS');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
