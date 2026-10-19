// Content script — injected into all pages
// Loads extractors and exposes window.__extractJobData

(function () {
  'use strict';

  // Guard against double injection
  if (window.__jobCaptureInjected) return;
  window.__jobCaptureInjected = true;

  let stopped = false;
  let urlObserver = null;

  function safeRuntimeMessage(payload) {
    if (stopped) return;
    try {
      if (!chrome?.runtime?.id) {
        stopWatching();
        return;
      }
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch {
      stopWatching();
    }
  }

  function stopWatching() {
    if (stopped) return;
    stopped = true;
    try {
      urlObserver?.disconnect();
    } catch {
      // ignore
    }
    urlObserver = null;
  }

  // Track URL for SPA navigation (job sites only — manifest limits injection)
  const root = document.body || document.documentElement;
  if (!root) return;

  let lastUrl = location.href;
  urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      safeRuntimeMessage({ type: 'URL_CHANGED', url: location.href });
    }
  });
  urlObserver.observe(root, { childList: true, subtree: true });

  // Intercept history API
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    origPush(...args);
    safeRuntimeMessage({ type: 'URL_CHANGED', url: location.href });
  };
  history.replaceState = function (...args) {
    origReplace(...args);
    safeRuntimeMessage({ type: 'URL_CHANGED', url: location.href });
  };
})();
