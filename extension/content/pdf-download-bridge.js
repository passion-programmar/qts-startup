(async function initializeQtsPdfDownloadBridge() {
  if (globalThis.__qtsPdfDownloadBridge) return;
  let serverUrl;
  try {
    const config = await chrome.runtime.sendMessage({ type: 'GET_QTS_RUNTIME_CONFIG' });
    if (!config?.ok || !config.serverUrl) return;
    serverUrl = new URL(config.serverUrl);
  } catch {
    return;
  }
  const pageUrl = new URL(location.href);
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const trustedPage = pageUrl.origin === serverUrl.origin || (
    loopbackHosts.has(pageUrl.hostname)
    && loopbackHosts.has(serverUrl.hostname)
    && pageUrl.protocol === serverUrl.protocol
    && pageUrl.port === serverUrl.port
  );
  if (!trustedPage) return;
  globalThis.__qtsPdfDownloadBridge = true;

  window.addEventListener('message', async (event) => {
    if (
      event.source !== window
      || event.origin !== location.origin
      || event.data?.type !== 'QTS_DOWNLOAD_APPLICATION_FILES'
    ) return;
    const requestId = String(event.data.requestId || '');
    if (!requestId) return;
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: 'QTS_DOWNLOAD_APPLICATION_FILES',
        files: event.data.files,
      });
    } catch (error) {
      result = { ok: false, error: error?.message || 'The extension could not start the downloads.' };
    }
    window.postMessage({
      type: 'QTS_DOWNLOAD_APPLICATION_FILES_RESULT',
      requestId,
      ...result,
    }, location.origin);
  });
})();
