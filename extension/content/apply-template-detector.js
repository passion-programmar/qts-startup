// Detect apply template + apply method from page URL + DOM structure (runs on page load / navigation).

(function initApplyTemplateDetector() {
  const flow = () => window.__qtsApplicationFlow || {};

  function detectPlatformFromUrl(url) {
    return flow().detectPlatformFromUrl?.(url) || null;
  }

  function isTemplateCandidateUrl(url) {
    const platform = detectPlatformFromUrl(url);
    if (!platform) return false;
    if (platform === 'justjoin') return /justjoin\.it\/job-offer\//i.test(url || '');
    return false;
  }

  function detectApplyTemplateOnPage() {
    const url = window.location.href;
    const platform = detectPlatformFromUrl(url);
    const empty = {
      platform: null,
      templateId: null,
      templateName: null,
      applyMethod: flow().APPLY_METHOD_TYPES?.UNKNOWN || 'unknown',
      applyMethodLabel: flow().formatApplyMethod?.('unknown') || 'Unknown apply method',
      flowType: flow().APPLICATION_FLOW_TYPES?.UNKNOWN || 'unknown',
      flowTypeLabel: flow().formatFlowType?.('unknown') || 'Unknown flow',
      url,
      detectedAt: new Date().toISOString(),
      formOpen: false,
      signals: {},
      stepHints: { isMultiStep: false },
      templateVersion: null,
    };

    if (!platform) return empty;

    const adapterByPlatform = {
      justjoin: () => window.__qtsPlatformJustjoin,
    };
    const adapter = adapterByPlatform[platform]?.();
    const external = adapter?.detectExternalApplyLink?.() || null;
    const template = adapter?.resolveTemplate?.({
      url,
      external,
      mode: 'page_load',
    }) || window.__qtsTemplateRegistry?.resolveTemplate?.(platform, {
      url,
      external,
      mode: 'page_load',
    });

    const signals = typeof template?.hooks?.collectPageSignals === 'function'
      ? template.hooks.collectPageSignals({ url, external })
      : {};

    const scan = window.__scanApplicationForm?.() || { fields: [] };
    const modalConfirmed = Boolean(signals.applyModalConfirmed || signals.youApplyForModal);
    const formOpen = Boolean(
      modalConfirmed
      || window.__looksLikeApplicationForm?.(scan)
      || (scan?.fields?.length > 0 && signals.modalOpen)
    );

    const context = {
      url,
      external,
      externalUrl: external?.url || null,
      dynamicActions: [],
      mode: 'page_load',
    };

    const flowType = flow().resolveFlowType?.({
      template,
      adapter,
      scan,
      context,
      signals,
    }) || 'unknown';

    const stepHints = flow().detectMultiStepHints?.(scan) || { isMultiStep: false };
    const applyMethod = flow().resolveApplyMethod?.({
      template,
      flowType,
      platform,
      signals,
      scan,
    }) || 'unknown';

    return {
      platform,
      templateId: template?.id || null,
      templateVersion: template?.version || template?.schemaVersion || 'legacy-v1',
      templateName: template?.name || null,
      templateDescription: template?.description || null,
      applyMethod,
      applyMethodLabel: flow().formatApplyMethod?.(applyMethod) || applyMethod,
      applyMethodDescription: flow().APPLY_METHOD_DESCRIPTIONS?.[applyMethod] || '',
      flowType,
      flowTypeLabel: flow().formatFlowType?.(flowType) || flowType,
      guestApply: template?.guestApply === true,
      url,
      detectedAt: new Date().toISOString(),
      formOpen,
      externalUrl: external?.url || signals.externalUrl || null,
      externalProvider: signals.externalProvider || external?.providerHint || null,
      signals,
      stepHints,
      fieldCount: scan?.fields?.length || 0,
      detectionMode: modalConfirmed ? 'modal_open' : 'page_load',
    };
  }

  window.__detectApplyTemplateOnPage = detectApplyTemplateOnPage;
  window.__qtsApplyTemplateDetector = {
    detectPlatformFromUrl,
    isTemplateCandidateUrl,
    detectApplyTemplateOnPage,
  };
})();
