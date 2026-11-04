const assert = require('node:assert/strict');
const test = require('node:test');
require('./apply-local-pdfs.js');
const api = require('./apply-pdf-relink.js');

function fixture() {
  const state = { permission: 'granted', walked: [], reads: [], creates: [], files: new Map([
    ['Name.pdf', Buffer.from('%PDF-1.7\nold')], ['Name (1).pdf', Buffer.from('%PDF-1.7\nresume\0\xff')],
    ['Letter (2).pdf', Buffer.from('%PDF-1.7\ncover')], ['notes.txt', Buffer.from('notes')],
  ]) };
  const root = { queryPermission: async () => state.permission,
    getDirectoryHandle: async (name, options) => { state.walked.push(name); if (options?.create) state.creates.push(name); return root; },
    async *values() { for (const name of state.files.keys()) yield { name, kind: 'file' }; yield { name: 'Other.pdf', kind: 'directory' }; },
    getFileHandle: async (name, options) => {
      if (options?.create) state.creates.push(name);
      state.reads.push(name);
      if (!state.files.has(name)) throw new Error('The exact original file is missing.');
      const bytes = state.files.get(name);
      return { getFile: async () => ({ size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer }) };
    },
  };
  return { root, state, context: { resumePath: 'QTS_Resume/Manager/Run/Name.pdf' } };
}

test('list only actual PDF entries in the exact recorded parent without reading, choosing, creating or searching', async () => {
  const { root, state, context } = fixture();
  assert.deepEqual(await api.list(root, context), ['Letter (2).pdf', 'Name (1).pdf', 'Name.pdf']);
  assert.deepEqual(state.walked, ['QTS_Resume', 'Manager', 'Run']);
  assert.deepEqual(state.reads, []); assert.deepEqual(state.creates, []);
});

test('explicit selections preserve names/bytes and local-only fingerprints detect later changes', async () => {
  const { root, state, context } = fixture();
  const selected = await api.read(root, context, 'Name (1).pdf', 'Letter (2).pdf');
  assert.deepEqual(selected.map((file) => file.name), ['Name (1).pdf', 'Letter (2).pdf']);
  assert.deepEqual(Buffer.from(await selected[0].file.arrayBuffer()), state.files.get('Name (1).pdf'));
  const original = selected[0].digest;
  state.files.set('Name (1).pdf', Buffer.from('%PDF-1.7\nchanged'));
  assert.notEqual((await api.read(root, context, 'Name (1).pdf', 'Letter (2).pdf'))[0].digest, original);
  assert.deepEqual(state.creates, []);
});

test('recovery lists and reads within a direct QTS_Resume grant without changing canonical paths', async () => {
  const { root, state, context } = fixture();
  root.name = 'QTS_Resume';
  await api.list(root, context);
  assert.deepEqual(state.walked, ['Manager', 'Run']);
  const selected = await api.read(root, context, 'Name (1).pdf', 'Letter (2).pdf');
  assert.equal(selected[0].name, 'Name (1).pdf');
  assert.equal(context.resumePath, 'QTS_Resume/Manager/Run/Name.pdf');
});

test('missing/revoked access, missing files and invalid PDFs never trigger alternative selection', async () => {
  const { root, state, context } = fixture();
  await assert.rejects(api.list(null, context), /Choose QTS_Resume folder again/);
  state.permission = 'prompt'; await assert.rejects(api.read(root, context, 'Name.pdf', 'Letter (2).pdf'), /Read access/);
  assert.deepEqual(state.reads, []);
  state.permission = 'granted';
  await assert.rejects(api.read(root, context, 'Missing.pdf', 'Letter (2).pdf'), /exact original file is missing/);
  assert.equal(state.reads.includes('Name.pdf'), false);
  state.files.set('Empty.pdf', Buffer.alloc(0)); state.files.set('Fake.pdf', Buffer.from('not a PDF'));
  for (const name of ['Empty.pdf', 'Fake.pdf']) await assert.rejects(api.read(root, context, name, 'Letter (2).pdf'), /empty or invalid/);
});

test('path boundaries, distinct roles and flat legacy folders are validated without filename inference', async () => {
  const { root, context } = fixture();
  assert.equal(api.parent('QTS_Resume/Old (7).pdf'), 'QTS_Resume');
  for (const value of ['../Name.pdf', 'QTS_Resume/../Name.pdf', 'C:/Name.pdf', 'QTS_Resume\\Name.pdf', 'QTS_Resume/folder./Name.pdf']) assert.throws(() => api.parent(value), /invalid/);
  for (const [resume, cover] of [['', 'Letter (2).pdf'], ['Name.pdf', 'Name.pdf'], ['../Name.pdf', 'Letter (2).pdf'], ['Other/Name.pdf', 'Letter (2).pdf']]) {
    await assert.rejects(api.read(root, context, resume, cover));
  }
});
