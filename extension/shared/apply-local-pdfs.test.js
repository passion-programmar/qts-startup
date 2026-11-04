const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

require('./apply-pdf.js');
const localPdfs = require('./apply-local-pdfs.js');

const pdf = Buffer.from('%PDF-1.7\nlocal PDF contents');
const resumePath = 'QTS_Resume/Manager/Candidate/2026-11-03_12-00-00_Engineer_Acme/Candidate (1).pdf';
const coverLetterPath = 'QTS_Resume/Manager/Candidate/2026-11-03_12-00-00_Engineer_Acme/Candidate_Cover_Letter (2).pdf';
const metadata = {
  resumePath,
  coverLetterPath,
};

function directoryTree(files, permission = 'granted', rootName = 'Downloads') {
  const reads = [];
  function makeHandle(currentPath) {
    return {
      name: rootName,
      path: currentPath,
      queryPermission: async ({ mode }) => (mode === 'read' ? permission : 'denied'),
      getDirectoryHandle: async (name) => {
        reads.push(`dir:${name}`);
        const childPath = `${currentPath}/${name}`;
        const child = files.get(childPath);
        if (!child || !child.directory) throw Object.assign(new Error('Not found'), { name: 'NotFoundError' });
        return makeHandle(childPath);
      },
      getFileHandle: async (name) => {
        reads.push(`file:${currentPath}/${name}`);
        const file = files.get(`${currentPath}/${name}`);
        if (!file || file.directory) throw Object.assign(new Error('Not found'), { name: 'NotFoundError' });
        return {
          getFile: async () => ({
            size: file.bytes.length,
            arrayBuffer: async () => file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength),
          }),
        };
      },
    };
  }
  return { root: makeHandle(''), reads };
}

function applyFiles(resume = pdf, coverLetter = pdf) {
  const files = new Map();
  const folder = `/${resumePath.split('/').slice(0, -1).join('/')}`;
  let parent = '';
  for (const segment of resumePath.split('/').slice(0, -1)) {
    parent += `/${segment}`;
    files.set(parent, { directory: true });
  }
  files.set(`/${resumePath}`, { bytes: resume });
  files.set(`/${coverLetterPath}`, { bytes: coverLetter });
  return files;
}

test('reads exact, uniquified résumé and cover-letter PDFs from a nested authorized folder', async () => {
  const { root, reads } = directoryTree(applyFiles());
  const result = await localPdfs.readApplyDocuments(root, metadata);
  assert.equal(result.resume.filename, 'Candidate (1).pdf');
  assert.equal(result.coverLetter.filename, 'Candidate_Cover_Letter (2).pdf');
  assert.equal(Buffer.from(result.resume.base64, 'base64').toString(), pdf.toString());
  assert.equal(Buffer.from(result.coverLetter.base64, 'base64').toString(), pdf.toString());
  assert.ok(reads.includes('dir:2026-11-03_12-00-00_Engineer_Acme'));
  assert.ok(reads.includes(`file:/${resumePath}`));
  assert.ok(reads.includes(`file:/${coverLetterPath}`));
});

test('rejects unsafe paths and never approximates missing filenames', async () => {
  const { root } = directoryTree(applyFiles());
  await assert.rejects(
    localPdfs.readApplyDocuments(root, { ...metadata, resumePath: 'QTS_Resume/../other/Candidate.pdf' }),
    /path is invalid/,
  );
  await assert.rejects(
    localPdfs.readApplyDocuments(root, { ...metadata, resumePath: `${resumePath}.old` }),
    { name: 'NotFoundError' },
  );
});

test('rejects missing résumé or cover letter, empty files, and invalid PDF headers', async () => {
  const noResume = applyFiles();
  noResume.delete(`/${resumePath}`);
  await assert.rejects(localPdfs.readApplyDocuments(directoryTree(noResume).root, metadata));

  const noCoverLetter = applyFiles();
  noCoverLetter.delete(`/${coverLetterPath}`);
  await assert.rejects(localPdfs.readApplyDocuments(directoryTree(noCoverLetter).root, metadata));

  for (const invalid of [Buffer.alloc(0), Buffer.from('not a PDF')]) {
    await assert.rejects(
      localPdfs.readApplyDocuments(directoryTree(applyFiles(pdf, invalid)).root, metadata),
      /empty|invalid/,
    );
  }
});

test('does not request permission when the saved folder grant is revoked', async () => {
  const { root, reads } = directoryTree(applyFiles(), 'prompt');
  await assert.rejects(localPdfs.readApplyDocuments(root, metadata), /permission is unavailable/);
  assert.deepEqual(reads, []);
});

