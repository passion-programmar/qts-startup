// Re-detect when a split-view job panel changes (sidebar list + detail pane)

(function () {
  'use strict';

  if (window.__qtsJobWatchActive) return;
  window.__qtsJobWatchActive = true;

  const PANEL_SELECTORS = [
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="job-details"]',
    '[class*="JobDetails"]',
    '[class*="job-detail"]',
    '[id*="job-description"]',
    '[data-testid*="job-description"]',
    '[data-testid*="job-title"]',
    '#jobDescriptionText',
    '.jobs-description-content__text',
    '.jobs-description__content',
  ];

  const TITLE_SELECTORS = [
    'h1[data-testid*="job-title"]',
    '[data-testid*="job-title"]',
    '[class*="job-title"]',
    '[class*="jobTitle"]',
    '.jobs-unified-top-card__job-title',
    'h1',
  ];

  let debounceTimer = null;
  let lastFingerprint = '';
  let observer = null;
  let stopped = false;

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
    clearTimeout(debounceTimer);
    try {
      observer?.disconnect();
    } catch {
      // ignore
    }
    observer = null;
  }

  function getTitleText() {
    for (const sel of TITLE_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim() || '';
        if (text.length >= 3) return text.slice(0, 160);
      } catch {
        // skip bad selector
      }
    }
    return '';
  }

  function getPanelText() {
    for (const sel of PANEL_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        const text = el?.innerText?.trim() || '';
        if (text.length >= 40) return text.slice(0, 400);
      } catch {
        // skip bad selector
      }
    }
    return '';
  }

  function getJobFingerprint() {
    const title = getTitleText();
    const panel = getPanelText();
    return `${location.href}::${title}::${panel}`;
  }

  function notifyPanelChanged() {
    if (stopped) return;
    const fingerprint = getJobFingerprint();
    if (!fingerprint || fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    safeRuntimeMessage({
      type: 'JOB_PANEL_CHANGED',
      url: location.href,
      fingerprint,
    });
  }

  function scheduleNotify() {
    if (stopped) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(notifyPanelChanged, 900);
  }

  function resetAndNotify() {
    lastFingerprint = '';
    scheduleNotify();
  }

  const root = document.body || document.documentElement;
  if (!root) return;

  observer = new MutationObserver(scheduleNotify);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener('click', (event) => {
    const target = event.target?.closest?.(
      'a, button, [role="button"], [role="listitem"], [role="option"], li, [class*="job-card"], [class*="jobCard"], [class*="job-list"], [data-job-id]'
    );
    if (target) resetAndNotify();
  }, true);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter') {
      resetAndNotify();
    }
  }, true);

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    origPush(...args);
    resetAndNotify();
  };
  history.replaceState = function (...args) {
    origReplace(...args);
    resetAndNotify();
  };

  window.addEventListener('popstate', resetAndNotify);

  scheduleNotify();
})();
