// justjoin.it platform adapter — resolves apply templates and delegates capture hooks.

(function initJustjoinApply() {
  if (window.__qtsPlatformJustjoin) return;
  const HOST = /justjoin\.it/i;
  const APPLY_LINK = /\b(apply|aplikuj)\b/i;
  const EXTERNAL_HINT = /greenhouse|lever\.co|workable|smartrecruiters|ashbyhq|bamboohr|recruitee|teamtailor/i;

  let activeTemplate = null;
  let resolvingTemplate = false;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getClickableLabel(el) {
    return cleanText([
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.textContent,
    ].filter(Boolean).join(' '));
  }

  function isJustjoinHost(url) {
    try {
      return HOST.test(new URL(url || window.location.href).hostname);
    } catch {
      return HOST.test(String(url || ''));
    }
  }

  function isExcludedExternalLinkZone(el) {
    return Boolean(el.closest(
      'footer, nav, header, [class*="similar" i], [class*="recommended" i], [class*="related" i], [data-testid*="similar" i], [class*="check-similar" i]'
    ));
  }

  function detectExternalApplyLink() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    for (const link of links) {
      if (isExcludedExternalLinkZone(link)) continue;
      const label = getClickableLabel(link);
      if (!APPLY_LINK.test(label)) continue;
      const href = link.href;
      if (!href || href.startsWith('javascript:')) continue;
      try {
        const host = new URL(href).hostname;
        if (!HOST.test(host)) {
          return {
            external: true,
            url: href,
            label,
            providerHint: EXTERNAL_HINT.test(href) ? 'ats' : 'external',
          };
        }
      } catch {
        // skip invalid URLs
      }
    }
    return null;
  }

  function resolveTemplate(context = {}) {
    if (context.forcedTemplate?.id) {
      activeTemplate = context.forcedTemplate;
      return activeTemplate;
    }
    if (resolvingTemplate) return activeTemplate;

    const registry = window.__qtsTemplateRegistry;
    if (!registry?.resolveTemplate) return null;
    const external = context.external || detectExternalApplyLink();

    resolvingTemplate = true;
    window.__qtsResolvingApplyTemplate = true;
    try {
      const template = registry.resolveTemplate('justjoin', {
        ...context,
        url: context.url || window.location.href,
        external,
      });
      activeTemplate = template;
      return template;
    } finally {
      resolvingTemplate = false;
      window.__qtsResolvingApplyTemplate = false;
    }
  }

  function getActiveTemplate() {
    return activeTemplate;
  }

  function delegateHook(name, ...args) {
    const template = activeTemplate;
    const hook = template?.hooks?.[name];
    if (typeof hook === 'function') return hook(...args);
    return undefined;
  }

  function scoreApplyButton(el, baseScore) {
    const result = delegateHook('scoreApplyButton', el, baseScore);
    return result != null ? result : baseScore;
  }

  function getApplicationScanRoots() {
    return delegateHook('getApplicationScanRoots');
  }

  function getModalRoots() {
    const result = delegateHook('getModalRoots');
    if (result) return result;
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog'));
  }

  function detectDynamicTriggers() {
    return delegateHook('detectDynamicTriggers') || [];
  }

  function revealDynamicFields() {
    return delegateHook('revealDynamicFields') || [];
  }

  function detectFlowType(scan, context) {
    const result = delegateHook('detectFlowType', scan, context);
    if (result) return result;
    if (context?.externalUrl) return 'external_redirect';
    if (scan?.fields?.length) return 'modal';
    return 'unknown';
  }

  function buildWarnings(scan, context) {
    const template = activeTemplate;
    const warnings = delegateHook('buildWarnings', scan, context) || [];
    if (template?.id === 'justjoin_external_apply') return warnings;
    const crossOriginIframes = Array.from(document.querySelectorAll('iframe')).filter((frame) => {
      try {
        const src = frame.src || '';
        if (!src) return false;
        return new URL(src).origin !== window.location.origin;
      } catch {
        return true;
      }
    });
    if (crossOriginIframes.length) {
      warnings.push('Cross-origin iframe detected — embedded ATS forms may require manual scanning on the external frame.');
    }
    return warnings;
  }

  window.__qtsPlatformJustjoin = {
    id: 'justjoin',
    hostPattern: HOST,
    isJustjoinHost,
    resolveTemplate,
    getActiveTemplate,
    detectExternalApplyLink,
    scoreApplyButton,
    getModalRoots,
    getApplicationScanRoots,
    detectDynamicTriggers,
    revealDynamicFields,
    detectFlowType,
    buildWarnings,
  };
})();
