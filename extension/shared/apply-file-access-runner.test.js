const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../background/apply-runner.js'), 'utf8');
const start = source.indexOf('async function fetchApplyDocuments(');
const end = source.indexOf('\n\n/**\n * Fills one field', start);
const documents = { resumePath: 'QTS_Resume/Run/Resume (1).pdf', coverLetterPath: 'QTS_Resume/Run/Cover (2).pdf' };
const config = { mode: 'file-url', rootPath: 'C:\\Downloads\\QTS_Resume' };

function fixture({ direct = config, response = { success: true, documents }, readError = null } = {}) {
  const events = [];
  const expected = { resume: { filename: 'Resume (1).pdf', base64: 'original' }, coverLetter: { filename: 'Cover (2).pdf', base64: 'original' } };
  const context = {
    ApplyStop: class ApplyStop extends Error { constructor(message, options) { super(message); this.skip = options.skip; this.keepTab = true; } },
    workerApiRequest: async (method, url, body) => { events.push(['authorization', method, url, body]); return response; },
    self: {
      __qtsScannerDocumentStore: { getSetting: async (key) => { events.push(['setting', key]); return { value: key === 'applyPdfFileAccessV1' ? direct : 'original-handle' }; } },
      __qtsApplyLocalPdfs: { SETTING_KEY: 'applyPdfDownloadsDirectoryV1', readApplyDocuments: async (handle, paths) => { events.push(['picker', handle, paths]); return expected; } },
      __qtsApplyFileAccess: { readDocuments: async (settings, paths) => { events.push(['direct', settings, paths]); if (readError) throw readError; return expected; } },
    },
  };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return { context, events, expected, read: () => context.fetchApplyDocuments('attempt') };
}

test('direct mode reads only after server authorization and does not access the saved picker handle', async () => {
  const f = fixture(); const result = await f.read();
  assert.equal(result.resume, f.expected.resume); assert.equal(result.coverLetter, f.expected.coverLetter);
  assert.deepEqual(f.events.map(([kind]) => kind), ['authorization', 'setting', 'direct']);
  assert.deepEqual(f.events[2].slice(1), [config, documents]);
  assert.equal(f.events[0][3], undefined, 'paths and bytes are never added to authorization request');
});

test('denied authorization and missing PDF metadata cause zero local settings or file reads', async () => {
  for (const response of [{ success: false, _httpStatus: 403, message: 'Denied' }, { success: true, documents: { ...documents, coverLetterPath: null } }]) {
    const f = fixture({ response }); await assert.rejects(f.read());
    assert.deepEqual(f.events.map(([kind]) => kind), ['authorization']);
  }
});

test('direct read failure remains actionable ApplyStop without fallback, rerender or implicit retry', async () => {
  const f = fixture({ readError: new Error('Enable Allow access to file URLs, then choose Retry autofill.') });
  await assert.rejects(f.read(), (error) => {
    assert.equal(error instanceof f.context.ApplyStop, true); assert.equal(error.skip, false); assert.equal(error.keepTab, true);
    assert.match(error.message, /will not regenerate.*Allow access to file URLs.*Retry autofill/); return true;
  });
  assert.deepEqual(f.events.map(([kind]) => kind), ['authorization', 'setting', 'direct']);
});

test('disabling direct mode selects the preserved picker handle without invoking the direct reader', async () => {
  const f = fixture({ direct: null }); await f.read();
  assert.deepEqual(f.events.map(([kind]) => kind), ['authorization', 'setting', 'setting', 'picker']);
  assert.equal(f.events[3][1], 'original-handle');
});
