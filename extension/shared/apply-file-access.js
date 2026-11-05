(function initApplyFileAccess(global) {
  const SETTING_KEY = 'applyPdfFileAccessV1';
  const invalidName = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
  const reservedName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

  function checkSegment(segment) {
    if (!segment || segment === '.' || segment === '..' || invalidName.test(segment)
      || /[. ]$/.test(segment) || reservedName.test(segment)) {
      throw new Error('The local PDF path is invalid. Use an exact path inside QTS_Resume without traversal or special Windows names.');
    }
    return segment;
  }

  function configuration(input) {
    if (typeof input !== 'string' || input.length > 1000) throw new Error('Enter the full local Windows path to QTS_Resume.');
    const path = input.replace(/\\/g, '/').replace(/\/$/, '');
    if (!/^[a-z]:\//i.test(path)) throw new Error('Enter a local Windows path such as C:\\Users\\YourName\\Downloads\\QTS_Resume. Network paths and URLs are not supported.');
    const segments = path.slice(3).split('/').map(checkSegment);
    if (segments.at(-1) !== 'QTS_Resume') throw new Error('The folder path must end with QTS_Resume itself, not Downloads or a job subfolder.');
    return { mode: 'file-url', rootPath: `${path.slice(0, 2)}\\${segments.join('\\')}` };
  }

  function pdfLocation(config, relativePath) {
    const { rootPath } = configuration(config?.rootPath);
    if (config?.mode !== 'file-url' || typeof relativePath !== 'string' || relativePath.length > 1000) throw new Error('The saved local PDF path is invalid.');
    const segments = relativePath.split('/').map(checkSegment);
    if (segments.length < 3 || segments.shift() !== 'QTS_Resume' || !/\.pdf$/i.test(segments.at(-1))) throw new Error('The saved local PDF path must identify an exact PDF inside QTS_Resume.');
    const root = rootPath.slice(3).split('\\');
    return { filename: segments.at(-1), url: `file:///${rootPath.slice(0, 2)}/${[...root, ...segments].map(encodeURIComponent).join('/')}` };
  }

  async function permissionGranted() {
    return typeof global.chrome?.extension?.isAllowedFileSchemeAccess === 'function'
      && await global.chrome.extension.isAllowedFileSchemeAccess();
  }

  async function readDocuments(config, documents) {
    // Validate the complete pair before any filesystem read, including when only one path is unsafe.
    const locations = [documents?.resumePath, documents?.coverLetterPath].map((path) => pdfLocation(config, path));
    if (!await permissionGranted()) throw new Error('Local PDF access is disabled. Open chrome://extensions, choose QTS Details, and enable Allow access to file URLs. Then choose Retry autofill.');
    const read = async ({ filename, url }) => {
      let response;
      try {
        response = await global.fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('File unavailable');
      } catch {
        throw new Error(`Could not read the exact local PDF "${filename}". Check the configured QTS_Resume folder, restore the original file, and confirm Allow access to file URLs is enabled.`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || ![0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, i) => bytes[i] === byte)) throw new Error(`The local Apply PDF "${filename}" is empty or invalid.`);
      return { filename, mimeType: 'application/pdf', base64: global.__qtsApplyPdf.toBase64(bytes) };
    };
    const [resume, coverLetter] = await Promise.all(locations.map(read));
    return { resume, coverLetter };
  }

  global.__qtsApplyFileAccess = Object.freeze({ SETTING_KEY, configuration, pdfLocation, permissionGranted, readDocuments });
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsApplyFileAccess;
})(typeof self !== 'undefined' ? self : globalThis);
