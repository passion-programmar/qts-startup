// On the QTS site only: passes the Bids page's "open résumé folder" requests to the extension and
// answers back, so a click there opens Windows Explorer at the folder, and prints the Resume page's
// PDFs in this Chrome instead of on QTS's server. It listens only after the
// service worker confirms this page is the QTS site, so other pages never see it.
(function initQtsSiteBridge() {
  if (window.top !== window || window.__qtsSiteBridge) return;
  window.__qtsSiteBridge = true;
  if (window.location.protocol !== 'https:' && window.location.protocol !== 'http:') return;

  // The QTS server's origin, read the way shared/runtime-config.js reads it: the saved address when
  // it is HTTPS (or HTTP on this machine), else Production. Only a page on that origin asks the
  // service worker, so every other page stops here without waking it.
  const DEFAULT_SERVER_URL = 'https://qts-job-system.vercel.app';
  function serverOrigin(saved) {
    try {
      const url = new URL(String(saved || '').trim());
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.origin;
    } catch {
      // Not an address: Production, as runtime-config does.
    }
    return new URL(DEFAULT_SERVER_URL).origin;
  }

  chrome.storage.local.get('qtsServerUrl').then((stored) => {
    if (window.location.origin !== serverOrigin(stored.qtsServerUrl)) return null;
    return chrome.runtime.sendMessage({ type: 'QTS_IS_QTS_SITE' });
  }).then((answer) => {
    if (answer?.qtsSite !== true) return;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== 'qts-app' || typeof data.requestId !== 'string') return;
      const reply = (result) => window.postMessage({ source: 'qts-extension', requestId: data.requestId, ...result }, window.location.origin);
      // `print` tells the Resume page this extension can print its PDFs (older ones never answer that).
      if (data.type === 'ping') {
        reply({ ok: true, print: true });
        return;
      }
      if (data.type === 'print-documents') {
        chrome.runtime.sendMessage({ type: 'QTS_PRINT_DOCUMENTS', job: data.job })
          .then((result) => reply(result || { ok: false }))
          .catch(() => reply({ ok: false }));
        return;
      }
      if (data.type === 'delete-resume-files') {
        chrome.runtime.sendMessage({ type: 'QTS_DELETE_RESUME_FILES', files: Array.isArray(data.files) ? data.files : [] })
          .then((result) => reply(result || { ok: false, error: 'No answer from the extension.' }))
          .catch(() => reply({ ok: false, error: 'The extension could not be reached. Reload this page.' }));
        return;
      }
      if (data.type !== 'open-resume-folder') return;
      chrome.runtime.sendMessage({ type: 'QTS_OPEN_RESUME_FOLDER', folder: String(data.folder || '') })
        .then((result) => reply(result || { ok: false, error: 'No answer from the extension.' }))
        .catch(() => reply({ ok: false, error: 'The extension could not be reached. Reload this page.' }));
    });
  }).catch(() => {});
})();
