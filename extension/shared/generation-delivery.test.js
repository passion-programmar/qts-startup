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
const failureTab = source.slice(source.indexOf('  async function handleQueuedGenerationFailureTab('),
  source.indexOf('  function waitForQueuedDownload('));

function pipeline({ printError = false, technicalFailure = false, interrupted = false } = {}) {
  const events = [];
  const completedDownloads = new Map();
  let nextDownloadId = 0;
  const files = ['resume', 'cover-letter', 'jd'].map((document) => ({
    downloadPath: `QTS_Resume/Manager/Candidate/${document === 'resume' ? 'Radu' : document === 'cover-letter' ? 'Radu_Cover_Letter' : 'job-description'}.${document === 'jd' ? 'txt' : 'pdf'}`,
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
    chrome: { runtime: {}, downloads: {
      download: (options, done) => {
        events.push(`download:${options.filename}`);
        const id = ++nextDownloadId;
        const uniquified = options.filename.endsWith('Radu.pdf')
          ? options.filename.replace('Radu.pdf', 'Radu (1).pdf')
          : options.filename.endsWith('Radu_Cover_Letter.pdf')
            ? options.filename.replace('Radu_Cover_Letter.pdf', 'Radu_Cover_Letter (2).pdf')
            : options.filename;
        completedDownloads.set(id, {
          id,
          state: 'complete',
          filename: `C:\\Users\\E2E\\Downloads\\${uniquified.replaceAll('/', '\\')}`,
        });
        done(id);
      },
      search: (query, done) => done([completedDownloads.get(query.id)]),
    } },
    ensureQueuedGenerationIsActive: async () => {},
    showGenerationChatGptStep: async (_tabId, step, message) => events.push(`step:${step}:${message}`),
    waitForQueuedDownload: async () => {
      events.push('download-complete');
      if (interrupted) throw new Error('Chrome interrupted a file download.');
    },
    workerApiRequest: async (_method, url, body) => {
      if (url.endsWith('/finalize')) { events.push('finalize'); context.finalizedBody = body; return { success: true }; }
      if (url.endsWith('&print=chrome')) return { success: true, print: { template: 'minimal', data: {} }, files };
      events.push('server-print');
      return { success: true, files: files.map((file) => ({ ...file, base64: 'UERG' })) };
    },
    runGenerationForTab: async () => ({ generationId: 'run-id' }),
    updateGenerationBrowserState: async () => {},
    getTab: async () => ({ windowId: 1 }),
    reportQueuedGenerationDelivered: async () => events.push('delivered'),
    jobTabId: null, queuedJob: { id: 'job-id' }, chatTab: { id: 1, jobs: 1 },
    downloadIds: [], generationId: '', finalizeAttempted: false, completedCount: 0,
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  return {
    events,
    context,
    run: () => vm.runInContext(`(async () => { ${delivery} })()`, context),
  };
}

test('Generation accepts all three downloads before finalizing and reporting delivery', async () => {
  for (const technicalFailure of [false, true]) {
    const { events, context, run } = pipeline({ technicalFailure });
    await run();
    assert.equal(events.filter((event) => event.startsWith('download:')).length, 3);
    assert.equal(events.filter((event) => event === 'download-complete').length, 3);
    assert.equal(context.chatTab.jobs, 2, 'successful delivery counts toward the ten-job conversation limit');
    assert.ok(events.some((event) => event.includes('Downloading files')));
    assert.ok(events.lastIndexOf('download-complete') < events.indexOf('finalize'));
    assert.equal(events.at(-1), 'delivered');
    assert.match(context.finalizedBody.downloadedPdfPaths.resume, /Radu \(1\)\.pdf$/);
    assert.match(context.finalizedBody.downloadedPdfPaths.coverLetter, /Radu_Cover_Letter \(2\)\.pdf$/);
    assert.equal(events.includes('server-print'), technicalFailure);
  }
});

test('a delivery failure keeps the ChatGPT conversation open for the retry', async () => {
  const removed = [];
  const steps = [];
  const context = vm.createContext({
    chrome: { tabs: { remove: async (id) => removed.push(id) } },
    showGenerationChatGptStep: async (...args) => steps.push(args),
  });
  vm.runInContext(failureTab, context);

  const chatTab = { id: 8, jobs: 1 };
  assert.equal(
    await context.handleQueuedGenerationFailureTab(chatTab, true, 'Chrome interrupted a file download.'),
    chatTab,
  );
  assert.deepEqual(removed, []);
  assert.match(steps[0][2], /Chrome interrupted a file download/);
  assert.match(steps[0][2], /Keeping this ChatGPT conversation open/);

  assert.equal(await context.handleQueuedGenerationFailureTab(chatTab, false, 'ChatGPT failed.'), null);
  assert.deepEqual(removed, [8]);
});

test('oversized local PDFs stop Generation before downloading or finalizing, without server retry', async () => {
  const { events, run } = pipeline({ printError: true });
  await assert.rejects(run(), { name: 'DocumentPageLimitError' });
  assert.deepEqual(events.filter((event) => event === 'print'), ['print']);
  assert.equal(events.some((event) => event.startsWith('download:')), false);
  assert.equal(events.some((event) => event === 'finalize'), false);
});

test('an interrupted download cannot finalize Generation', async () => {
  const { events, run } = pipeline({ interrupted: true });
  await assert.rejects(run(), /interrupted/);
  assert.equal(events.includes('finalize'), false);
  assert.equal(events.includes('delivered'), false);
});
