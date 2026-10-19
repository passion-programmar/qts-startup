// Re-detect apply template when justjoin Easy Apply modal opens/closes.

(function initApplyModalWatch() {
  'use strict';

  if (window.__qtsApplyModalWatchActive) return;
  if (!/justjoin\.it\/job-offer\//i.test(window.location.href)) return;
  window.__qtsApplyModalWatchActive = true;

  let debounceTimer = null;
  let lastFingerprint = '';

  function getModalFingerprint() {
    const detect = window.__qtsJustjoinEasyApplyTemplate?.hooks?.detectApplyModalFingerprint?.();
    if (detect?.matched) {
      return `modal:${detect.score}`;
    }
    const open = window.__qtsJustjoinEasyApplyTemplate?.hooks?.isJustjoinEasyApplyModalOpen?.();
    if (open) return 'modal:open';
    return 'modal:closed';
  }

  function notifyIfChanged() {
    const fingerprint = getModalFingerprint();
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({
        type: 'APPLY_MODAL_CHANGED',
        url: location.href,
        modalOpen: fingerprint !== 'modal:closed',
      }).catch(() => {});
    } catch {
      // extension context invalidated
    }
  }

  function scheduleNotify() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(notifyIfChanged, 350);
  }

  const root = document.body || document.documentElement;
  if (!root) return;

  const observer = new MutationObserver(scheduleNotify);
  observer.observe(root, { childList: true, subtree: true, attributes: true });

  window.addEventListener('popstate', scheduleNotify);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, [role="button"], a')) {
      scheduleNotify();
    }
  }, true);

  scheduleNotify();
  setInterval(scheduleNotify, 2000);
})();
