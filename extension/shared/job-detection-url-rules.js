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

  // A site from Super Admin's Get JD skip list ("youtube.com", "linkedin.com/feed") matches a page
  // on exactly that host ("www." ignored; other subdomains are separate sites, so
  // careers.example.com never matches example.com) whose path starts with the entry's path.
  function skipSiteMatches(url, site) {
    let page;
    try { page = new URL(String(url || '')); } catch { return false; }
    if (!/^https?:$/.test(page.protocol)) return false;
    const entry = String(site || '').trim().toLowerCase();
    if (!entry) return false;
    const slash = entry.indexOf('/');
    const host = (slash < 0 ? entry : entry.slice(0, slash)).replace(/^www\./, '');
    const path = slash < 0 ? '' : entry.slice(slash);
    if (!host || page.hostname.toLowerCase().replace(/^www\./, '') !== host) return false;
    return !path || page.pathname.toLowerCase().startsWith(path);
  }

  global.__qtsJobDetectionUrlRules = Object.freeze({
    normalizeJobDetectionUrlRule,
    jobDetectionUrlRuleMatches,
    skipSiteMatches,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsJobDetectionUrlRules;
  }
})(typeof self !== 'undefined' ? self : globalThis);
