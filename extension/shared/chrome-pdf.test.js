const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const vm = require('node:vm');
const chromePdf = require('./chrome-pdf.js');
const { PDFDocument } = require('pdf-lib');
global.PDFLib = { PDFDocument };

test('the print settings are what the server sends Chrome through puppeteer', async () => {
  const util = path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core', 'lib', 'puppeteer', 'common', 'util.js');
  const { parsePDFOptions } = await import(pathToFileURL(util).href);
  // src/server/pdf/template-pdf.ts prints with page.pdf({ preferCSSPageSize: true, printBackground: true }).
  const server = parsePDFOptions({ preferCSSPageSize: true, printBackground: true });
  assert.deepEqual(chromePdf.PRINT_TO_PDF, {
    landscape: server.landscape,
    displayHeaderFooter: server.displayHeaderFooter,
    printBackground: server.printBackground,
    scale: server.scale,
    paperWidth: server.width,
    paperHeight: server.height,
    marginTop: server.margin.top,
    marginBottom: server.margin.bottom,
    marginLeft: server.margin.left,
    marginRight: server.margin.right,
    pageRanges: server.pageRanges,
    preferCSSPageSize: server.preferCSSPageSize,
    generateTaggedPDF: server.tagged,
    generateDocumentOutline: server.outline,
  });
  assert.deepEqual(chromePdf.VIEWPORT, { width: 1240, height: 1754, deviceScaleFactor: 1, mobile: false });
});

test('the template page is the QTS site\'s, as the server prints it', () => {
  assert.equal(
    chromePdf.templatePageUrl('https://qts.example.com/', 'cover-letter', 'nordic'),
    'https://qts.example.com/resume-templates/cover-letter.html?template=nordic',
  );
  assert.equal(
    chromePdf.templatePageUrl('http://localhost:3000', 'resume', 'a b'),
    'http://localhost:3000/resume-templates/resume.html?template=a%20b',
  );
});

// A stand-in for Chrome's tabs, debugger and scripting: `renderState` is what each template page
// reports. The page-count function runs as Chrome would run it in the printing tab, with the PDF
// library (here Node's copy, as global.PDFLib) injected first.
function fakeChrome({ renderState = 'ready', printFails = false, resumePages = 3, coverPages = 1, invalidPdf = false } = {}) {
  const calls = [];
  const state = { tabs: new Set(), attached: new Set(), page: '', injected: false };
  global.chrome = {
    tabs: {
      create: async (options) => { calls.push(['create', options]); state.tabs.add(7); return { id: 7 }; },
      remove: async (tabId) => { calls.push(['remove', tabId]); state.tabs.delete(tabId); },
    },
    scripting: {
      executeScript: async ({ target, files, func, args }) => {
        calls.push(['executeScript', target.tabId, files || func.name]);
        if (files) {
          state.injected = files.includes(chromePdf.PDF_LIBRARY_FILE);
          return [{ result: undefined }];
        }
        if (!state.injected) throw new Error('The PDF library was not injected first.');
        return [{ result: await func(...args) }];
      },
    },
    debugger: {
      attach: async ({ tabId }) => { calls.push(['attach', tabId, chromePdf.isPrintTab(tabId)]); state.attached.add(tabId); },
      detach: async ({ tabId }) => { calls.push(['detach', tabId]); state.attached.delete(tabId); },
      sendCommand: async (_target, method, params) => {
        calls.push([method, params]);
        // A new page has none of the scripts injected into the previous one.
        if (method === 'Page.navigate') { state.page = params.url; state.injected = false; }
        if (method === 'Runtime.evaluate' && !params.awaitPromise) {
          const document = /\/(resume|cover-letter)\.html/.exec(state.page)[1];
          return { result: { value: params.expression.includes(`/${document}.html`) ? renderState : '' } };
        }
        if (method === 'Page.printToPDF') {
          if (printFails) throw new Error('Printing is not available.');
          if (invalidPdf) return { data: Buffer.from('not a PDF').toString('base64') };
          const pdf = await PDFDocument.create();
          const pages = state.page.includes('/resume.html') ? resumePages : coverPages;
          for (let index = 0; index < pages; index += 1) pdf.addPage([595.28, 841.89]);
          return { data: await pdf.saveAsBase64() };
        }
        return {};
      },
    },
  };
  return { calls, state };
}

const job = { template: 'qts-standard', data: { candidate: { name: 'Anna </script> Kowalska' } } };

