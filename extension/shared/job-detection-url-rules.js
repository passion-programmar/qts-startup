(function initJobDetectionUrlRules(global) {
  if (global.__qtsJobDetectionUrlRules) return;

  function normalizeJobDetectionUrlRule(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048) return null;
    let parsed;
    try {
      parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !parsed.hostname
    ) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${hostname}${pathname === '/' ? '' : pathname}`;
  }

  function jobDetectionUrlRuleMatches(url, value) {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      return false;
    }
    const rule = normalizeJobDetectionUrlRule(value);
    if (!rule) return false;
    const slash = rule.indexOf('/');
    const ruleHost = (slash < 0 ? rule : rule.slice(0, slash)).toLowerCase();
    const rulePath = slash < 0 ? '' : rule.slice(slash).replace(/\/+$/, '');
    const pageHost = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (pageHost !== ruleHost && !pageHost.endsWith(`.${ruleHost}`)) return false;
    if (!rulePath) return true;
    const pagePath = parsed.pathname.replace(/\/+$/, '') || '/';
    return pagePath === rulePath || pagePath.startsWith(`${rulePath}/`);
  }

  global.__qtsJobDetectionUrlRules = Object.freeze({
    normalizeJobDetectionUrlRule,
    jobDetectionUrlRuleMatches,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsJobDetectionUrlRules;
  }
})(typeof self !== 'undefined' ? self : globalThis);
