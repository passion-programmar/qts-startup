// justjoin.it — External apply redirect template (Apply leaves justjoin.it).

(function registerJustjoinExternalApplyTemplate() {
  const registry = window.__qtsTemplateRegistry;
  if (!registry?.registerTemplate) return;

  const HOST = /justjoin\.it/i;
  const APPLY_LINK = /\b(apply|aplikuj)\b/i;
  const EXTERNAL_HINT = /greenhouse|lever\.co|workable|smartrecruiters|ashbyhq|bamboohr|recruitee|teamtailor/i;

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

  function detect(context) {
    const easyModal = window.__qtsJustjoinEasyApplyTemplate?.hooks?.isJustjoinEasyApplyModalOpen?.();
    if (easyModal) return 0;

    const external = context?.external || detectExternalApplyLink();
    if (!external?.external) return 0;
    return 200;
  }

  function buildWarnings(_scan, context) {
    const url = context?.externalUrl || context?.external?.url;
    if (!url) return [];
    return [`Apply opens an external site (${url}). Open that page and run Start Application there.`];
  }

  function collectPageSignals(context = {}) {
    const external = context.external || detectExternalApplyLink();
    return {
      jobOfferUrl: /justjoin\.it\/job-offer\//i.test(context.url || window.location.href),
      externalApplyLink: Boolean(external?.external),
      externalUrl: external?.url || null,
      externalProvider: external?.providerHint || null,
    };
  }

  registry.registerTemplate({
    id: 'justjoin_external_apply',
    platform: 'justjoin',
    name: 'justjoin External Apply',
    description: 'Apply button redirects to employer ATS or career site.',
    applyMethod: 'external_redirect',
    anticipatedFlowType: 'external_redirect',
    priority: 200,
    urlPatterns: [/^https:\/\/(www\.)?justjoin\.it\/job-offer\//i],
    guestApply: true,
    detect,
    discovery: {
      openApplyForm: false,
      expandDynamicOnPreview: false,
      expandDynamicOnFill: false,
    },
    hooks: {
      detectExternalApplyLink,
      buildWarnings,
      collectPageSignals,
    },
  });
})();