test('prints both documents in a hidden tab with the data, then closes it', async () => {
  const { calls, state } = fakeChrome();
  try {
    const printed = await chromePdf.printDocuments(job, { serverUrl: 'https://qts.example.com', windowId: 3 });
    assert.equal((await PDFDocument.load(printed.resume)).getPageCount(), 3);
    assert.equal((await PDFDocument.load(printed['cover-letter'])).getPageCount(), 1);
    assert.deepEqual(calls[0], ['create', { url: 'about:blank', active: false, windowId: 3 }]);
    // Marked as printing before any page loads, so the QTS button stays off it.
    assert.deepEqual(calls[1], ['attach', 7, true]);
    const injected = calls.find(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument')[1].source;
    assert.equal(injected, `window.RESUME_DATA = ${JSON.stringify(job.data)};`);
    // The window size is set before the first page loads, and every print uses the server's settings.
    const order = calls.map(([method]) => method);
    assert.ok(order.indexOf('Emulation.setDeviceMetricsOverride') < order.indexOf('Page.navigate'));
    assert.ok(calls.filter(([method]) => method === 'Page.printToPDF').every(([, params]) => params === chromePdf.PRINT_TO_PDF));
    assert.equal(state.tabs.size, 0);
    assert.equal(state.attached.size, 0);
    assert.equal(chromePdf.isPrintTab(7), false);
  } finally {
    delete global.chrome;
  }
});

test('any failure gives null so the server prints, and the tab still closes', async () => {
  for (const options of [{ renderState: 'error' }, { printFails: true }, { invalidPdf: true }]) {
    const { state } = fakeChrome(options);
    try {
      assert.equal(await chromePdf.printDocuments(job, { serverUrl: 'https://qts.example.com' }), null);
      assert.equal(state.tabs.size, 0);
      assert.equal(state.attached.size, 0);
    } finally {
      delete global.chrome;
    }
  }
  // Nothing to print from: no tab is opened.
  const { calls } = fakeChrome();
  try {
    assert.equal(await chromePdf.printDocuments(null, { serverUrl: 'https://qts.example.com' }), null);
    assert.equal(await chromePdf.printDocuments(job, {}), null);
    assert.equal(calls.length, 0);
  } finally {
    delete global.chrome;
  }
});

test('rejects an actual oversized cover letter without returning downloadable files, and cleans up', async () => {
  const { state, calls } = fakeChrome({ coverPages: 2 });
  try {
    await assert.rejects(chromePdf.printDocuments(job, { serverUrl: 'https://qts.example.com' }), {
      name: 'DocumentPageLimitError',
      message: 'The cover letter exceeds one A4 page. Shorten its paragraphs.',
    });
    assert.equal(calls.filter(([method]) => method === 'Page.printToPDF').length, 2);
    assert.equal(state.tabs.size, 0);
    assert.equal(state.attached.size, 0);
  } finally {
    delete global.chrome;
  }
});

test('a résumé longer than 3 pages is printed, never rejected (the template already reduced it)', async () => {
  const { state } = fakeChrome({ resumePages: 6 });
  try {
    const printed = await chromePdf.printDocuments(job, { serverUrl: 'https://qts.example.com' });
    assert.ok(printed && printed.resume && printed['cover-letter']);
    assert.equal(state.tabs.size, 0);
  } finally {
    delete global.chrome;
  }
});

test('the packaged PDF validator reads compressed PDF page trees', async () => {
  // A bare script world without Node's require/module or a DOM, as in the printing tab: the
  // packaged UMD build, then the page-count function chrome-pdf.js runs there.
  const context = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', chromePdf.PDF_LIBRARY_FILE), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'chrome-pdf.js'), 'utf8'), context);
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 2; index += 1) pdf.addPage();
  context.base64 = await pdf.saveAsBase64({ useObjectStreams: true });
  const count = await vm.runInContext('__qtsChromePdf.countPdfPagesInPage(base64)', context);
  assert.equal(count, 2);
  assert.throws(() => chromePdf.validatePageCount(count, 'cover-letter'), { name: 'DocumentPageLimitError' });
});

test('the PDF library runs in the printing tab, once per printed page, never in the worker', async () => {
  const { calls } = fakeChrome();
  try {
    assert.ok(await chromePdf.printDocuments(job, { serverUrl: 'https://qts.example.com' }));
    const scripting = calls.filter(([kind]) => kind === 'executeScript');
    assert.deepEqual(scripting, [
      ['executeScript', 7, [chromePdf.PDF_LIBRARY_FILE]], ['executeScript', 7, 'countPdfPagesInPage'],
      ['executeScript', 7, [chromePdf.PDF_LIBRARY_FILE]], ['executeScript', 7, 'countPdfPagesInPage'],
    ]);
  } finally {
    delete global.chrome;
  }
  const worker = fs.readFileSync(path.join(__dirname, '..', 'background', 'service-worker.js'), 'utf8');
  assert.equal(worker.includes('pdf-lib'), false, 'the worker does not load the PDF library');
});
