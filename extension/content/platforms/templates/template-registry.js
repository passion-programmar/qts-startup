// Platform apply-template registry — match URL + DOM state to a capture/fill strategy.

(function initTemplateRegistry() {
  const templatesByPlatform = new Map();

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function registerTemplate(template) {
    if (!template?.id || !template?.platform) {
      throw new Error('Template requires id and platform.');
    }
    const list = templatesByPlatform.get(template.platform) || [];
    const existing = list.findIndex((item) => item.id === template.id);
    if (existing >= 0) list[existing] = template;
    else list.push(template);
    list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    templatesByPlatform.set(template.platform, list);
    return template;
  }

  function getTemplates(platform) {
    return templatesByPlatform.get(platform) || [];
  }

  function testUrlPattern(pattern, url) {
    if (!pattern || !url) return false;
    if (pattern instanceof RegExp) return pattern.test(url);
    if (typeof pattern === 'string') return url.includes(pattern);
    if (typeof pattern === 'function') return Boolean(pattern(url));
    return false;
  }

  function matchesUrlPatterns(template, url) {
    const patterns = template.urlPatterns || [];
    if (!patterns.length) return true;
    return patterns.some((pattern) => testUrlPattern(pattern, url));
  }

  function resolveTemplate(platform, context = {}) {
    const url = context.url || window.location.href;
    const candidates = getTemplates(platform);
    let best = null;
    let bestScore = -1;

    for (const template of candidates) {
      if (!matchesUrlPatterns(template, url)) continue;
      const score = typeof template.detect === 'function'
        ? Number(template.detect(context)) || 0
        : (template.priority || 0);
      if (score > bestScore) {
        best = template;
        bestScore = score;
      }
    }

    return best;
  }

  function resolvePlatformFromUrl(url) {
    const host = String(url || '').toLowerCase();
    if (host.includes('justjoin.it')) return 'justjoin';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    return null;
  }

  function resolveTemplateForPage(context = {}) {
    const url = context.url || (typeof window !== 'undefined' ? window.location.href : '');
    const platform = context.platform || resolvePlatformFromUrl(url);
    if (!platform) return null;
    return resolveTemplate(platform, { ...context, url, platform });
  }

  function isTemplateCandidateUrl(url) {
    const platform = resolvePlatformFromUrl(url);
    if (!platform) return false;
    if (platform === 'justjoin') return /justjoin\.it\/job-offer\//i.test(url || '');
    return false;
  }

  function fieldMatchesExpected(field, expected) {
    const label = cleanText(field?.label || field?.placeholder || '').toLowerCase();
    const fieldType = cleanText(field?.fieldType || '').toLowerCase();
    const labelOk = (expected.labelPatterns || []).some((pattern) => pattern.test(label));
    const typeOk = !expected.fieldTypes?.length || expected.fieldTypes.includes(fieldType);
    return labelOk && typeOk;
  }

  function validateExpectedFields(fields, expectedFields) {
    const warnings = [];
    const list = fields || [];
    for (const expected of expectedFields || []) {
      const found = list.some((field) => fieldMatchesExpected(field, expected));
      if (!found && expected.required) {
        warnings.push(`Expected field not found: ${expected.label || expected.id}`);
      }
    }
    return warnings;
  }

  window.__qtsTemplateRegistry = {
    registerTemplate,
    getTemplates,
    resolveTemplate,
    resolvePlatformFromUrl,
    resolveTemplateForPage,
    isTemplateCandidateUrl,
    validateExpectedFields,
    fieldMatchesExpected,
  };
})();
