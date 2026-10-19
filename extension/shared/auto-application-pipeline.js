// Hands-off application pipeline for service worker (default candidate + job page auto-run).

(function initAutoApplicationPipeline(global) {
  if (global.__qtsAutoApplicationPipeline) return;

  const DEFAULT_CANDIDATE_KEY = 'qtsDefaultCandidateByAccount';
  const LEGACY_DEFAULT_CANDIDATE_KEY = 'qtsDefaultCandidateByBidder';
  const SESSION_USER_KEY = 'qtsSessionUser';
  const AUTO_APPLY_ENABLED_KEY = 'qtsAutoApplyEnabled';

  let deps = null;

  function registerDeps(nextDeps) {
    deps = nextDeps || null;
  }

  function detectPlatformFromUrl(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      if (host.includes('linkedin.com')) return 'linkedin';
      if (host.includes('indeed.com')) return 'indeed';
      if (host.includes('glassdoor.com')) return 'glassdoor';
      if (host.includes('greenhouse.io')) return 'greenhouse';
      if (host.includes('lever.co')) return 'lever';
      if (host.includes('workable.com')) return 'workable';
      if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
      if (host.includes('ashbyhq.com')) return 'ashby';
      if (host.includes('justjoin.it')) return 'justjoin';
      return host;
    } catch {
      return 'unknown';
    }
  }

  function needsCustomGptHandoff(fields) {
    return (fields || []).some((field) => field.category === 'ai_generation'
      || field.category === 'document_upload'
      || field.fieldType === 'file');
  }

  function normalizePipelineUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(url || '').trim();
    }
  }

  async function readSessionUser() {
    if (global.__qtsAccountAuth?.readWorkerSessionUser) {
      return global.__qtsAccountAuth.readWorkerSessionUser();
    }
    const stored = await chrome.storage.local.get([SESSION_USER_KEY, 'authExpiresAt']);
    if (stored.authExpiresAt && Date.now() >= Number(stored.authExpiresAt)) return null;
    return stored[SESSION_USER_KEY] || null;
  }

  async function readDefaultCandidateId(accountId) {
    const id = Number(accountId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const stored = await chrome.storage.local.get([DEFAULT_CANDIDATE_KEY, LEGACY_DEFAULT_CANDIDATE_KEY]);
    const legacyMap = stored[LEGACY_DEFAULT_CANDIDATE_KEY];
    const currentMap = stored[DEFAULT_CANDIDATE_KEY];
    let map = currentMap || {};
    if (legacyMap && typeof legacyMap === 'object') {
      map = { ...legacyMap, ...map };
      await chrome.storage.local.set({ [DEFAULT_CANDIDATE_KEY]: map });
      await chrome.storage.local.remove(LEGACY_DEFAULT_CANDIDATE_KEY);
    }
    const candidateId = Number(map[String(id)]);
    return Number.isFinite(candidateId) ? candidateId : null;
  }

  async function isAutoApplyEnabled() {
    const auth = global.__qtsAccountAuth;
    const token = auth?.getWorkerAuthToken
      ? await auth.getWorkerAuthToken()
      : (await chrome.storage.local.get(['authToken'])).authToken || '';
    if (!token) return false;
    const stored = await chrome.storage.local.get([AUTO_APPLY_ENABLED_KEY, 'qtsCustomGptConfig']);
    return stored[AUTO_APPLY_ENABLED_KEY] === true
      && Boolean(stored.qtsCustomGptConfig?.url);
  }

  async function setAutoApplyEnabled(enabled) {
    await chrome.storage.local.set({ [AUTO_APPLY_ENABLED_KEY]: Boolean(enabled) });
  }

  async function isExtensionOperational() {
    const user = await readSessionUser();
    if (!user || user.role !== 'account') return false;
    if (!(await isAutoApplyEnabled())) return false;
    const candidateId = await readDefaultCandidateId(user.accountId);
    return Number.isFinite(candidateId) && candidateId > 0;
  }

  async function resolveDefaultCandidateId() {
    const user = await readSessionUser();
    if (!user || user.role !== 'account') return null;
    if (!(await isAutoApplyEnabled())) return null;
    return readDefaultCandidateId(user.accountId);
  }

  async function isDefaultCandidateAlreadyApplied(jobUrl, candidateId) {
    const api = global.__qtsApiWorker;
    if (!api?.workerCheckDefaultCandidateApplied) {
      return { applied: false, jobSaved: false, candidateId };
    }
    return api.workerCheckDefaultCandidateApplied(jobUrl, candidateId);
  }

  async function runAutoApplicationPipeline(tabId, options = {}) {
    if (!deps) throw new Error('Auto application pipeline is not initialized.');

    const appFlow = global.__qtsApplicationFlow;
    const mode = appFlow?.normalizeApplicationMode?.(options.mode) || 'DISCOVERY';
    if (mode === 'REAL_APPLICATION' && !options.userApproved) {
      const recovery = appFlow?.buildRecoveryErrorPayload?.({
        sessionId: options.sessionId || `tab:${tabId}`,
        stepId: 'AUTO_PIPELINE',
        errorCode: 'REAL_APPLICATION_MODE_REQUIRES_APPROVAL',
        recoverable: true,
        attempts: 1,
        action: 'USER_REQUIRED',
        diagnostics: { mode, reason: 'Real application mode requires explicit user approval before auto-filling or navigation.' },
      });
      return { ok: false, blocked: true, mode, reason: 'REAL_APPLICATION_MODE_REQUIRES_APPROVAL', recovery };
    }

    const candidateId = options.candidateId || await resolveDefaultCandidateId();
    if (!candidateId) return { ok: false, skipped: true, reason: 'no_default_candidate' };

    const tab = await deps.getTab(tabId);
    if (!tab?.id || !tab.url) throw new Error('Job tab not found.');

    const jobUrl = normalizePipelineUrl(options.jobUrl || tab.url);

    const applyCheck = await isDefaultCandidateAlreadyApplied(jobUrl, candidateId);
    if (applyCheck.applied) {
      deps?.showPageDetectAlert?.(tabId, 'Applied', 'applied', 10000).catch?.(() => {});
      return {
        ok: false,
        skipped: true,
        reason: 'already_applied',
        candidateId,
        jobId: applyCheck.jobId ?? null,
        appliedAt: applyCheck.appliedAt ?? null,
      };
    }

    deps.preloadCustomGptTab?.().catch?.(() => {});

    lastProgress(tabId, 'Loading candidate profile…');

    const api = global.__qtsApiWorker;
    if (!api?.workerApiRequest) throw new Error('API worker not loaded.');

    const profileRes = await api.workerApiRequest('GET', `/api/candidates/${candidateId}`);
    if (!profileRes.success || !profileRes.candidate) {
      throw new Error(profileRes.message || 'Could not load default candidate profile.');
    }
    const fullCandidate = profileRes.candidate;

    await deps.setJobSourceTab(tabId);
    await deps.detectApplyTemplateOnTab(tabId, jobUrl);
    lastProgress(tabId, 'Discovering application form…');

    const discoverResponse = await deps.discoverApplicationFormOnTab(tabId, {
      openApplyForm: true,
      expandDynamic: false,
      mode,
    });
    if (discoverResponse?.error) {
      throw new Error(discoverResponse.error);
    }

    const discovery = discoverResponse.discovery || {};
    const scanMeta = discoverResponse.scan || discovery.scanMeta || {};
    const scannedFields = discoverResponse.scan?.fields || discovery.fields || [];

    if (discovery.flowType === 'external_redirect' && discovery.externalUrl) {
      throw new Error(`External apply site: ${discovery.externalUrl}`);
    }
    if (!scannedFields.length) {
      throw new Error('No application fields detected on this page.');
    }

    const classifier = global.__qtsFieldClassifier;
    const matcher = global.__qtsCandidateMatcher;
    const fillPolicyApi = global.__qtsFillPolicy;
    if (!classifier?.classifyFields || !matcher?.applyFieldClassificationFill) {
      throw new Error('Field classifier modules not loaded.');
    }

    let classifiedFields = classifier.classifyFields(scannedFields);
    classifiedFields = matcher.applyFieldClassificationFill(classifiedFields, fullCandidate, []);

    const reviewState = appFlow?.summarizeReviewState?.(classifiedFields) || {
      reviewRequired: false,
      reviewCount: 0,
      reviewReasons: [],
      fields: [],
    };
    const reviewGate = appFlow?.shouldBlockRealApplication?.(classifiedFields, { mode }) || {
      blocked: false,
      reason: null,
      reviewState,
    };
    if (reviewGate.blocked) {
      const recovery = appFlow?.buildRecoveryErrorPayload?.({
        sessionId: options.sessionId || `tab:${tabId}`,
        stepId: 'AUTO_PIPELINE_REVIEW_GATE',
        errorCode: 'REAL_APPLICATION_REQUIRES_FIELD_REVIEW',
        recoverable: true,
        attempts: 1,
        action: 'USER_REQUIRED',
        diagnostics: {
          mode,
          reason: 'Real application mode requires a human review of unresolved or ambiguous fields before autofill.',
          reviewCount: reviewState.reviewCount,
          reviewReasons: reviewState.reviewReasons,
        },
      });
      return {
        ok: false,
        blocked: true,
        mode,
        reason: reviewGate.reason,
        reviewState,
        recovery,
      };
    }

    const fillPolicy = fillPolicyApi?.getFillPolicyForTemplate?.(discovery.templateId);
    const fillPolicyContext = { candidate: fullCandidate, savedAnswers: [] };
    if (fillPolicy && fillPolicyApi?.applyFillPolicy) {
      classifiedFields = fillPolicyApi.applyFillPolicy(
        classifiedFields,
        fillPolicy,
        fillPolicyContext
      );
    }

    const earlyProfileFields = fillPolicyApi?.getEarlyProfileFillFields?.(
      classifiedFields,
      fillPolicy
    ) || [];
    const earlyProfileIds = new Set(earlyProfileFields.map((field) => field.stableFieldId));

    if (earlyProfileFields.length) {
      lastProgress(tabId, 'Filling name & email on application form…');
      const earlyFillResponse = await deps.fillApplicationFormOnTab(tabId, earlyProfileFields, {
        mode,
        allowUserApprovedFill: true,
      });
      const earlyResults = earlyFillResponse?.fill?.results || [];
      if (earlyFillResponse?.error) {
        throw new Error(earlyFillResponse.error);
      }
      classifiedFields = fillPolicyApi?.applyEarlyFillResults?.(
        classifiedFields,
        earlyResults
      ) || classifiedFields;
      const filledCount = earlyResults.filter((item) => item.ok).length;
      lastProgress(
        tabId,
        `Name & email filled (${filledCount} field(s)). Resume will come from Custom GPT.`,
        'success'
      );
    }

    const willUseCustomGpt = needsCustomGptHandoff(classifiedFields);

    const extract = options.detectedJob?.data || options.jobData || null;
    const jobTitle = extract?.title || extract?.jobTitle || tab.title || null;
    const company = extract?.company || null;
    const jobDescription = extract?.description || extract?.jobDescription || '';

    lastProgress(tabId, 'Preparing apply session…');
    const templateVersion = discovery.templateVersion || 'legacy-v1';
    const pageFingerprint = discovery.pageSignature || scanMeta.pageSignature || null;
    const sessionMeta = {
      sourceTabId: tabId,
      extensionVersion: chrome.runtime.getManifest().version,
      autoPipeline: true,
      templateVersion,
      pageFingerprint,
      mode,
      reviewRequired: reviewState.reviewRequired,
      reviewCount: reviewState.reviewCount,
      reviewReasons: reviewState.reviewReasons,
    };
    const sessionRes = await api.workerApiRequest('POST', '/api/application-sessions', {
      candidateId,
      jobId: applyCheck.jobId || options.existingJobId || null,
      jobUrl,
      jobTitle,
      company,
      jobDescription,
      platform: detectPlatformFromUrl(jobUrl),
      templateVersion,
      pageFingerprint,
      mode,
      currentStep: 'scan',
      metadata: sessionMeta,
    });
    if (!sessionRes.success || !sessionRes.session) {
      throw new Error(sessionRes.message || 'Could not create application session.');
    }

    const applicationId = sessionRes.session.applicationId;
    const taskId = sessionRes.session?.metadata?.publicTaskId
      || sessionRes.session?.metadata?.taskId
      || sessionRes.taskId
      || null;

    const fillableFields = classifiedFields.filter(
      (field) => field.category !== 'ai_generation'
        && field.category !== 'document_upload'
        && field.fillValue
        && field.fillStatus === 'filled'
        && !earlyProfileIds.has(field.stableFieldId)
    );

    if (fillableFields.length) {
      lastProgress(tabId, `Filling ${fillableFields.length} additional profile field(s)…`);
      const fillResponse = await deps.fillApplicationFormOnTab(tabId, fillableFields, {
        mode,
        allowUserApprovedFill: true,
      });
      const fillResults = fillResponse?.fill?.results || [];
      const fillResultById = new Map(fillResults.map((item) => [item.stableFieldId, item]));

      classifiedFields = classifiedFields.map((field) => {
        if (field.category === 'ai_generation' || field.category === 'document_upload') return field;
        const outcome = fillResultById.get(field.stableFieldId);
        if (!outcome) return field;
        if (outcome.ok) return { ...field, fillStatus: 'filled' };
        return { ...field, fillStatus: 'error' };
      });
    }

    lastProgress(tabId, 'Staging form fields for GPT…');
    const patchRes = await api.workerApiRequest('PATCH', `/api/application-sessions/${applicationId}/fields`, {
      fields: classifiedFields,
      currentStep: scanMeta.pageStep || 'scan',
      discoveredPages: (discovery.pages || [{
        pageUrl: scanMeta.pageUrl || jobUrl,
        pageTitle: scanMeta.pageTitle || '',
        pageStep: scanMeta.pageStep || '',
        scannedAt: scanMeta.scannedAt || new Date().toISOString(),
        fieldCount: classifiedFields.length,
        flowType: discovery.flowType,
      }]).map((page) => ({
        ...page,
        flowType: discovery.flowType,
      })),
      templateVersion: discovery.templateVersion || 'legacy-v1',
      pageFingerprint: discovery.pageSignature || scanMeta.pageSignature || null,
      mode,
      status: 'awaiting_ai',
      metadata: {
        reviewRequired: reviewState.reviewRequired,
        reviewCount: reviewState.reviewCount,
        reviewReasons: reviewState.reviewReasons,
      },
    });
    if (!patchRes.success) {
      throw new Error(patchRes.message || 'Could not save application fields.');
    }

    if (willUseCustomGpt && taskId) {
      lastProgress(tabId, 'Switching to Custom GPT to generate resume…');

      await deps.preloadCustomGptTab?.().catch?.(() => {});

      await global.__qtsApplySessionStore?.setActive?.({
        applicationId,
        taskId,
        jobTabId: tabId,
        jobUrl,
        candidateId,
        status: 'awaiting_ai',
      });

      const dispatchRes = await api.workerApiRequest(
        'POST',
        `/api/application-tasks/${encodeURIComponent(taskId)}/dispatch`
      );
      if (!dispatchRes.success) {
        throw new Error(dispatchRes.message || 'Could not register GPT task on server.');
      }

      await deps.releaseUiForGptHandoff?.({ jobTabId: tabId });
      const sendResult = await deps.executeSendGptTask({
        taskId,
        jobTabId: tabId,
        applicationId,
        pollAndApply: true,
      });
      if (!sendResult?.handoff?.sent) {
        throw new Error(sendResult?.handoff?.error || sendResult?.error || 'GPT handoff failed.');
      }

      lastProgress(tabId, 'Custom GPT running — auto-clicking Allow…');
      return {
        ok: true,
        applicationId,
        taskId,
        candidateId,
        gptWatchStarted: Boolean(sendResult.gptWatchStarted),
        fieldCount: classifiedFields.length,
      };
    }

    lastProgress(tabId, `Application ready — ${fillableFields.length} field(s) filled.`, 'success');
    await global.__qtsApplySessionStore?.setActive?.({
      applicationId,
      taskId,
      jobTabId: tabId,
      jobUrl,
      candidateId,
      status: 'ready',
    });
    return {
      ok: true,
      applicationId,
      taskId,
      candidateId,
      gptWatchStarted: false,
      fieldCount: classifiedFields.length,
    };
  }

  function lastProgress(tabId, message, type = 'info') {
    if (!tabId || !message) return;
    deps?.showPageDetectAlert?.(tabId, message, type).catch?.(() => {});
    chrome.runtime.sendMessage({
      type: 'AUTO_PIPELINE_STATUS',
      tabId,
      message,
      statusType: type,
    }).catch(() => {});
  }

  global.__qtsAutoApplicationPipeline = {
    registerDeps,
    detectPlatformFromUrl,
    needsCustomGptHandoff,
    normalizePipelineUrl,
    readDefaultCandidateId,
    resolveDefaultCandidateId,
    isDefaultCandidateAlreadyApplied,
    isAutoApplyEnabled,
    isExtensionOperational,
    setAutoApplyEnabled,
    runAutoApplicationPipeline,
  };
})(typeof self !== 'undefined' ? self : globalThis);