test('separate extension profiles can independently read the same shared Downloads directory', async () => {
  const sharedFiles = applyFiles();
  const profileA = directoryTree(sharedFiles, 'granted', 'Downloads');
  const profileB = directoryTree(sharedFiles, 'granted', 'Downloads');
  const [fromA, fromB] = await Promise.all([
    localPdfs.readApplyDocuments(profileA.root, metadata),
    localPdfs.readApplyDocuments(profileB.root, metadata),
  ]);
  assert.equal(fromA.resume.base64, fromB.resume.base64);
  assert.notEqual(profileA.root, profileB.root, 'each profile has its own separately granted handle');
});

test('repeated Apply steps reuse documents already loaded into the application state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'apply-runner.js'), 'utf8');
  const start = source.indexOf('  let documents = application.applyDocuments');
  const end = source.indexOf('  let rechecked = false;', start);
  assert.ok(start >= 0 && end > start);
  const cacheSetup = source.slice(start, end);

  const application = {};
  function makeStepScope(assist = false) {
    const context = { application, assist };
    vm.createContext(context);
    vm.runInContext(`(() => { ${cacheSetup}; globalThis.current = documents; globalThis.keep = keepDocuments; })()`, context);
    return context;
  }
  const firstStep = makeStepScope();
  const documents = { folder: metadata.folder, resume: { base64: 'resume' }, coverLetter: { base64: 'cover' } };
  firstStep.keep(documents);
  const nextStep = makeStepScope();
  assert.equal(nextStep.current, documents);
  assert.equal(application.applyDocuments, documents);
});

test('Apply reads local PDFs without Chrome or server rendering and fails when unavailable', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'apply-runner.js'), 'utf8');
  const start = source.indexOf('async function fetchApplyDocuments(');
  const end = source.indexOf('\n\n/**\n * Fills one field', start);
  assert.ok(start >= 0 && end > start);
  const fetchFunction = source.slice(start, end);

  async function runWithFolder(folder) {
    const events = [];
    let debuggerAttachments = 0;
    const context = {
      self: {
        __qtsApplyLocalPdfs: localPdfs,
        __qtsApplyPdf: globalThis.__qtsApplyPdf,
        __qtsScannerDocumentStore: { getSetting: async () => ({ value: folder }) },
        __qtsChromePdf: { printDocuments: async () => {
          events.push('chrome-print');
          return null;
        } },
      },
      chrome: { debugger: { attach: async () => { debuggerAttachments += 1; } } },
      workerApiRequest: async (_method, requestPath) => {
        events.push(requestPath);
        return { success: true, documents: metadata };
      },
      ApplyStop: class ApplyStop extends Error {},
    };
    vm.createContext(context);
    vm.runInContext(fetchFunction, context);
    try {
      return { events, result: await context.fetchApplyDocuments('attempt-1'), debuggerAttachments };
    } catch (error) {
      return { events, error, debuggerAttachments };
    }
  }

  const { root: availableFolder } = directoryTree(applyFiles());
  const reused = await runWithFolder(availableFolder);
  assert.equal(reused.events.length, 1);
  assert.equal(reused.events[0].includes('/api/extension/apply/documents?attemptId=attempt-1'), true);
  assert.equal(Buffer.from(reused.result.resume.base64, 'base64').toString(), pdf.toString());
  assert.equal(reused.events.includes('chrome-print'), false);
  assert.equal(reused.debuggerAttachments, 0);

  const { root: missingFolder } = directoryTree(new Map());
  const missing = await runWithFolder(missingFolder);
  assert.match(missing.error.message, /will not regenerate/i);
  assert.equal(missing.events.length, 1, 'failure does not request another endpoint');
  assert.equal(missing.events.includes('chrome-print'), false);
  assert.equal(missing.debuggerAttachments, 0);

  const { root: revokedFolder } = directoryTree(applyFiles(), 'prompt');
  const revoked = await runWithFolder(revokedFolder);

  assert.match(revoked.error.message, /authorization|folder/i);
  assert.equal(revoked.events.length, 1);
  assert.equal(revoked.events.includes('chrome-print'), false);
  assert.equal(revoked.debuggerAttachments, 0);

  const invalidFiles = applyFiles();
  invalidFiles.set(`/${resumePath}`, { bytes: Buffer.from('not a PDF') });
  const invalid = await runWithFolder(directoryTree(invalidFiles).root);
  assert.match(invalid.error.message, /will not regenerate/i);
  assert.equal(invalid.events.length, 1);
  assert.equal(invalid.events.includes('chrome-print'), false);
  assert.equal(invalid.debuggerAttachments, 0);
});
