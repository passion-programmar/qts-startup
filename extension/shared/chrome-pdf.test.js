const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const chromePdf = require('./chrome-pdf.js');

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
function fakeChrome({ renderState = 'ready', printFails = false } = {}) {
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
          return { data: Buffer.from(`%PDF ${state.page}`).toString('base64') };
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
    assert.match(Buffer.from(printed.resume, 'base64').toString(), /\/resume-templates\/resume\.html\?template=qts-standard$/);
    assert.match(Buffer.from(printed['cover-letter'], 'base64').toString(), /\/resume-templates\/cover-letter\.html\?template=qts-standard$/);
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
  for (const options of [{ renderState: 'error' }, { printFails: true }]) {
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
