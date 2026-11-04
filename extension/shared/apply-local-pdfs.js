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
    const segments = safePathSegments(path);
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

  global.__qtsApplyLocalPdfs = Object.freeze({
    SETTING_KEY,
    safePathSegments,
    readApplyDocuments,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsApplyLocalPdfs;
})(typeof self !== 'undefined' ? self : globalThis);
