// Real extension worker, fake QTS server with no work to hand out: Generation, Apply and Auto Apply do
// not start until the QTS_Resume folder is saved (as a typed path or a chosen folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

test('Generation, Apply and Auto Apply ask for the QTS_Resume folder before starting', { skip: !CHROME, timeout: 120000 }, async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    calls.push(req.url);
    let reply = { success: true, features: { canUseApply: true, canUseAutoApply: true, autoApplyParallelLimit: 2 }, rules: [], exclusions: [] };
    if (req.url === '/api/extension/generation/claim') reply = { success: true, job: null };
    if (req.url === '/api/extension/apply/claim') reply = { success: true, application: null };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [path.resolve('extension')], args: ['--no-first-run'] });
  try {
    const worker = await (await browser.waitForTarget((t) => t.type() === 'service_worker')).worker();
    await worker.evaluate((serverUrl) => chrome.storage.local.set({
      qtsServerUrl: serverUrl, authToken: 'synthetic', authExpiresAt: Date.now() + 3600000,
      qtsSessionUser: { id: 'manager', role: 'manager' }, qtsGetJdOn: false,
    }), base);
    const control = await browser.newPage();
    await control.goto(`chrome-extension://${new URL(worker.url()).host}/signin/signin.html`);
    const ask = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
    const status = async () => (await worker.evaluate(() => chrome.storage.local.get('qtsExtensionStatus'))).qtsExtensionStatus;
    const labels = { generation: 'Generation', apply: 'Apply', auto_apply: 'Auto Apply' };

    // No folder saved: nothing starts, nothing is claimed, and the reply says what to do.
    for (const mode of ['generation', 'apply', 'auto_apply']) {
      const before = calls.length;
      const reply = await ask({ type: 'QTS_PAGE_ACTION', action: mode });
      assert.equal(reply.ok, false, mode);
      assert.equal(reply.resumeFolderRequired, true, mode);
      assert.match(reply.error, /Save the QTS_Resume folder first \(Downloads › QTS_Resume\)/);
      assert.match(reply.error, new RegExp(`then click ${labels[mode]} again`));
      assert.equal(await status(), undefined, `${mode} must not be switched on`);
      assert.equal(calls.slice(before).some((url) => url.endsWith('/claim')), false, `${mode} must not claim work`);
    }

    // Apply left on by a restarted Chrome is not started again without the folder either.
    await worker.evaluate(() => chrome.storage.local.set({ qtsExtensionStatus: 'apply' }));
    const restart = await ask({ type: 'QTS_PAGE_ACTION', action: 'apply' });
    assert.equal(restart.resumeFolderRequired, true);
    await worker.evaluate(() => chrome.storage.local.remove('qtsExtensionStatus'));

    // Either way of saving the folder lets every mode start.
    const savers = {
      'typed path': () => self.__qtsScannerDocumentStore.putSetting(
        self.__qtsApplyFileAccess.SETTING_KEY,
        self.__qtsApplyFileAccess.configuration('C:\\Users\\Manager\\Downloads\\QTS_Resume'),
      ),
      'chosen folder': () => self.__qtsScannerDocumentStore.putSetting(self.__qtsApplyLocalPdfs.SETTING_KEY, { name: 'QTS_Resume' }),
    };
    for (const [way, save] of Object.entries(savers)) {
      await worker.evaluate(async () => {
        await self.__qtsScannerDocumentStore.putSetting(self.__qtsApplyFileAccess.SETTING_KEY, null);
        await self.__qtsScannerDocumentStore.putSetting(self.__qtsApplyLocalPdfs.SETTING_KEY, null);
      });
      await worker.evaluate(save);
      for (const mode of ['generation', 'apply', 'auto_apply']) {
        const reply = await ask({ type: 'QTS_PAGE_ACTION', action: mode });
        assert.equal(reply.ok, true, `${mode} with a ${way}: ${JSON.stringify(reply)}`);
        assert.equal(reply.resumeFolderRequired, undefined);
        assert.equal((await ask({ type: 'QTS_PAGE_ACTION', action: 'cancel_status', expectedAction: mode })).ok, true);
        const end = Date.now() + 20000;
        while (await status() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
});
