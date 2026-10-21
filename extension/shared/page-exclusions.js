(function initPageExclusions(global) {
  if (global.__qtsPageExclusions) return;

  const excludedUrlParts = Object.freeze([
    'qts-job',
    'linkedin.com',
    'justjoin.it/job-offers',
    'docs.google.com',
    'chatgpt.com',
  ]);

  function shouldSkipPage(url) {
    const normalized = String(url || '').toLowerCase();
    return excludedUrlParts.some((part) => normalized.includes(part));
  }

  global.__qtsPageExclusions = Object.freeze({ excludedUrlParts, shouldSkipPage });
})(typeof self !== 'undefined' ? self : globalThis);
