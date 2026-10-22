(function initPageExclusions(global) {
  if (global.__qtsPageExclusions) return;

  const excludedUrlParts = Object.freeze([
    'qts-job',
    'linkedin.com',
    'justjoin.it/job-offers',
    'docs.google.com',
    'chatgpt.com',
  ]);

  function normalizePageExclusion(value) {
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

  function pageMatchesExclusion(url, exclusion) {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      return false;
    }
    const rule = normalizePageExclusion(exclusion);
    if (!rule) return false;
    const slash = rule.indexOf('/');
    const ruleHost = (slash < 0 ? rule : rule.slice(0, slash)).toLowerCase();
    const rulePath = slash < 0 ? '' : rule.slice(slash);
    const pageHost = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (pageHost !== ruleHost && !pageHost.endsWith(`.${ruleHost}`)) return false;
    if (!rulePath) return true;
    const pagePath = parsed.pathname.replace(/\/+$/, '') || '/';
    return pagePath === rulePath || pagePath.startsWith(`${rulePath}/`);
  }

  function shouldSkipPage(url, managerExclusions = []) {
    const normalized = String(url || '').toLowerCase();
    return excludedUrlParts.some((part) => normalized.includes(part))
      || managerExclusions.some((exclusion) => pageMatchesExclusion(url, exclusion));
  }

  global.__qtsPageExclusions = Object.freeze({
    excludedUrlParts,
    normalizePageExclusion,
    pageMatchesExclusion,
    shouldSkipPage,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsPageExclusions;
  }
})(typeof self !== 'undefined' ? self : globalThis);
