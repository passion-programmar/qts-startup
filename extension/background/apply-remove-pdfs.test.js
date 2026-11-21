// Remove during Apply / Auto Apply deletes the job's résumé PDFs from this PC too (2026-11-21):
// each file is checked first and skipped when it is not there. Fake folder and server; nothing real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** A fake QTS_Resume folder handle (the File System Access API shape deleteJobFiles uses). */
function fakeFolder(name, tree, permission = 'granted') {
  const directory = (entries, dirName) => ({
    name: dirName,
    queryPermission: async () => permission,
    getDirectoryHandle: async (segment) => {
      const entry = entries[segment];
      if (!entry || typeof entry !== 'object') throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return directory(entry, segment);
    },
    removeEntry: async (entryName) => {
      if (!(entryName in entries)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      const entry = entries[entryName];
      if (entry && typeof entry === 'object' && Object.keys(entry).length) throw Object.assign(new Error('not empty'), { name: 'InvalidModificationError' });
      delete entries[entryName];
    },
  });
  return directory(tree, name);
}

const localPdfs = (() => {
  const context = vm.createContext({});
  vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', 'shared', 'apply-local-pdfs.js'), 'utf8')}`, context);
  vm.runInContext('this.api = (typeof __qtsApplyLocalPdfs !== "undefined" ? __qtsApplyLocalPdfs : globalThis.__qtsApplyLocalPdfs);', context);
  return context.api || context.__qtsApplyLocalPdfs;
})();

test('the helper deletes the PDFs that are there, skips the missing ones, and keeps a folder with other files', async () => {
  const tree = { Manager: { Radu: {
    'Acme-Data': { 'Radu.pdf': 'pdf', 'Radu_Cover_Letter.pdf': 'pdf' },
    'Globex-ML': { 'Radu.pdf': 'pdf', 'notes.txt': 'kept' },
  } } };
  const folder = fakeFolder('QTS_Resume', tree);
  const result = await localPdfs.deleteJobFiles(folder, [
    'QTS_Resume/Manager/Radu/Acme-Data/Radu.pdf',
    'QTS_Resume/Manager/Radu/Acme-Data/Radu_Cover_Letter.pdf',
    'QTS_Resume/Manager/Radu/Globex-ML/Radu.pdf',
    'QTS_Resume/Manager/Radu/Globex-ML/Radu_Cover_Letter.pdf', // never downloaded on this PC
  ]);
  assert.deepEqual({ ok: result.ok, deleted: result.deleted, missing: result.missing }, { ok: true, deleted: 3, missing: 1 });
  assert.equal('Acme-Data' in tree.Manager.Radu, false, 'an emptied job folder goes too');
  assert.deepEqual(tree.Manager.Radu['Globex-ML'], { 'notes.txt': 'kept' }, 'a folder with another file stays');
  const none = await localPdfs.deleteJobFiles(fakeFolder('QTS_Resume', {}), ['QTS_Resume/Manager/Radu/Gone/Radu.pdf']);
  assert.deepEqual({ ok: none.ok, deleted: none.deleted, missing: none.missing }, { ok: true, deleted: 0, missing: 1 }, 'nothing there: skipped, no error');
});

// The Remove flow in apply-runner.js, with a fake server and the real helper above.
const runner = fs.readFileSync(path.join(__dirname, 'apply-runner.js'), 'utf8').replace(/\r\n/g, '\n');
const flowStart = runner.indexOf('/**\n * A removed job\'s résumé and cover-letter PDFs');
const flowEnd = runner.indexOf('/** The buttons of a stopped application\'s panel');
assert.ok(flowStart > 0 && flowEnd > flowStart, 'Remove flow found in apply-runner.js');

function removeFlow({ release, removeJob, folder }) {
  const calls = [];
  const notices = [];
  const deleted = [];
  const context = vm.createContext({
    console,
    workerApiRequest: async (_method, url, body) => {
      calls.push([url, body]);
      return url.endsWith('/release') ? release : removeJob;
    },
    notifyApply: async (message) => notices.push(message),
    self: {
      __qtsScannerDocumentStore: { getSetting: async () => ({ value: folder }) },
      __qtsApplyLocalPdfs: {
        SETTING_KEY: 'applyPdfDownloadsDirectoryV1',
        deleteJobFiles: async (handle, files) => {
          deleted.push(...files);
          return localPdfs.deleteJobFiles(handle, files);
        },
      },
    },
  });
  vm.runInContext(runner.slice(flowStart, flowEnd), context);
  return { context, calls, notices, deleted };
}

const files = ['QTS_Resume/Manager/Radu/Acme-Data/Radu.pdf', 'QTS_Resume/Manager/Radu/Acme-Data/Radu_Cover_Letter.pdf'];

test('Remove during Apply deletes the removed job\'s PDFs that are on this PC', async () => {
  const tree = { Manager: { Radu: { 'Acme-Data': { 'Radu.pdf': 'pdf' } } } }; // the cover letter is not on this PC
  const { context, deleted, notices } = removeFlow({ release: { success: true, resumeFiles: files }, folder: fakeFolder('QTS_Resume', tree) });
  assert.equal((await context.removeAutoJob('attempt', 'job', 'Acme')).ok, true);
  assert.deepEqual(deleted, files);
  assert.equal('Acme-Data' in tree.Manager.Radu, false, 'résumé deleted, missing cover letter skipped, empty folder gone');
  assert.deepEqual(notices, []);
});

test('a job with no PDFs is removed and nothing is deleted', async () => {
  const { context, deleted, notices } = removeFlow({ release: { success: true, resumeFiles: [] }, folder: fakeFolder('QTS_Resume', {}) });
  assert.equal((await context.removeAutoJob('attempt', 'job')).ok, true);
  assert.deepEqual(deleted, []);
  assert.deepEqual(notices, []);
});

test('without write access the job stays removed and the Manager is told', async () => {
  const { context, notices } = removeFlow({ release: { success: true, resumeFiles: files }, folder: fakeFolder('QTS_Resume', {}, 'prompt') });
  assert.equal((await context.removeAutoJob('attempt', 'job', 'Acme')).ok, true);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /^Acme: the job is removed; its résumé PDFs stay on this PC/);
});

test('when the hold is gone, the remove-by-id fallback deletes the PDFs too', async () => {
  const tree = { Manager: { Radu: { 'Acme-Data': { 'Radu.pdf': 'pdf', 'Radu_Cover_Letter.pdf': 'pdf' } } } };
  const { context, calls } = removeFlow({
    release: { success: false, message: 'no longer held' },
    removeJob: { success: true, resumeFiles: files },
    folder: fakeFolder('QTS_Resume', tree),
  });
  assert.equal((await context.removeAutoJob('attempt', 'job-id', 'Acme')).ok, true);
  assert.deepEqual(calls.map(([url]) => url), ['/api/extension/apply/release', '/api/extension/apply/remove-job']);
  assert.deepEqual(tree.Manager.Radu, {}, 'both PDFs and their folder deleted');
});

test('a refused Remove deletes nothing', async () => {
  const tree = { Manager: { Radu: { 'Acme-Data': { 'Radu.pdf': 'pdf' } } } };
  const { context, deleted } = removeFlow({
    release: { success: false, message: 'no longer held' },
    removeJob: { success: false, message: 'This job has a bid' },
    folder: fakeFolder('QTS_Resume', tree),
  });
  assert.equal((await context.removeAutoJob('attempt', 'job-id')).ok, false);
  assert.deepEqual(deleted, []);
  assert.ok('Radu.pdf' in tree.Manager.Radu['Acme-Data']);
});
