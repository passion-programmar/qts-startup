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

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeApostrophes(value) {
    return value.replace(/[‘’ʼ]/g, "'");
  }

  // Keywords match as whole words or phrases with an optional plural ending, so "job"
  // matches "jobs" but not "jobless", and "intern" no longer matches "international".
  function keywordPattern(keyword) {
    const body = normalizeApostrophes(keyword).split(' ').map(escapeRegExp).join('\\s+');
    const plural = /\p{L}$/u.test(keyword) ? '(?:s|es)?' : '';
    return new RegExp(`(?<![\\p{L}\\p{N}])${body}${plural}(?![\\p{L}\\p{N}])`, 'iu');
  }

  function countPageDetectionKeywordMatches(pageText, rules) {
    const text = normalizeApostrophes(String(pageText || ''));
    const uniqueKeywords = new Set(
      (Array.isArray(rules) ? rules : [])
        .map((rule) => normalizePageDetectionKeyword(rule?.keyword ?? rule?.url ?? rule))
        .filter(Boolean),
    );
    let matches = 0;
    for (const keyword of uniqueKeywords) {
      if (keywordPattern(keyword).test(text)) matches += 1;
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
