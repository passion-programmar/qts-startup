// Prints the résumé and cover letter in this Chrome instead of on QTS's server, the way the server
// does it (the same template page from the QTS site, the same data, window size and print
// settings), so the files come out the same and Vercel spends no time printing. A hidden background
// tab is used and closed after, with Chrome's debugger attached for those seconds (Chrome shows its
// "being debugged" bar meanwhile). Any failure gives null, and the caller asks the server to print.
(function (global) {
  // What the server's page.pdf({ preferCSSPageSize: true, printBackground: true }) sends Chrome
  // (puppeteer's defaults for the rest); chrome-pdf.test.js checks it against puppeteer itself.
  const PRINT_TO_PDF = Object.freeze({
    landscape: false,
    displayHeaderFooter: false,
    printBackground: true,
    scale: 1,
    paperWidth: 8.5,
    paperHeight: 11,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    pageRanges: '',
    preferCSSPageSize: true,
    generateTaggedPDF: true,
    generateDocumentOutline: false,
  });
  // The page is laid out at the sheet's full paper width, like the server and the Resume page preview.
  const VIEWPORT = Object.freeze({ width: 1240, height: 1754, deviceScaleFactor: 1, mobile: false });
  const DOCUMENTS = ['resume', 'cover-letter'];
  const RENDER_TIMEOUT_MS = 25_000;
  const PRINT_TIMEOUT_MS = 60_000;
  // Tabs printing right now: QTS's own page scripts stay out of them.
  const printTabs = new Set();

  function templatePageUrl(serverUrl, document, template) {
    return `${String(serverUrl).replace(/\/+$/, '')}/resume-templates/${document}.html?template=${encodeURIComponent(template)}`;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForRender(send, document) {
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    // The new document's own state, not the previous page's while the next one loads.
    const expression = `location.pathname.endsWith('/${document}.html') && document.readyState === 'complete'`
      + ` ? (document.documentElement.dataset.renderState || '') : ''`;
    for (;;) {
      const { result } = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (result?.value === 'ready') return;
      if (result?.value === 'error') throw new Error(`The ${document} template did not render.`);
      if (Date.now() > deadline) throw new Error(`The ${document} template took too long.`);
      await sleep(150);
    }
  }

  async function printInTab(tabId, job, serverUrl) {
    const target = { tabId };
    await chrome.debugger.attach(target, '1.3');
    const send = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.RESUME_DATA = ${JSON.stringify(job.data)};` });
    const printed = {};
    for (const document of DOCUMENTS) {
      const navigated = await send('Page.navigate', { url: templatePageUrl(serverUrl, document, job.template) });
      if (navigated?.errorText) throw new Error(`The ${document} template did not load (${navigated.errorText}).`);
      await waitForRender(send, document);
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
      printed[document] = (await send('Page.printToPDF', PRINT_TO_PDF)).data;
    }
    return printed;
  }

  /**
   * `job` is the server's print job ({ template, data }). Gives { resume, 'cover-letter' } as
   * base64 PDFs, or null when this Chrome could not print them.
   */
  async function printDocuments(job, { serverUrl, windowId } = {}) {
    if (!job || typeof job.template !== 'string' || !job.data || !serverUrl) return null;
    let tabId = null;
    let timer = null;
    try {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false, ...(windowId != null ? { windowId } : {}) });
      tabId = tab.id;
      printTabs.add(tabId);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Printing took too long.')), PRINT_TIMEOUT_MS);
      });
      const printed = await Promise.race([printInTab(tabId, job, serverUrl), timeout]);
      return DOCUMENTS.every((document) => typeof printed[document] === 'string' && printed[document]) ? printed : null;
    } catch (error) {
      console.warn('[QTS] Printing in this Chrome failed; QTS prints instead:', error instanceof Error ? error.message : error);
      return null;
    } finally {
      clearTimeout(timer);
      if (tabId != null) {
        await chrome.debugger.detach({ tabId }).catch(() => {});
        await chrome.tabs.remove(tabId).catch(() => {});
        printTabs.delete(tabId);
      }
    }
  }

  const isPrintTab = (tabId) => printTabs.has(tabId);

  const api = { PRINT_TO_PDF, VIEWPORT, templatePageUrl, printDocuments, isPrintTab };
  global.__qtsChromePdf = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
