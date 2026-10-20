// Application flow types and display helpers (popup + content scripts)

(function initQtsApplicationFlow(global) {
  if (global.__qtsApplicationFlow?.getNavigationBoundaryReason) return;

  const APPLICATION_FLOW_TYPES = {
    INLINE_SINGLE: 'inline_single',
    MODAL: 'modal',
    MULTI_STEP: 'multi_step',
    EXTERNAL_REDIRECT: 'external_redirect',
    DYNAMIC: 'dynamic',
    UNKNOWN: 'unknown',
  };

  /** High-level apply strategy used by the extension (site-agnostic). */
  const APPLY_METHOD_TYPES = {
    EASY_APPLY: 'easy_apply',
    SINGLE_STEP: 'single_step',
    MULTI_STEP: 'multi_step',
    EXTERNAL_REDIRECT: 'external_redirect',
    UNKNOWN: 'unknown',
  };

  const APPLICATION_MODES = {
    DISCOVERY: 'DISCOVERY',
    REAL_APPLICATION: 'REAL_APPLICATION',
  };

  const ACTION_CLASSIFICATIONS = {
    VERIFIED_TEST_NAVIGATION: 'VERIFIED_TEST_NAVIGATION',
    POSSIBLE_NEXT_REQUIRES_REVIEW: 'POSSIBLE_NEXT_REQUIRES_REVIEW',
    FINAL_SUBMIT: 'FINAL_SUBMIT',
    UNKNOWN_OR_SIDE_EFFECT: 'UNKNOWN_OR_SIDE_EFFECT',
    BLOCKED: 'BLOCKED',
  };

  const FLOW_TYPE_LABELS = {
    inline_single: 'Single-page form',
    modal: 'Modal popup form',
    multi_step: 'Multi-step form',
    external_redirect: 'External apply link',
    dynamic: 'Dynamic form (fields appear after actions)',
    unknown: 'Unknown flow',
  };

  const APPLY_METHOD_LABELS = {
    easy_apply: 'Easy Apply',
    single_step: 'Single-step form',
    multi_step: 'Multi-step form',
    external_redirect: 'External apply',
    unknown: 'Unknown apply method',
  };

  const APPLY_METHOD_DESCRIPTIONS = {
    easy_apply: 'One-click Apply opens an in-page modal or overlay (guest apply, no job-board login).',
    single_step: 'All fields on one page after Apply (inline form, no wizard).',
    multi_step: 'Apply wizard with multiple steps (Next / step N of M).',
    external_redirect: 'Apply leaves the job board for employer ATS or career site.',
    unknown: 'Apply method not recognized yet — open Apply or run discovery.',
  };

  const FIELD_TYPE_LABELS = {
    text: 'Text',
    email: 'Email',
    tel: 'Phone',
    textarea: 'Long text',
    select: 'Dropdown',
    radio: 'Radio',
    checkbox: 'Checkbox',
    switch: 'Toggle',
    file: 'File upload',
    combobox: 'Combobox',
    listbox: 'List',
    contenteditable: 'Rich text',
  };

  const CATEGORY_LABELS = {
    candidate_profile: 'Profile',
    saved_answer: 'Saved answer',
    ai_generation: 'AI question',
    document_upload: 'Document upload',
    unknown: 'Unknown',
  };

  function detectPlatformFromUrl(url) {
    const host = String(url || '').toLowerCase();
    if (host.includes('justjoin.it')) return 'justjoin';
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('indeed.com')) return 'indeed';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    return 'generic';
  }

  function formatFlowType(flowType) {
    return FLOW_TYPE_LABELS[flowType] || flowType || 'Unknown';
  }

  function formatApplyMethod(applyMethod) {
    return APPLY_METHOD_LABELS[applyMethod] || applyMethod || 'Unknown';
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function detectMultiStepHints(scan, root = typeof document !== 'undefined' ? document : null) {
    const pageStep = cleanText(scan?.pageStep || '');
    if (/step\s+\d+\s+of\s+\d+/i.test(pageStep)) {
      const match = pageStep.match(/step\s+(\d+)\s+of\s+(\d+)/i);
      return {
        isMultiStep: true,
        currentStep: match ? Number(match[1]) : null,
        totalSteps: match ? Number(match[2]) : null,
        source: 'pageStep',
      };
    }
    if (root?.querySelector?.('[aria-current="step"], [data-testid*="step" i], [class*="stepper" i]')) {
      return { isMultiStep: true, currentStep: null, totalSteps: null, source: 'dom' };
    }
    return { isMultiStep: false, currentStep: null, totalSteps: null, source: null };
  }

  function resolveApplyMethod({ template, flowType, platform, signals, scan } = {}) {
    if (template?.applyMethod) return template.applyMethod;
    if (flowType === APPLICATION_FLOW_TYPES.EXTERNAL_REDIRECT || signals?.externalApplyLink) {
      return APPLY_METHOD_TYPES.EXTERNAL_REDIRECT;
    }
    const stepHints = detectMultiStepHints(scan);
    if (flowType === APPLICATION_FLOW_TYPES.MULTI_STEP || stepHints.isMultiStep) {
      return APPLY_METHOD_TYPES.MULTI_STEP;
    }
    if (flowType === APPLICATION_FLOW_TYPES.INLINE_SINGLE) {
      return APPLY_METHOD_TYPES.SINGLE_STEP;
    }
    if (
      flowType === APPLICATION_FLOW_TYPES.MODAL
      || template?.guestApply === true
      || template?.id === 'justjoin_easy_apply'
    ) {
      return APPLY_METHOD_TYPES.EASY_APPLY;
    }
    if (platform === 'justjoin' && signals?.nativeApplyButton && !signals?.externalApplyLink) {
      return APPLY_METHOD_TYPES.EASY_APPLY;
    }
    if (platform === 'justjoin' && signals?.externalApplyLink) {
      return APPLY_METHOD_TYPES.EXTERNAL_REDIRECT;
    }
    return APPLY_METHOD_TYPES.UNKNOWN;
  }

  function resolveFlowType({ template, adapter, scan, context, signals } = {}) {
    if (typeof adapter?.detectFlowType === 'function') {
      return adapter.detectFlowType(scan, context) || APPLICATION_FLOW_TYPES.UNKNOWN;
    }
    if (typeof template?.hooks?.detectFlowType === 'function') {
      return template.hooks.detectFlowType(scan, context) || APPLICATION_FLOW_TYPES.UNKNOWN;
    }
    const stepHints = detectMultiStepHints(scan);
    if (stepHints.isMultiStep) return APPLICATION_FLOW_TYPES.MULTI_STEP;
    if (context?.externalUrl || signals?.externalApplyLink) return APPLICATION_FLOW_TYPES.EXTERNAL_REDIRECT;
    if (signals?.modalOpen) return APPLICATION_FLOW_TYPES.MODAL;
    if (scan?.fields?.length) return APPLICATION_FLOW_TYPES.INLINE_SINGLE;
    if (template?.anticipatedFlowType) return template.anticipatedFlowType;
    return APPLICATION_FLOW_TYPES.UNKNOWN;
  }

  function formatFieldType(fieldType) {
    return FIELD_TYPE_LABELS[fieldType] || fieldType || 'Field';
  }

  function formatCategory(category) {
    return CATEGORY_LABELS[category] || category || 'Unknown';
  }

  function summarizeDiscoveryCounts(fields) {
    const list = fields || [];
    return {
      total: list.length,
      required: list.filter((f) => f.required).length,
      profile: list.filter((f) => f.category === 'candidate_profile').length,
      saved: list.filter((f) => f.category === 'saved_answer').length,
      ai: list.filter((f) => f.category === 'ai_generation').length,
      upload: list.filter((f) => f.category === 'document_upload' || f.fieldType === 'file').length,
      filled: list.filter((f) => f.fillStatus === 'filled').length,
      awaiting: list.filter((f) => f.fillStatus === 'awaiting_answer' || f.fillStatus === 'pending').length,
    };
  }

  function summarizeReviewState(fields) {
    const list = Array.isArray(fields) ? fields : [];
    const reviewItems = list.filter((field) => {
      const status = String(field?.status || '').toLowerCase();
      const fillStatus = String(field?.fillStatus || '').toLowerCase();
      return Boolean(
        field?.requiresReview
        || field?.category === 'needs_review'
        || status === 'ambiguous'
        || status === 'unresolved'
        || fillStatus === 'needs_review'
      );
    });

    const reasons = [...new Set(reviewItems
      .map((field) => field?.statusReason || field?.reason || `Field requires review: ${field?.label || field?.stableFieldId || 'unknown'}`)
      .filter(Boolean))];

    return {
      reviewRequired: reviewItems.length > 0,
      reviewCount: reviewItems.length,
      reviewReasons: reasons,
      fields: reviewItems,
    };
  }

  function shouldBlockRealApplication(fields, options = {}) {
    const mode = normalizeApplicationMode(options.mode);
    if (mode !== APPLICATION_MODES.REAL_APPLICATION) {
      return {
        blocked: false,
        reason: null,
        reviewState: summarizeReviewState(fields),
      };
    }

    const reviewState = summarizeReviewState(fields);
    if (!reviewState.reviewRequired) {
      return {
        blocked: false,
        reason: null,
        reviewState,
      };
    }

    return {
      blocked: true,
      reason: 'REAL_APPLICATION_REQUIRES_FIELD_REVIEW',
      reviewState,
    };
  }

  function normalizeApplicationMode(mode) {
    const value = String(mode || APPLICATION_MODES.DISCOVERY).toUpperCase();
    if (value === APPLICATION_MODES.REAL_APPLICATION) return APPLICATION_MODES.REAL_APPLICATION;
    return APPLICATION_MODES.DISCOVERY;
  }

  function classifyNavigationAction(action, options = {}) {
    const label = String(action || '').trim();
    const normalized = label.toLowerCase();
    const mode = normalizeApplicationMode(options.mode);
    const nextLabel = label || 'unknown';

    if (/^(submit|final submit|submit application|send application|send|finish and submit|complete application|apply now)$/i.test(nextLabel)) {
      return {
        classification: ACTION_CLASSIFICATIONS.FINAL_SUBMIT,
        reason: 'Final submit control detected.',
        safe: false,
        allowedInDiscoveryOnly: false,
      };
    }

    if (/(captcha|one.time.password|\botp\b|verify|verification|sign in|log in|login|create account|consent|attestation|e-sign|signature)/i.test(normalized)) {
      return {
        classification: ACTION_CLASSIFICATIONS.UNKNOWN_OR_SIDE_EFFECT,
        reason: 'Authentication, verification, or consent flow detected.',
        safe: false,
        allowedInDiscoveryOnly: false,
      };
    }

    if (/(cancel|close|back|previous)/i.test(normalized)) {
      return {
        classification: ACTION_CLASSIFICATIONS.BLOCKED,
        reason: 'Browser navigation or close action may discard session state or trigger autosave.',
        safe: false,
        allowedInDiscoveryOnly: false,
      };
    }

    if (/^(next|continue|save and continue|proceed|weiter|dalej|kontynuuj)$/i.test(nextLabel)) {
      const verifiedTestNavigation = mode === APPLICATION_MODES.DISCOVERY
        && options.authorizedTestEnvironment === true
        && options.allowTestNavigation === true
        && options.navigationVerified === true;
      return {
        classification: verifiedTestNavigation
          ? ACTION_CLASSIFICATIONS.VERIFIED_TEST_NAVIGATION
          : ACTION_CLASSIFICATIONS.POSSIBLE_NEXT_REQUIRES_REVIEW,
        reason: verifiedTestNavigation
          ? 'Navigation is verified for an explicitly authorized test environment.'
          : 'Navigation may save or mutate application state and requires user review.',
        safe: verifiedTestNavigation,
        allowedInDiscoveryOnly: true,
      };
    }

    return {
      classification: ACTION_CLASSIFICATIONS.UNKNOWN_OR_SIDE_EFFECT,
      reason: 'Action was not recognized as safe or blocked.',
      safe: false,
      allowedInDiscoveryOnly: false,
    };
  }

  function getNavigationBoundaryReason(context = {}) {
    if (context.verificationRequired) {
      return 'This appears to be an email or one-time-code verification step. Complete verification yourself; Apply paused.';
    }

    const fieldTypes = Array.isArray(context.fieldTypes)
      ? context.fieldTypes.map((type) => cleanText(type).toLowerCase())
      : [];
    const text = cleanText(context.text);
    const hasEmailField = context.hasEmailField === true
      || fieldTypes.includes('email');
    const emailAccountEntry = hasEmailField
      && fieldTypes.length > 0
      && fieldTypes.length <= 2
      && fieldTypes.every((type) => ['email', 'password', 'text', 'textbox'].includes(type))
      && /\b(apply now|start your application|candidate|create account|register)\b/i.test(text)
      && /\b(terms|privacy policy|verification)\b/i.test(text);

    if (emailAccountEntry) {
      return 'This appears to be an email/account entry step before the application. Continue manually; Apply will rescan the page afterward.';
    }
    return null;
  }

  function selectAutomaticNextAction(candidates = []) {
    const allowedLabels = new Set([
      'next',
      'continue',
      'save and continue',
      'proceed',
      'weiter',
      'dalej',
      'kontynuuj',
    ]);
    const recognized = (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
      const label = cleanText(candidate?.label);
      return !candidate?.disabled
        && allowedLabels.has(label.toLowerCase())
        && classifyNavigationAction(label, { mode: APPLICATION_MODES.REAL_APPLICATION }).classification
          === ACTION_CLASSIFICATIONS.POSSIBLE_NEXT_REQUIRES_REVIEW;
    });
    if (recognized.length !== 1) {
      return {
        action: null,
        reason: recognized.length
          ? 'More than one recognized next-step control is visible.'
          : 'No recognized next-step control is available.',
      };
    }
    const action = recognized[0];
    if (action.navigationBoundaryReason) {
      return { action: null, reason: action.navigationBoundaryReason };
    }
    return { action, reason: null };
  }

  function selectAutomaticFinalSubmitAction(candidates = []) {
    const allowedLabels = new Set([
      'submit',
      'submit application',
      'finish and submit',
      'complete application',
    ]);
    const eligible = (Array.isArray(candidates) ? candidates : []).filter((candidate) => (
      !candidate?.disabled
      && allowedLabels.has(cleanText(candidate?.label).toLowerCase())
      && classifyNavigationAction(candidate.label, { mode: APPLICATION_MODES.REAL_APPLICATION }).classification
        === ACTION_CLASSIFICATIONS.FINAL_SUBMIT
    ));
    if (eligible.length !== 1) {
      return {
        action: null,
        reason: eligible.length
          ? 'More than one recognized final-submit control is visible.'
          : 'No unique recognized final-submit control is available.',
      };
    }
    return { action: eligible[0], reason: null };
  }

  function buildDiscoveryCheckpoint(discovery = {}, previous = {}) {
    const signature = String(discovery.pageSignature || discovery.scanMeta?.pageSignature || '').trim();
    const scannedFields = Array.isArray(discovery.fields) ? discovery.fields : [];
    const pageStep = String(discovery.scanMeta?.pageStep || '').replace(/\s+/g, ' ').trim();
    const sections = [...new Set(scannedFields
      .map((field) => String(field?.sectionHeading || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean))].sort();
    const stepDescriptor = pageStep || sections.join('|');
    const stableStepMaterial = stepDescriptor ? [discovery.siteKey || '', stepDescriptor].join('|') : '';
    let stepHash = 0;
    for (let index = 0; index < stableStepMaterial.length; index += 1) {
      stepHash = ((stepHash << 5) - stepHash) + stableStepMaterial.charCodeAt(index);
      stepHash |= 0;
    }
    const stepId = stableStepMaterial.replace(/\|/g, '')
      ? `step-${Math.abs(stepHash).toString(36)}`
      : (signature || `step-${Date.now()}`);
    const previousSteps = Array.isArray(previous.steps) ? previous.steps : [];
    const oldStep = previousSteps.find((step) => step.stepId === stepId);
    const oldFields = new Map((oldStep?.fields || []).map((field) => [String(field?.fieldId || ''), field]));
    const fields = scannedFields.slice(0, 300).map((field) => ({
      fieldId: String(field?.stableFieldId || field?.fieldId || 'unknown-field').slice(0, 255),
      question: String(field?.question || field?.label || '').replace(/\s+/g, ' ').trim().slice(0, 1000) || null,
      fieldType: String(field?.fieldType || field?.type || 'unknown').slice(0, 64),
      required: Boolean(field?.required),
      matchMethod: String(field?.matchMethod || 'unknown').slice(0, 64),
      confidence: Math.max(0, Math.min(1, Number(field?.confidence ?? 0) || 0)),
      status: field?.status === 'ambiguous' || field?.status === 'unresolved' ? field.status : 'matched',
      selectorHints: field?.selectorHints && typeof field.selectorHints === 'object' ? field.selectorHints : undefined,
      domEvidence: field?.domEvidence && typeof field.domEvidence === 'object' ? field.domEvidence : undefined,
      scannerCapture: field?.scannerCapture && typeof field.scannerCapture === 'object'
        ? field.scannerCapture
        : oldFields.get(String(field?.stableFieldId || field?.fieldId || ''))?.scannerCapture,
    }));
    const actions = (Array.isArray(discovery.navigationCandidates)
      ? discovery.navigationCandidates
      : (Array.isArray(discovery.continueButtons) ? discovery.continueButtons : []))
      .slice(0, 50)
      .map((action) => ({
        label: String(action?.label || 'unknown').replace(/\s+/g, ' ').trim().slice(0, 180),
        classification: String(action?.classification || ACTION_CLASSIFICATIONS.UNKNOWN_OR_SIDE_EFFECT),
        reason: String(action?.reason || 'Action was detected but not activated.').slice(0, 240),
        tag: String(action?.tag || '').slice(0, 24),
        type: String(action?.type || '').slice(0, 24),
      }));
    const timestamp = new Date().toISOString();
    const step = {
      stepId,
      pageStep: pageStep.slice(0, 180),
      fieldCount: fields.length,
      fields,
      actions,
      firstSeenAt: oldStep?.firstSeenAt || timestamp,
      lastSeenAt: timestamp,
    };
    const orderedSteps = previousSteps.filter((item) => item?.stepId !== stepId).concat(step).slice(-50);
    let remainingFields = 300;
    const steps = orderedSteps.slice().reverse().map((item) => {
      const retainedFields = (Array.isArray(item.fields) ? item.fields : []).slice(0, remainingFields);
      remainingFields -= retainedFields.length;
      return { ...item, fields: retainedFields };
    }).reverse();
    const previousCurrent = String(previous.currentStepId || '');
    const transitions = Array.isArray(previous.transitions) ? previous.transitions.slice(-99) : [];
    if (previousCurrent && previousCurrent !== stepId
      && !transitions.some((transition) => transition.from === previousCurrent && transition.to === stepId)) {
      transitions.push({
        from: previousCurrent,
        to: stepId,
        action: 'unobserved_user_navigation',
        status: 'observed_unverified',
        observedAt: timestamp,
      });
    }

    return {
      schemaVersion: 1,
      siteKey: String(discovery.siteKey || previous.siteKey || '').slice(0, 255),
      platform: String(discovery.platform || previous.platform || '').slice(0, 64),
      host: String(discovery.host || previous.host || '').toLowerCase().slice(0, 255),
      status: 'partial',
      currentStepId: stepId,
      steps,
      transitions,
      finalBoundaryFound: Boolean(previous.finalBoundaryFound || actions.some(
        (action) => action.classification === ACTION_CLASSIFICATIONS.FINAL_SUBMIT
      )),
      updatedAt: timestamp,
    };
  }

  function buildRecoveryErrorPayload({
    sessionId = '',
    stepId = 'unknown',
    fieldId = null,
    errorCode = 'UNKNOWN',
    recoverable = true,
    attempts = 0,
    action = 'RETRY',
    diagnostics = {},
  } = {}) {
    return {
      sessionId,
      stepId,
      fieldId,
      errorCode,
      recoverable,
      attempts,
      action,
      diagnostics: Object.fromEntries(Object.entries(diagnostics || {}).map(([key, value]) => {
        if (typeof value === 'string') return [key, value.replace(/\s+/g, ' ').trim()];
        return [key, value];
      })),
    };
  }

  function buildTemplateDraftFromDiscovery(discovery = {}, options = {}) {
    const fields = Array.isArray(discovery.fields) ? discovery.fields.map((field) => ({
      fieldId: field?.fieldId || field?.stableFieldId || field?.id || 'unknown-field',
      question: field?.question || field?.label || null,
      fieldType: field?.fieldType || field?.type || 'unknown',
      required: Boolean(field?.required),
      matchMethod: field?.matchMethod || 'unknown',
      confidence: Number(field?.confidence ?? 0) || 0,
      status: field?.status === 'ambiguous' || field?.status === 'unresolved' ? field.status : 'matched',
      selectorHints: field?.selectorHints && typeof field.selectorHints === 'object' ? field.selectorHints : undefined,
      domEvidence: field?.domEvidence && typeof field.domEvidence === 'object' ? field.domEvidence : undefined,
      scannerCapture: field?.scannerCapture && typeof field.scannerCapture === 'object' ? field.scannerCapture : undefined,
    })) : [];

    const coverage = discovery.coverage && typeof discovery.coverage === 'object'
      ? { ...discovery.coverage }
      : {
          visibleFields: fields.length,
          matchedFields: fields.filter((field) => field.status === 'matched').length,
          unresolvedFields: fields.filter((field) => field.status === 'unresolved' || field.status === 'ambiguous').length,
        };

    return {
      siteKey: discovery.siteKey || options.siteKey || null,
      platform: discovery.platform || options.platform || null,
      host: discovery.host || options.host || null,
      templateVersion: discovery.templateVersion || 'legacy-v1',
      pageSignature: discovery.pageSignature || options.pageSignature || null,
      status: discovery.status || 'draft',
      coverage,
      navigation: discovery.navigation || { classification: discovery.navigationClassification || 'unknown' },
      verification: discovery.verification || {},
      metadata: discovery.metadata || {},
      fields,
    };
  }

  function sanitizeTemplateDiscovery(discovery = {}, options = {}) {
    const draft = buildTemplateDraftFromDiscovery(discovery, options);
    return {
      ...draft,
      siteKey: String(draft.siteKey || '').trim() || null,
      platform: String(draft.platform || '').trim() || null,
      host: String(draft.host || '').trim() || null,
      templateVersion: String(draft.templateVersion || 'legacy-v1').trim() || 'legacy-v1',
      pageSignature: String(draft.pageSignature || '').trim() || null,
      status: ['draft', 'partial', 'active', 'deprecated'].includes(draft.status) ? draft.status : 'draft',
      coverage: draft.coverage && typeof draft.coverage === 'object' ? {
        visibleFields: Number(draft.coverage.visibleFields ?? draft.coverage.visible ?? 0) || 0,
        matchedFields: Number(draft.coverage.matchedFields ?? 0) || 0,
        unresolvedFields: Number(draft.coverage.unresolvedFields ?? 0) || 0,
      } : {
        visibleFields: 0,
        matchedFields: 0,
        unresolvedFields: 0,
      },
      fields: Array.isArray(draft.fields) ? draft.fields.map((field) => ({
        fieldId: String(field.fieldId || 'unknown-field'),
        question: typeof field.question === 'string' ? field.question : null,
        fieldType: String(field.fieldType || 'unknown'),
        required: Boolean(field.required),
        matchMethod: String(field.matchMethod || 'unknown'),
        confidence: Number(field.confidence ?? 0) || 0,
        status: field.status === 'ambiguous' || field.status === 'unresolved' ? field.status : 'matched',
        selectorHints: field.selectorHints && typeof field.selectorHints === 'object' ? field.selectorHints : undefined,
      })) : [],
    };
  }

  function findReusableTemplateFromList(discovery = {}, templates = [], options = {}) {
    const list = Array.isArray(templates) ? templates.filter((template) => {
      if (!template || typeof template !== 'object') return false;
      const matchesSite = Boolean(discovery.siteKey || options.siteKey)
        ? (template.siteKey || '') === (discovery.siteKey || options.siteKey || '')
        : true;
      const matchesHost = Boolean(discovery.host || options.host)
        ? (template.host || '') === (discovery.host || options.host || '')
        : true;
      const matchesPlatform = Boolean(discovery.platform || options.platform)
        ? (template.platform || '') === (discovery.platform || options.platform || '')
        : true;
      return matchesSite && matchesHost && matchesPlatform && template.status !== 'deprecated';
    }) : [];

    const reusable = list.sort((a, b) => {
      const rank = (status) => ({ active: 3, partial: 2, draft: 1, deprecated: 0 }[status] ?? 0);
      const coverageDelta = Number(b.coverage?.matchedFields ?? 0) - Number(a.coverage?.matchedFields ?? 0);
      return rank(b.status) - rank(a.status) || coverageDelta || (b.updatedAt || '').localeCompare(a.updatedAt || '');
    })[0] || null;

    return {
      template: reusable,
      safeToReuse: Boolean(reusable && (reusable.status === 'active' || reusable.status === 'partial')),
      reason: reusable ? null : 'No reusable active or partial template found for the current site.',
    };
  }

  async function persistDiscoveryTemplate(discovery = {}, options = {}) {
    const payload = sanitizeTemplateDiscovery(discovery, options);
    const serverUrl = String(options.serverUrl || globalThis.__QTS_SERVER_URL || '').replace(/\/+$/, '');
    if (!serverUrl) {
      return {
        success: false,
        message: 'No server URL configured for template persistence.',
        safeToReuse: false,
        template: payload,
      };
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(`${serverUrl}/api/application-templates/from-discovery`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({ success: false, message: 'Template persistence returned an invalid response.' }));
    if (!response.ok) {
      return {
        ...data,
        success: false,
        safeToReuse: false,
        template: payload,
      };
    }

    return {
      ...data,
      success: true,
      safeToReuse: Boolean(data?.template && (data.template.status === 'active' || data.template.status === 'partial')),
      template: data?.template ?? payload,
    };
  }

  const api = {
    APPLICATION_FLOW_TYPES,
    APPLY_METHOD_TYPES,
    APPLICATION_MODES,
    ACTION_CLASSIFICATIONS,
    FLOW_TYPE_LABELS,
    APPLY_METHOD_LABELS,
    APPLY_METHOD_DESCRIPTIONS,
    FIELD_TYPE_LABELS,
    CATEGORY_LABELS,
    detectPlatformFromUrl,
    formatFlowType,
    formatApplyMethod,
    formatFieldType,
    formatCategory,
    summarizeDiscoveryCounts,
    summarizeReviewState,
    shouldBlockRealApplication,
    detectMultiStepHints,
    resolveApplyMethod,
    resolveFlowType,
    normalizeApplicationMode,
    classifyNavigationAction,
    getNavigationBoundaryReason,
    selectAutomaticNextAction,
    selectAutomaticFinalSubmitAction,
    buildDiscoveryCheckpoint,
    buildRecoveryErrorPayload,
    buildTemplateDraftFromDiscovery,
    sanitizeTemplateDiscovery,
    findReusableTemplateFromList,
    persistDiscoveryTemplate,
  };

  global.__qtsApplicationFlow = api;

  if (typeof module !== 'undefined') {
    module.exports = {
      APPLICATION_FLOW_TYPES,
      APPLY_METHOD_TYPES,
      detectPlatformFromUrl,
      formatFlowType,
      formatApplyMethod,
      formatFieldType,
      formatCategory,
      summarizeDiscoveryCounts,
      summarizeReviewState,
      shouldBlockRealApplication,
      normalizeApplicationMode,
      classifyNavigationAction,
      getNavigationBoundaryReason,
      selectAutomaticNextAction,
      selectAutomaticFinalSubmitAction,
      buildDiscoveryCheckpoint,
      buildTemplateDraftFromDiscovery,
      sanitizeTemplateDiscovery,
      findReusableTemplateFromList,
      persistDiscoveryTemplate,
      resolveApplyMethod,
      resolveFlowType,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
