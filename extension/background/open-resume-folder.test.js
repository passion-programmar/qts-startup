// 📂 Résumé on the Jobs / Bids pages opens the folder in Explorer from any Chrome on this PC, also
// one another Chrome saved (2026-11-21). Fake folder and fake Chrome downloads; nothing real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shared = (file) => fs.readFileSync(path.join(__dirname, '..', 'shared', file), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').replace(/\r\n/g, '\n');
const flow = worker.slice(worker.indexOf('async function openDownloadedFolder('), worker.indexOf('/**\n * Custom jobs are made in this Chrome only'));
const FOLDER = 'QTS_Resume/MSK/Radu Star/Acme - Data Engineer';

function fakeFolder(tree, permission = 'granted') {
  const directory = (entries, name) => ({
    kind: 'directory', name,
    queryPermission: async () => permission,
    getDirectoryHandle: async (segment) => {
      if (!entries[segment] || typeof entries[segment] !== 'object') throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return directory(entries[segment], segment);
    },
    async *entries() {
      for (const [entryName, value] of Object.entries(entries)) {
        yield [entryName, typeof value === 'object'
          ? directory(value, entryName)
          : { kind: 'file', name: entryName, getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(value).buffer }) }];
      }
    },
  });
  return directory(tree, 'QTS_Resume');
}

function chromeWith({ history = [], folder }) {
  const shown = [];
  const downloads = [];
  const listeners = new Set();
  const context = vm.createContext({
    console, setTimeout, clearTimeout, TextEncoder, Uint8Array, btoa,
    chrome: { downloads: {
      search: async (query) => (query.id != null ? [{ id: query.id, state: 'complete' }]
        : history.filter((item) => new RegExp(query.filenameRegex).test(item.filename))),
      show: (id) => shown.push(id),
      download: async (options) => { downloads.push(options); return 77; },
      onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    } },
    self: {
      __qtsScannerDocumentStore: { getSetting: async () => (folder ? { value: folder } : null) },
    },
  });
  vm.runInContext(`${shared('apply-pdf.js')}\n${shared('apply-local-pdfs.js')}`, context);
  // The helpers attach themselves to self (as in the worker).
  vm.runInContext(flow, context);
  return { open: (folderPath) => context.openDownloadedFolder(folderPath), shown, downloads };
}

test('a Chrome that downloaded the résumé shows it at once', async () => {
  const chrome = chromeWith({ history: [{ id: 5, state: 'complete', filename: `C:\\Users\\a\\Downloads\\${FOLDER.replaceAll('/', '\\')}\\Radu.pdf` }] });
  assert.equal((await chrome.open(FOLDER)).ok, true);
  assert.deepEqual(chrome.shown, [5]);
  assert.deepEqual(chrome.downloads, [], 'nothing saved again');
});

test('another Chrome saved it: the résumé is read through QTS_Resume, saved onto the same file, then shown', async () => {
  const folder = fakeFolder({ MSK: { 'Radu Star': { 'Acme - Data Engineer': { 'Radu_Cover_Letter.pdf': '%PDF-cover', 'Radu.pdf': '%PDF-resume' } } } });
  const chrome = chromeWith({ folder });
  assert.equal((await chrome.open(FOLDER)).ok, true);
  assert.equal(chrome.downloads.length, 1);
  const [saved] = chrome.downloads;
  assert.equal(saved.filename, `${FOLDER}/Radu.pdf`, 'the résumé, not the cover letter, on its own path');
  assert.equal(saved.conflictAction, 'overwrite', 'the same file, not a copy');
  assert.equal(Buffer.from(saved.url.split(',')[1], 'base64').toString(), '%PDF-resume', 'identical bytes');
  assert.deepEqual(chrome.shown, [77]);
});

test('a folder not on this PC, or no access to QTS_Resume, says so and saves nothing', async () => {
  const missing = chromeWith({ folder: fakeFolder({ MSK: {} }) });
  const notHere = await missing.open(FOLDER);
  assert.deepEqual([notHere.ok, notHere.notHere], [false, true]);
  assert.deepEqual(missing.downloads, []);

  const noAccess = chromeWith({ folder: fakeFolder({}, 'prompt') });
  const refused = await noAccess.open(FOLDER);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Apply PDFs folder/);
  assert.deepEqual(noAccess.downloads, []);

  const noFolder = chromeWith({ folder: null });
  assert.match((await noFolder.open(FOLDER)).error, /Choose the QTS_Resume folder/);
});
