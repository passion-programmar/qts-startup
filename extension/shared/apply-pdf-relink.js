(function initPdfRelink(global) {
  function parent(path) {
    if (typeof path !== 'string' || path.length > 500 || !path.startsWith('QTS_Resume/')
      || /[\\\u0000-\u001f\u007f:<>"|?*]/.test(path) || !/\.pdf$/i.test(path)) throw new Error('The recorded PDF path is invalid. Contact your QTS administrator.');
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error('The recorded PDF path is invalid. Contact your QTS administrator.');
    return parts.slice(0, -1).join('/');
  }
  async function folder(root, context) {
    if (!root || await root.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('Read access is unavailable. Choose Downloads folder again, then reload the file list.');
    let directory = root;
    for (const part of parent(context.resumePath).split('/')) directory = await directory.getDirectoryHandle(part);
    return directory;
  }
  async function list(root, context) {
    const directory = await folder(root, context);
    const names = [];
    for await (const entry of directory.values()) {
      if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) names.push(entry.name);
    }
    return names.sort();
  }
  async function read(root, context, resumeName, coverName) {
    const base = parent(context.resumePath);
    if (!resumeName || !coverName || resumeName === coverName) throw new Error('Explicitly select two different original PDFs.');
    for (const name of [resumeName, coverName]) {
      if (parent(`${base}/${name}`) !== base) throw new Error('Both PDFs must be in the recorded job folder.');
    }
    const directory = await folder(root, context);
    return Promise.all([resumeName, coverName].map(async (name) => {
      const file = await (await directory.getFileHandle(name)).getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!file.size || ![0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, i) => bytes[i] === byte)) throw new Error(`The existing PDF "${name}" is empty or invalid.`);
      // Local-only fingerprint detects an edit between review and Save; not historical provenance.
      const digest = Array.from(new Uint8Array(await global.crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
      return { name, size: file.size, digest, file };
    }));
  }
  const api = Object.freeze({ parent, list, read });
  global.__qtsApplyPdfRelink = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
