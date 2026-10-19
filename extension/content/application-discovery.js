// Application form discovery — template-aware flow detection and field scan.

(function initApplicationDiscovery() {
  if (window.__discoverApplicationForm) return;
  const DISCOVERY_FILES_PLATFORM = {
    justjoin: () => window.__qtsPlatformJustjoin,
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function detectPlatform() {
    const host = window.location.hostname;
    if (/justjoin\.it/i.test(host)) return 'justjoin';
    if (/linkedin\.com/i.test(host)) return 'linkedin';
    if (/greenhouse\.io/i.test(host)) return 'greenhouse';
    if (/lever\.co/i.test(host)) return 'lever';
    if (/workable\.com/i.test(host)) return 'workable';
    return 'generic';
  }

  function getPlatformAdapter(platform) {
    const factory = DISCOVERY_FILES_PLATFORM[platform];
    return factory ? factory() : null;
  }

  function resolveApplyTemplate(platform, adapter, options = {}) {
    if (!adapter?.resolveTemplate) return null;
    const external = adapter.detectExternalApplyLink?.() || null;
    const pre = options.preDetectedTemplate;

    if (pre?.templateId) {
      const registry = window.__qtsTemplateRegistry;
      const forced = registry?.getTemplates?.(platform)?.find((item) => item.id === pre.templateId);
      if (forced) {
        return adapter.resolveTemplate({
          url: window.location.href,
          external,
          options,
          forcedTemplate: forced,
          mode: 'discovery',
        });
      }
    }

    return adapter.resolveTemplate({
      url: window.location.href,
      external,
      options,
      mode: 'discovery',
    });
  }

  function mergeFieldsByStableId(scans) {
    const map = new Map();
    for (const scan of scans) {
      for (const field of scan?.fields || []) {
        if (!field?.stableFieldId) continue;
        const existing = map.get(field.stableFieldId);
        map.set(field.stableFieldId, existing ? { ...existing, ...field } : field);
      }
    }
    return Array.from(map.values());
  }

  function scanSameOriginIframes() {
    const extraScans = [];
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const doc = iframe.contentDocument;
        if (!doc || doc === document) continue;
        const nestedScan = doc.defaultView?.__scanApplicationForm?.();
        if (nestedScan?.fields?.length) {
          extraScans.push({
            ...nestedScan,
            source: 'same_origin_iframe',
          });
        }
      } catch {
        // cross-origin — cannot access
      }
    }
    return extraScans;
  }

  function captureCurrentApplicationStep() {
    const scan = window.__scanApplicationForm
      ? window.__scanApplicationForm()
      : { fields: [] };
    const extraScans = scanSameOriginIframes();
    return {
      ...scan,
      fields: mergeFieldsByStableId([scan, ...extraScans]),
      extraScans,
    };
  }

  function detectGenericFlowType(scan, context) {
    if (context?.externalUrl) return 'external_redirect';
    const step = String(scan?.pageStep || '');
    if (/step\s+\d+\s+of\s+\d+/i.test(step)) return 'multi_step';
    if (document.querySelector('[role="dialog"] form, [aria-modal="true"] form')) return 'modal';
    if (context?.dynamicActions?.length) return 'dynamic';
    if (scan?.fields?.length) return 'inline_single';
    return 'unknown';
  }

  function findNavigationCandidates(mode = 'DISCOVERY') {
    const candidates = [];
    const actionText = /(next|continue|proceed|back|previous|submit|apply now|send application|save|verify|captcha|sign in|log in|consent|attest|dalej|kontynuuj|weiter)/i;
    document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]').forEach((el) => {
      const label = String(el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (!label || !actionText.test(label) || rect.width <= 0 || rect.height <= 0
        || style.visibility === 'hidden' || style.display === 'none') return;
      const type = String(el.getAttribute('type') || '').toLowerCase();
      const classification = window.__qtsApplicationFlow?.classifyNavigationAction?.(label, {
        mode,
        controlType: type,
      }) || {
        classification: 'UNKNOWN_OR_SIDE_EFFECT',
        reason: 'Action classification helper is unavailable.',
        safe: false,
      };
      candidates.push({
        label: label.slice(0, 180),
        tag: el.tagName.toLowerCase(),
        type,
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        classification: classification.classification,
        reason: classification.reason,
        safe: classification.safe === true,
      });
    });
    return candidates.slice(0, 50);
  }

  async function observeAndScanFields(options = {}) {
    const maxWaitMs = options.maxWaitMs ?? 3500;
    const intervalMs = options.intervalMs ?? 400;
    const start = Date.now();
    let lastCount = -1;
    let stablePasses = 0;
    let bestScan = window.__scanApplicationForm ? window.__scanApplicationForm() : { fields: [] };
    const extraScans = [];

    while (Date.now() - start < maxWaitMs) {
      const scan = window.__scanApplicationForm ? window.__scanApplicationForm() : { fields: [] };
      const iframeScans = scanSameOriginIframes();
      iframeScans.forEach((s) => extraScans.push(s));
      const merged = mergeFieldsByStableId([scan, ...iframeScans]);
      bestScan = { ...scan, fields: merged };

      if (merged.length === lastCount) stablePasses += 1;
      else {
        stablePasses = 0;
        lastCount = merged.length;
      }

      if (stablePasses >= 2 && window.__looksLikeApplicationForm?.(bestScan)) break;
      if (merged.length > 0 && stablePasses >= 3) break;
      await sleep(intervalMs);
    }

    return { scan: bestScan, extraScans };
  }

  async function discoverApplicationForm(options = {}) {
    try {
    const platform = detectPlatform();
    const adapter = getPlatformAdapter(platform);
    const template = resolveApplyTemplate(platform, adapter, options);
    const templateDiscovery = template?.discovery || {};
    const discoveredAt = new Date().toISOString();

    const openApplyForm = options.openApplyForm === true && options.allowUserApprovedAction === true;
    let expandDynamic = false;
    if (options.expandDynamic === true) {
      expandDynamic = true;
    } else if (options.expandDynamic === false) {
      expandDynamic = false;
    } else if (templateDiscovery.expandDynamicOnPreview === true) {
      expandDynamic = true;
    }

    const external = adapter?.detectExternalApplyLink?.() || null;
    if (external?.external || template?.id === 'justjoin_external_apply') {
      const warnings = adapter?.buildWarnings?.({ fields: [] }, { externalUrl: external?.url })
        || [`External apply link: ${external?.url}`];
      return {
        platform,
        templateId: template?.id || 'justjoin_external_apply',
        templateName: template?.name || 'External Apply',
        flowType: 'external_redirect',
        discoveredAt,
        externalUrl: external?.url,
        externalLabel: external?.label,
        fields: [],
        pages: [],
        applyFlow: { clicked: false, reason: 'external_link_detected' },
        dynamicActions: [],
        continueButtons: [],
        warnings,
        formDetected: false,
      };
    }

    let applyFlow = null;
    const initialScan = window.__scanApplicationForm ? window.__scanApplicationForm() : { fields: [] };
    let formDetected = window.__looksLikeApplicationForm?.(initialScan);

    if (openApplyForm && !formDetected && window.__clickApplyToOpenForm) {
      applyFlow = window.__clickApplyToOpenForm();
      if (applyFlow?.clicked) {
        await sleep(templateDiscovery.postApplyWaitMs ?? (platform === 'justjoin' ? 1500 : 800));
      } else if (applyFlow?.reason === 'form_already_open') {
        formDetected = true;
      }
    }

    let dynamicActions = [];
    const observed = await observeAndScanFields({
      maxWaitMs: templateDiscovery.scanPollMs ?? (platform === 'justjoin' ? 6000 : (options.dynamicWaitMs ?? 4000)),
      intervalMs: templateDiscovery.scanIntervalMs ?? 400,
    });
    let scan = observed.scan;
    let extraScans = observed.extraScans || [];

    if (expandDynamic && adapter?.revealDynamicFields) {
      dynamicActions = adapter.revealDynamicFields();
      if (dynamicActions.length) {
        await sleep(500);
        const afterReveal = await observeAndScanFields({
          maxWaitMs: templateDiscovery.revealPollMs ?? 2500,
          intervalMs: 300,
        });
        scan = afterReveal.scan;
        extraScans = afterReveal.extraScans || extraScans;
      }
    }

    const pages = [{
      pageUrl: scan.pageUrl,
      pageTitle: scan.pageTitle,
      pageStep: scan.pageStep,
      scannedAt: scan.scannedAt || discoveredAt,
      fieldCount: scan.fields?.length || 0,
      source: 'main',
    }];
    extraScans.forEach((extra) => {
      pages.push({
        pageUrl: extra.pageUrl,
        pageTitle: extra.pageTitle,
        pageStep: extra.pageStep,
        scannedAt: extra.scannedAt,
        fieldCount: extra.fields?.length || 0,
        source: extra.source || 'iframe',
      });
    });

    formDetected = window.__looksLikeApplicationForm?.(scan) || (scan.fields?.length > 0);
    const flowType = adapter?.detectFlowType?.(scan, {
      externalUrl: null,
      applyFlow,
      dynamicActions,
      template,
    }) || detectGenericFlowType(scan, { dynamicActions });

    const warnings = adapter?.buildWarnings?.(scan, {
      externalUrl: null,
      applyFlow,
      dynamicActions,
      template,
    }) || [];
    if (options.openApplyForm === true && !options.allowUserApprovedAction) {
      warnings.push('Opening the Apply form was skipped because it was not separately approved; discovery stayed read-only.');
    }

    if (applyFlow?.clicked && !formDetected) {
      warnings.push('Apply was clicked but fields are not visible yet — wait a moment or click Apply again on the job page.');
    }

    if (applyFlow) {
      applyFlow.formAppeared = formDetected;
      applyFlow.finalFieldCount = scan.fields?.length || 0;
    }

    const fieldStatuses = (scan.fields || []).reduce((acc, field) => {
      acc[field.status || 'ambiguous'] = (acc[field.status || 'ambiguous'] || 0) + 1;
      return acc;
    }, {});
    const matchedFields = (scan.fields || []).filter((field) => field.status === 'matched').length;
    const unresolvedFields = (scan.fields || []).filter((field) => field.status !== 'matched').length;

    const navigationCandidates = findNavigationCandidates(options.mode);
    return {
      platform,
      templateId: template?.id || null,
      templateVersion: template?.version || template?.schemaVersion || 'legacy-v1',
      templateName: template?.name || null,
      flowType,
      discoveredAt,
      pageSignature: scan.pageSignature || `${platform}:${window.location.href}:${scan.fields?.length || 0}`,
      externalUrl: null,
      fields: scan.fields || [],
      pages,
      scanMeta: {
        pageUrl: scan.pageUrl,
        pageTitle: scan.pageTitle,
        pageStep: scan.pageStep,
        scannedAt: scan.scannedAt || discoveredAt,
        pageSignature: scan.pageSignature || `${platform}:${window.location.href}`,
      },
      coverage: {
        visibleFields: (scan.fields || []).length,
        matchedFields,
        unresolvedFields,
      },
      fieldStatusSummary: fieldStatuses,
      applyFlow,
      dynamicActions,
      navigationCandidates,
      continueButtons: navigationCandidates.filter((action) =>
        /^(next|continue|proceed|dalej|kontynuuj|weiter)$/i.test(action.label)
      ),
      host: window.location.hostname.toLowerCase(),
      siteKey: `${platform}:${window.location.hostname.toLowerCase()}`,
      warnings,
      formDetected,
    };
    } catch (e) {
      return {
        platform: detectPlatform(),
        templateId: null,
        templateVersion: 'legacy-v1',
        templateName: null,
        flowType: 'unknown',
        discoveredAt: new Date().toISOString(),
        pageSignature: `${detectPlatform()}:${window.location.href}:error`,
        externalUrl: null,
        fields: [],
        pages: [],
        scanMeta: {
          pageUrl: window.location.href,
          pageTitle: document.title,
          pageStep: '',
          scannedAt: new Date().toISOString(),
          pageSignature: `${detectPlatform()}:${window.location.href}:error`,
        },
        coverage: {
          visibleFields: 0,
          matchedFields: 0,
          unresolvedFields: 0,
        },
        applyFlow: null,
        dynamicActions: [],
        continueButtons: [],
        warnings: [e?.message || 'Form discovery failed on this page.'],
        formDetected: false,
        __qtsDiscoveryError: e?.message || String(e),
      };
    }
  }

  window.__discoverApplicationForm = discoverApplicationForm;
  window.__runDiscoverApplicationForm = (options) => window.__discoverApplicationForm(options);
  window.__captureApplicationStep = captureCurrentApplicationStep;
})();
