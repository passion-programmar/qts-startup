// Worker-driven page alerts (injected on demand). They render in the page's
// shared toast stack (content/page-toast.js) so every QTS notice looks and
// stacks the same way: newest on top.

(function () {
  'use strict';

  if (typeof window.__showQtsDetectToast === 'function') return;

  const shownOnPages = new Set();

  function normalizeToastType(typeOrSuccess) {
    if (typeof typeOrSuccess === 'boolean') return typeOrSuccess ? 'success' : 'error';
    return String(typeOrSuccess || 'info').toLowerCase();
  }

  window.__showQtsDetectToast = function showQtsToast(message, typeOrSuccess = 'info', durationMs, oncePerPage) {
    if (oncePerPage) {
      const pageKey = String(location.href || '').split('#')[0];
      if (shownOnPages.has(pageKey)) return;
      shownOnPages.add(pageKey);
    }
    globalThis.__qtsPageToast?.show(message, {
      type: normalizeToastType(typeOrSuccess),
      durationMs: Number(durationMs) > 0 ? Number(durationMs) : undefined,
    });
  };
})();
