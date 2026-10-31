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
    chromePdf.templatePageUrl('https://qts.example.com/', 'cover-letter', 'modern-serif'),
    'https://qts.example.com/resume-templates/cover-letter.html?template=modern-serif',
  );
  assert.equal(
    chromePdf.templatePageUrl('http://localhost:3000', 'resume', 'a b'),
    'http://localhost:3000/resume-templates/resume.html?template=a%20b',
  );
});

// A stand-in for Chrome's tabs and debugger: `renderState` is what each template page reports.
function fakeChrome({ renderState = 'ready', printFails = false, resumePages = 3, coverPages = 1, invalidPdf = false } = {}) {
  const calls = [];
  const state = { tabs: new Set(), attached: new Set(), page: '' };
  global.chrome = {
    tabs: {
      create: async (options) => { calls.push(['create', options]); state.tabs.add(7); return { id: 7 }; },
      remove: async (tabId) => { calls.push(['remove', tabId]); state.tabs.delete(tabId); },
    },
    debugger: {
      attach: async ({ tabId }) => { calls.push(['attach', tabId, chromePdf.isPrintTab(tabId)]); state.attached.add(tabId); },
      detach: async ({ tabId }) => { calls.push(['detach', tabId]); state.attached.delete(tabId); },
      sendCommand: async (_target, method, params) => {
        calls.push([method, params]);
        if (method === 'Page.navigate') state.page = params.url;
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

test('rejects actual oversized PDFs without returning downloadable files, and cleans up', async () => {
  for (const options of [{ resumePages: 4 }, { coverPages: 2 }]) {
    const { state, calls } = fakeChrome(options);
    try {
      await assert.rejects(chromePdf.printDocuments(job, { serverUrl: 'https://qts.example.com' }), {
        name: 'DocumentPageLimitError',
        message: options.resumePages
          ? 'The résumé exceeds three A4 pages. Its content was not truncated.'
          : 'The cover letter exceeds one A4 page. Shorten its paragraphs.',
      });
      assert.equal(calls.filter(([method]) => method === 'Page.printToPDF').length, options.resumePages ? 1 : 2);
      assert.equal(state.tabs.size, 0);
      assert.equal(state.attached.size, 0);
    } finally {
      delete global.chrome;
    }
  }
});

test('the packaged PDF validator reads compressed PDF page trees', async () => {
  // Service-worker globals, without Node's require/module or a DOM: exercise the browser UMD path.
  const context = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/pdf-lib/pdf-lib.min.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'chrome-pdf.js'), 'utf8'), context);
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) pdf.addPage();
  context.base64 = await pdf.saveAsBase64({ useObjectStreams: true });
  await assert.rejects(vm.runInContext('__qtsChromePdf.validatePdf(base64, "resume")', context), { name: 'DocumentPageLimitError' });
});
