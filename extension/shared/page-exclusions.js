(function initPageDetectionKeywords(global) {
  if (global.__qtsPageExclusions) return;

  const MIN_JOB_PAGE_KEYWORD_MATCHES = 2;

  function normalizePageDetectionKeyword(value) {
    const raw = String(value || '');
    if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
    const normalized = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized.length < 2 || normalized.length > 200) {
      return null;
    }
    return normalized;
  }

  function countPageDetectionKeywordMatches(pageText, rules) {
    const normalizedText = String(pageText || '').replace(/\s+/g, ' ').toLowerCase();
    const uniqueKeywords = new Set(
      (Array.isArray(rules) ? rules : [])
        .map((rule) => normalizePageDetectionKeyword(rule?.keyword ?? rule?.url ?? rule))
        .filter(Boolean),
    );
    let matches = 0;
    for (const keyword of uniqueKeywords) {
      if (normalizedText.includes(keyword)) matches += 1;
    }
    return matches;
  }

  function pageHasJobDetectionSignals(pageText, rules) {
    return countPageDetectionKeywordMatches(pageText, rules) >= MIN_JOB_PAGE_KEYWORD_MATCHES;
  }

  global.__qtsPageExclusions = Object.freeze({
    MIN_JOB_PAGE_KEYWORD_MATCHES,
    normalizePageDetectionKeyword,
    countPageDetectionKeywordMatches,
    pageHasJobDetectionSignals,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsPageExclusions;
  }
})(typeof self !== 'undefined' ? self : globalThis);
