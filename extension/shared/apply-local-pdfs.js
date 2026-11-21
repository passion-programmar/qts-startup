(function initApplyLocalPdfs(global) {
  const SETTING_KEY = 'applyPdfDownloadsDirectoryV1';
  const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

  function safePathSegments(path) {
    if (typeof path !== 'string' || !path.startsWith('QTS_Resume/')) {
      throw new Error('The Apply PDF file path is invalid.');
    }
    const segments = path.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
      throw new Error('The Apply PDF file path is invalid.');
    }
    return segments;
  }

  async function readPdf(directoryHandle, path) {
    const segments = relativePathSegments(directoryHandle, path);
    const filename = segments.pop();
    if (/[\\/\u0000-\u001f]/.test(filename)) throw new Error('The Apply PDF filename is invalid.');
    let targetDirectory = directoryHandle;
    for (const segment of segments) targetDirectory = await targetDirectory.getDirectoryHandle(segment);
    const fileHandle = await targetDirectory.getFileHandle(filename);
    const file = await fileHandle.getFile();
    if (!file || file.size <= 0) throw new Error(`The local Apply PDF "${filename}" is empty.`);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0 || !PDF_HEADER.every((byte, index) => bytes[index] === byte)) {
      throw new Error(`The local Apply PDF "${filename}" is invalid.`);
    }
    if (!global.__qtsApplyPdf?.toBase64) throw new Error('The Apply PDF encoder is unavailable.');
    return {
      filename,
      mimeType: 'application/pdf',
      base64: global.__qtsApplyPdf.toBase64(bytes),
    };
  }

  function relativePathSegments(directoryHandle, path) {
    const segments = safePathSegments(path);
    // Metadata remains Downloads-relative. A direct grant to QTS_Resume already covers that segment.
    return directoryHandle?.name === 'QTS_Resume' ? segments.slice(1) : segments;
  }

  async function readApplyDocuments(directoryHandle, documents) {
    if (!directoryHandle || typeof directoryHandle.queryPermission !== 'function') {
      throw new Error('The local Apply PDF folder is unavailable.');
    }
    if (await directoryHandle.queryPermission({ mode: 'read' }) !== 'granted') {
      throw new Error('The local Apply PDF folder permission is unavailable.');
    }
    if (typeof documents?.resumePath !== 'string' || typeof documents?.coverLetterPath !== 'string') {
      throw new Error('The saved Generation PDF paths are unavailable. Run Generation again before Apply.');
    }
    const [resume, coverLetter] = await Promise.all([
      readPdf(directoryHandle, documents.resumePath),
      readPdf(directoryHandle, documents.coverLetterPath),
    ]);
    return {
      resume: { ...resume, filename: resume.filename },
      coverLetter: { ...coverLetter, filename: coverLetter.filename },
    };
  }

  // A removed job's résumé and cover letter (Downloads-relative "QTS_Resume/…/x.pdf" paths) are
  // deleted through the saved folder, not Chrome's download list, so any Chrome on this PC with
  // read + write access to QTS_Resume can do it. Only .pdf files are touched; then their job folder
  // (QTS_Resume/<manager>/<candidate>/<job>/) goes too, but only when nothing else is left in it.
  async function deleteJobFiles(directoryHandle, paths) {
    if (!directoryHandle || typeof directoryHandle.queryPermission !== 'function') {
      return { ok: false, needsAccess: true, error: 'Choose the QTS_Resume folder in Apply PDFs folder first.' };
    }
    if (await directoryHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      return { ok: false, needsAccess: true, error: 'Allow read and write access to QTS_Resume in Apply PDFs folder.' };
    }
    let deleted = 0;
    let missing = 0;
    const folders = new Map();
    for (const path of [...new Set(paths)]) {
      let segments;
      try {
        segments = relativePathSegments(directoryHandle, path);
      } catch {
        continue;
      }
      const filename = segments.pop();
      if (!/\.pdf$/i.test(filename) || /[\\/\u0000-\u001f]/.test(filename)) continue;
      let parent = directoryHandle;
      try {
        for (const segment of segments) parent = await parent.getDirectoryHandle(segment);
        await parent.removeEntry(filename);
        deleted += 1;
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          missing += 1;
          continue;
        }
        throw error;
      }
      // The full Downloads path has five parts: QTS_Resume, manager, candidate, job folder, file.
      if (safePathSegments(path).length === 5 && segments.length) folders.set(segments.join('/'), segments);
    }
    for (const segments of folders.values()) {
      const folderName = segments[segments.length - 1];
      let parent = directoryHandle;
      try {
        for (const segment of segments.slice(0, -1)) parent = await parent.getDirectoryHandle(segment);
        // Not recursive: a folder still holding anything (a file the Manager added) is kept.
        await parent.removeEntry(folderName);
      } catch {
        // Not empty, or already gone.
      }
    }
    return { ok: true, deleted, missing };
  }

  // A job folder's résumé (else its first PDF), read through the saved folder: any Chrome on this PC
  // with read access to QTS_Resume finds it, whichever Chrome downloaded it. folderPath is
  // Downloads-relative ("QTS_Resume/<manager>/<candidate>/<job>"). { name, bytes } or { error }.
  async function readFolderPdf(directoryHandle, folderPath) {
    if (!directoryHandle || typeof directoryHandle.queryPermission !== 'function') {
      return { needsAccess: true, error: 'Choose the QTS_Resume folder in Apply PDFs folder first.' };
    }
    if (await directoryHandle.queryPermission({ mode: 'read' }) !== 'granted') {
      return { needsAccess: true, error: 'Allow access to QTS_Resume in Apply PDFs folder.' };
    }
    let segments;
    try {
      segments = relativePathSegments(directoryHandle, `${String(folderPath || '').replace(/\\/g, '/').replace(/\/+$/, '')}/x.pdf`);
    } catch {
      return { error: 'The résumé folder path is invalid.' };
    }
    segments.pop();
    let folder = directoryHandle;
    try {
      for (const segment of segments) folder = await folder.getDirectoryHandle(segment);
    } catch {
      return { missing: true, error: 'This résumé folder is not on this PC.' };
    }
    const pdfs = [];
    for await (const [name, handle] of folder.entries()) {
      if (handle.kind === 'file' && /\.pdf$/i.test(name) && !/[\\/\u0000-\u001f]/.test(name)) pdfs.push([name, handle]);
    }
    pdfs.sort(([left], [right]) => Number(/_Cover_Letter\.pdf$/i.test(left)) - Number(/_Cover_Letter\.pdf$/i.test(right)) || left.localeCompare(right));
    if (!pdfs.length) return { missing: true, error: 'No résumé PDF is in this folder on this PC.' };
    const [name, handle] = pdfs[0];
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (!bytes.length) return { missing: true, error: `The résumé "${name}" is empty.` };
    return { name, bytes };
  }

  global.__qtsApplyLocalPdfs = Object.freeze({
    SETTING_KEY,
    safePathSegments,
    relativePathSegments,
    readApplyDocuments,
    deleteJobFiles,
    readFolderPdf,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsApplyLocalPdfs;
})(typeof self !== 'undefined' ? self : globalThis);
