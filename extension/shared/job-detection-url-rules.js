(function initJobDetectionUrlRules(global) {
  if (global.__qtsJobDetectionUrlRules) return;

  function normalizeJobDetectionUrlRule(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized.length > 2048 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
  }

  function jobDetectionUrlRuleMatches(url, value) {
    const rule = normalizeJobDetectionUrlRule(value);
    if (!rule) return false;
    return String(url || '').toLowerCase().includes(rule);
  }

  global.__qtsJobDetectionUrlRules = Object.freeze({
    normalizeJobDetectionUrlRule,
    jobDetectionUrlRuleMatches,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsJobDetectionUrlRules;
  }
})(typeof self !== 'undefined' ? self : globalThis);
