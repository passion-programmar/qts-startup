const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
// Execute the actual artifact/download functions and the queue's success path with controlled I/O.
const helpers = source.slice(source.indexOf('  function validateApplicationDownloadFiles('),
  source.indexOf('  function waitForQueuedDownload('));
const delivery = source.slice(source.indexOf('          const result = await runGenerationForTab('),
  source.indexOf('          completedCount += 1;') + '          completedCount += 1;'.length);

function pipeline({ printError = false, technicalFailure = false, interrupted = false } = {}) {
  const events = [];
  const files = ['resume', 'cover-letter', 'jd'].map((document) => ({
    downloadPath: `QTS_Resume/Manager/Candidate/${document}.${document === 'jd' ? 'txt' : 'pdf'}`,
    mimeType: document === 'jd' ? 'text/plain;charset=utf-8' : 'application/pdf',
    ...(document === 'jd' ? { base64: 'SkQ=' } : { printDocument: document }),
  }));
  const context = {
    URL, encodeURIComponent, console,
    self: {
      __qtsRuntimeConfig: { getServerUrl: async () => 'https://qts.example' },
      __qtsChromePdf: { printDocuments: async () => {
        events.push('print');
        if (printError) throw Object.assign(new Error('The résumé exceeds three A4 pages.'), { name: 'DocumentPageLimitError' });
        return technicalFailure ? null : { resume: 'UERG', 'cover-letter': 'UERG' };
      } },
    },
    chrome: { runtime: {}, downloads: { download: (options, done) => {
      events.push(`download:${options.filename}`);
      done(events.length);
    } } },
    ensureQueuedGenerationIsActive: async () => {},
    waitForQueuedDownload: async () => {
      events.push('download-complete');
      if (interrupted) throw new Error('Chrome interrupted a file download.');
    },
    workerApiRequest: async (_method, url) => {
      if (url.endsWith('/finalize')) { events.push('finalize'); return { success: true }; }
      if (url.endsWith('&print=chrome')) return { success: true, print: { template: 'minimal', data: {} }, files };
      events.push('server-print');
      return { success: true, files: files.map((file) => ({ ...file, base64: 'UERG' })) };
    },
    runGenerationForTab: async () => ({ generationId: 'run-id' }),
    updateGenerationBrowserState: async () => {},
    getTab: async () => ({ windowId: 1 }),
    reportQueuedGenerationDelivered: async () => events.push('delivered'),
    jobTabId: null, queuedJob: { id: 'job-id' }, chatTab: { id: 1 },
    downloadIds: [], generationId: '', finalizeAttempted: false, completedCount: 0,
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  return { events, run: () => vm.runInContext(`(async () => { ${delivery} })()`, context) };
}

test('Generation accepts all three downloads before finalizing and reporting delivery', async () => {
  for (const technicalFailure of [false, true]) {
    const { events, run } = pipeline({ technicalFailure });
    await run();
    assert.equal(events.filter((event) => event.startsWith('download:')).length, 3);
    assert.equal(events.filter((event) => event === 'download-complete').length, 3);
    assert.ok(events.lastIndexOf('download-complete') < events.indexOf('finalize'));
    assert.equal(events.at(-1), 'delivered');
    assert.equal(events.includes('server-print'), technicalFailure);
  }
});

test('oversized local PDFs stop Generation before downloading or finalizing, without server retry', async () => {
  const { events, run } = pipeline({ printError: true });
  await assert.rejects(run(), { name: 'DocumentPageLimitError' });
  assert.deepEqual(events, ['print']);
});

test('an interrupted download cannot finalize Generation', async () => {
  const { events, run } = pipeline({ interrupted: true });
  await assert.rejects(run(), /interrupted/);
  assert.equal(events.includes('finalize'), false);
  assert.equal(events.includes('delivered'), false);
});
