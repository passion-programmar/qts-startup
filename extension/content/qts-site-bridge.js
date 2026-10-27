// On the QTS site only: passes the Bids page's "open résumé folder" requests to the extension and
// answers back, so a click there opens Windows Explorer at the folder. It listens only after the
// service worker confirms this page is the QTS site, so other pages never see it.
(function initQtsSiteBridge() {
  if (window.top !== window || window.__qtsSiteBridge) return;
  window.__qtsSiteBridge = true;

  chrome.runtime.sendMessage({ type: 'QTS_IS_QTS_SITE' }).then((answer) => {
    if (answer?.qtsSite !== true) return;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== 'qts-app' || typeof data.requestId !== 'string') return;
      const reply = (result) => window.postMessage({ source: 'qts-extension', requestId: data.requestId, ...result }, window.location.origin);
      if (data.type === 'ping') {
        reply({ ok: true });
        return;
      }
      if (data.type !== 'open-resume-folder') return;
      chrome.runtime.sendMessage({ type: 'QTS_OPEN_RESUME_FOLDER', folder: String(data.folder || '') })
        .then((result) => reply(result || { ok: false, error: 'No answer from the extension.' }))
        .catch(() => reply({ ok: false, error: 'The extension could not be reached. Reload this page.' }));
    });
  }).catch(() => {});
})();
