// Helpers for the panel's "PDFs always available" setting: open Chrome's page for this extension
// (where the Manager turns on "Allow access to file URLs"), and find the QTS_Resume folder from the
// PDFs Generation downloaded in this Chrome profile, so the path need not be typed. Nothing is saved
// here; the Manager still chooses Save (apply-pdf-file-access.js checks and stores it).
(function initializePdfPathHelpers(global) {
  const ROOT = 'QTS_Resume';

  /** C:\Users\me\Downloads\QTS_Resume from a downloaded file's full path, or null. */
  function rootOf(filename) {
    const value = String(filename || '');
    const match = value.match(/^(.*?[\\/]QTS_Resume)(?=[\\/])/i);
    return match ? match[1].replace(/\//g, '\\') : null;
  }

  async function detectRoot() {
    if (!global.chrome?.downloads?.search) return null;
    const items = await chrome.downloads.search({ filenameRegex: `[\\\\/]${ROOT}[\\\\/]`, orderBy: ['-startTime'], limit: 50 });
    // The newest download still on disk wins; one that was moved or deleted is skipped.
    for (const item of items) {
      const root = item.exists !== false ? rootOf(item.filename) : null;
      if (root) return root;
    }
    return null;
  }

  if (typeof document !== 'undefined') {
    const details = document.getElementById('open-extension-details');
    const detect = document.getElementById('detect-path');
    const input = document.getElementById('file-folder-path');
    const status = document.getElementById('file-access-status');
    details?.addEventListener('click', () => {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }).catch(() => {});
    });
    detect?.addEventListener('click', async () => {
      detect.disabled = true;
      try {
        const root = await detectRoot();
        if (!root) {
          status.textContent = 'No QTS PDFs downloaded in this Chrome were found. Type the full path to QTS_Resume, then Save.';
          status.dataset.state = 'unconfigured';
          return;
        }
        input.value = root;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        status.textContent = `Found ${root}. Choose Save to use it.`;
        status.dataset.state = 'unconfigured';
      } catch (error) {
        status.textContent = error?.message || 'Could not look up QTS downloads. Type the path instead.';
        status.dataset.state = 'error';
      } finally {
        detect.disabled = false;
      }
    });
  }

  const api = Object.freeze({ rootOf, detectRoot });
  global.__qtsApplyPdfPathDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
