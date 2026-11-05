const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./apply-file-access.js');
const config = api.configuration('C:\\Users\\A # %\\Downloads\\QTS_Resume');
const documents = { resumePath: 'QTS_Resume/Manager/Run/Résumé (1).pdf', coverLetterPath: 'QTS_Resume/Manager/Run/Cover # % (2).pdf' };

function fixture({ allowed = true, fetchError, bytes = Buffer.from('%PDF-1.7\n\x00\xff', 'latin1') } = {}) {
  const reads = [];
  const context = { AbortSignal, Uint8Array, chrome: { extension: { isAllowedFileSchemeAccess: async () => allowed } },
    __qtsApplyPdf: { toBase64: (value) => Buffer.from(value).toString('base64') },
    fetch: async (url, options) => { reads.push({ url, options }); if (fetchError) throw fetchError; return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer }; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'apply-file-access.js'), 'utf8'), context);
  return { api: context.__qtsApplyFileAccess, reads, bytes };
}

test('explicit Windows folder paths produce encoded, exact file URLs including Chrome suffixes', () => {
  assert.equal(config.rootPath, 'C:\\Users\\A # %\\Downloads\\QTS_Resume');
  assert.deepEqual(api.configuration('D:/Downloads/QTS_Resume/'), { mode: 'file-url', rootPath: 'D:\\Downloads\\QTS_Resume' });
  const location = api.pdfLocation(config, documents.resumePath);
  assert.equal(location.filename, 'Résumé (1).pdf');
  assert.equal(location.url, 'file:///C:/Users/A%20%23%20%25/Downloads/QTS_Resume/Manager/Run/R%C3%A9sum%C3%A9%20(1).pdf');
  assert.match(api.pdfLocation(config, 'QTS_Resume/Run/%2e%2e.pdf').url, /%252e%252e\.pdf$/);
});

test('rejects network/device/URL roots, traversal, alternate streams and ambiguous Windows names', () => {
  for (const root of ['C:QTS_Resume', 'C:/Downloads', 'file:///C:/QTS_Resume', '//server/share/QTS_Resume', '\\\\?\\C:\\QTS_Resume', 'C:/../QTS_Resume', 'C:/A./QTS_Resume', 'C:/CON/QTS_Resume', 'C:/A:stream/QTS_Resume', 'C://QTS_Resume', 'C:/QTS_Resume/job']) assert.throws(() => api.configuration(root), /path|folder/i, root);
  for (const saved of ['QTS_Resume/../secret.pdf', 'QTS_Resume/Run/..\\secret.pdf', 'QTS_Resume/Run/file.pdf:stream', 'QTS_Resume/Run/NUL.pdf', 'QTS_Resume/Run/a.pdf ', 'QTS_Resume//a.pdf', 'QTS_Resume/Run/a.html', 'Other/Run/a.pdf', 'QTS_Resume/Run/a\u0000.pdf']) assert.throws(() => api.pdfLocation(config, saved), /invalid|exact PDF/i, saved);
});

test('permission denial and an unsafe second path cause zero file reads', async () => {
  const f = fixture({ allowed: false });
  await assert.rejects(f.api.readDocuments(config, documents), /Allow access to file URLs.*Retry autofill/);
  assert.equal(f.reads.length, 0);
  const valid = fixture();
  await assert.rejects(valid.api.readDocuments(config, { ...documents, coverLetterPath: 'QTS_Resume/../secret.pdf' }), /invalid/);
  assert.equal(valid.reads.length, 0);
});

test('reads original binary bytes with exact names and no cache or redirect fallback', async () => {
  const f = fixture();
  const result = await f.api.readDocuments(config, documents);
  assert.deepEqual(Buffer.from(result.resume.base64, 'base64'), f.bytes);
  assert.deepEqual(Buffer.from(result.coverLetter.base64, 'base64'), f.bytes);
  assert.equal(result.coverLetter.filename, 'Cover # % (2).pdf');
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads.every(({ url, options }) => url.startsWith('file:///C:/') && options.cache === 'no-store' && options.redirect === 'error'), true);
});

test('missing files and invalid contents stop with actionable errors without guessing or rendering', async () => {
  const missing = fixture({ fetchError: new Error('File missing') });
  await assert.rejects(missing.api.readDocuments(config, documents), /exact local PDF.*Check the configured/);
  assert.equal(missing.reads.length, 2);
  for (const bytes of [Buffer.alloc(0), Buffer.from('<html>not a PDF')]) await assert.rejects(fixture({ bytes }).api.readDocuments(config, documents), /empty or invalid/);
});
