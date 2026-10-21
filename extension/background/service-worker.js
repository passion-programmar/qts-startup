// Background service worker — tab tracking, capture window, messages

importScripts(
  '../shared/page-exclusions.js',
  '../shared/runtime-config.js',
  '../shared/application-flow.js',
  '../shared/job-detect.js',
  '../shared/api-prefetch.js',
  '../shared/custom-gpt.js',
  '../shared/scanner-chatgpt.js',
  '../shared/account-auth-storage.js',
  '../shared/apply-session-store.js',
  '../shared/api-worker.js',
  '../shared/gpt-worker-handoff.js',
  '../shared/field-classifier.js',
  '../shared/candidate-matcher.js',
  '../shared/fill-policy.js',
  '../shared/auto-application-pipeline.js',
  '../shared/chatgpt-composer-handoff.js'
);

function isExtractablePageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (self.__qtsPageExclusions.shouldSkipPage(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function restrictedPageMessage(url) {
  if (!url) return 'No page URL available. Open a job listing tab first.';
  try {
    const protocol = new URL(url).protocol.replace(':', '');
    if (protocol === 'chrome' || protocol === 'chrome-extension' || protocol === 'edge' || protocol === 'about') {
      return 'Auto-extract works on web pages (http/https). Open a job listing tab, then click Refresh.';
    }
  } catch {
    // fall through
  }
  return 'This page cannot be auto-scraped. Open a job listing in your browser, or enter details manually.';
}

const capturePanelOpenPromisesByTab = new Map();
const EXTENSION_STATUS_KEY = 'qtsExtensionStatus';
const GET_JD_RESULTS_KEY = 'qtsGetJdResults';
const MAX_GET_JD_PROFILE_SELECTION = 100;
const getJdInFlightTabs = new Set();
const getJdLastPageByTab = new Map();
let lastSourceTabId = null;
const lastAutoDetectKeyByTab = new Map();
const CAPTURE_PANEL_FILE = 'content/capture-panel.js';
const detectGenerationByTab = new Map();
const GLOBAL_TEXT_HIGHLIGHT_REFRESH_TTL_MS = 60_000;
let globalTextHighlightRefreshPromise = null;

async function refreshGlobalTextHighlights() {
  if (globalTextHighlightRefreshPromise) return globalTextHighlightRefreshPromise;
  globalTextHighlightRefreshPromise = fetchGlobalTextHighlights();
  try {
    return await globalTextHighlightRefreshPromise;
  } finally {
    globalTextHighlightRefreshPromise = null;
  }
}

async function fetchGlobalTextHighlights() {
  const highlighting = self.__qtsTextHighlighting;
  if (!highlighting) return { success: false, message: 'Text highlight helper is unavailable.' };

  const storageKey = highlighting.getGlobalStorageKey();
  const timestampKey = highlighting.getGlobalStorageTimestampKey();
  const stored = await chrome.storage.local.get([storageKey, timestampKey]);
  const cachedRules = highlighting.normalizeRules(stored[storageKey] || []);
  const cachedAt = Number(stored[timestampKey] || 0);
  const cacheAge = Date.now() - cachedAt;
  if (cachedAt > 0 && cacheAge >= 0 && cacheAge < GLOBAL_TEXT_HIGHLIGHT_REFRESH_TTL_MS) {
    return { success: true, rules: cachedRules, cached: true };
  }

  const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
  if (!token) {
    return cachedRules.length
      ? { success: true, rules: cachedRules, cached: true }
      : { success: false, message: 'Sign in as a Manager to load shared text highlights.' };
  }

  const result = await workerApiRequest('GET', '/api/v2/extension-features/highlights');
  if (!result.success || !Array.isArray(result.rules)) {
    if (cachedRules.length) {
      console.warn('[QTS text highlights] Could not refresh shared rules; using the last saved copy:', result.message);
      return { success: true, rules: cachedRules, cached: true, stale: true };
    }
    return { success: false, message: result.message || 'Could not load shared text highlights.' };
  }
  const rules = highlighting.normalizeRules(result.rules);
  await chrome.storage.local.set({
    [storageKey]: rules,
    [timestampKey]: Date.now(),
  });
  return { success: true, rules, cached: false };
}

async function verifyManagerScannerAccess() {
  const result = await workerApiRequest('GET', '/api/v2/extension-features/me');
  return result.success && result.features?.canUseScanner === true
    ? { allowed: true }
    : {
      allowed: false,
      message: result.message || 'Super must assign job-site Scanner access to this Manager account.',
    };
}

async function verifyManagerApplyAccess() {
  const result = await workerApiRequest('GET', '/api/v2/extension-features/me');
  return result.success && result.features?.canUseApply === true
    ? { allowed: true }
    : {
      allowed: false,
      message: result.message || 'Apply is available only to a signed-in Manager.',
    };
}

const EXTRACTOR_FILES = [
  'content/extractors/generic.js',
  'content/extractors/linkedin.js',
  'content/extractors/indeed.js',
  'content/extractors/glassdoor.js',
  'content/extractors/ats.js',
  'content/extractor-manager.js',
];
const DETECT_TOAST_FILE = 'content/detect-toast.js';
const FORM_SCAN_FILE = 'content/form-scan.js';
const TEMPLATE_REGISTRY_FILE = 'content/platforms/templates/template-registry.js';
const JUSTJOIN_EASY_APPLY_FILE = 'content/platforms/templates/justjoin-easy-apply.js';
const JUSTJOIN_EXTERNAL_APPLY_FILE = 'content/platforms/templates/justjoin-external-apply.js';
const JUSTJOIN_APPLY_FILE = 'content/platforms/justjoin-apply.js';
const APPLICATION_DISCOVERY_FILE = 'content/application-discovery.js';
const APPLY_TEMPLATE_DETECTOR_FILE = 'content/apply-template-detector.js';
const APPLY_MODAL_WATCH_FILE = 'content/apply-modal-watch.js';
const APPLICATION_FLOW_FILE = 'shared/application-flow.js';
const LEARNING_RECORDER_FILE = 'content/learning-recorder.js';
const FORM_SCAN_SCRIPT_FILES = [
  APPLICATION_FLOW_FILE,
  FORM_SCAN_FILE,
  LEARNING_RECORDER_FILE,
  TEMPLATE_REGISTRY_FILE,
  JUSTJOIN_EASY_APPLY_FILE,
  JUSTJOIN_EXTERNAL_APPLY_FILE,
  JUSTJOIN_APPLY_FILE,
  APPLICATION_DISCOVERY_FILE,
  APPLY_TEMPLATE_DETECTOR_FILE,
];
const APPLY_MODAL_WATCH_FILE_LIST = [APPLY_MODAL_WATCH_FILE];
const GPT_TAB_STORAGE_KEY = 'qtsCustomGptTabId';
const JOB_SOURCE_TAB_STORAGE_KEY = 'qtsJobSourceTabId';
const PENDING_GPT_DISPATCH_KEY = 'qtsPendingGptDispatch';
const APPLY_TEMPLATE_TAB_KEY = 'qtsApplyTemplateByTab';
const DISCOVERY_CHECKPOINT_TAB_KEY = 'qtsDiscoveryCheckpointByTab';
let lastApplyMethodDetectKeyByTab = new Map();
let gptApprovalWatchTimer = null;
let gptPollApplyJob = null;
let gptDispatchInFlight = false;
let gptPrewarmPromise = null;
let gptPageWatchJob = null;
const autoPipelineInFlight = new Set();
const lastAutoPipelineKeyByTab = new Map();
const AUTO_PIPELINE_DELAY_MS = 1200;
let autoPipelineDepsReady = false;

function ensureAutoPipelineDeps() {
  if (autoPipelineDepsReady) return;
  self.__qtsAutoApplicationPipeline?.registerDeps?.({
    getTab,
    setJobSourceTab: async (tabId) => {
      lastSourceTabId = tabId;
      await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: tabId });
    },
    discoverApplicationFormOnTab,
    fillApplicationFormOnTab,
    detectApplyTemplateOnTab,
    executeSendGptTask,
    preloadCustomGptTab,
    releaseUiForGptHandoff,
    showPageDetectAlert,
  });
  autoPipelineDepsReady = true;
}

function stopGptPollAndApply() {
  gptPollApplyJob = null;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HUMAN_REVIEW_SAVED_KEYS = new Set([
  'terms_accepted',
  'gdpr_consent',
  'marketing_opt_in',
  'cover_message',
]);

async function applyGptPackageToJobTab(applicationId, jobTabId) {
  let tabId = jobTabId;
  if (!tabId) {
    const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
    tabId = stored[JOB_SOURCE_TAB_STORAGE_KEY] || lastSourceTabId;
  }
  if (!tabId) {
    throw new Error('No job tab found for GPT apply.');
  }
  const tab = await getTab(tabId);
  if (!tab?.id) {
    throw new Error('No job tab found for GPT apply.');
  }

  const api = self.__qtsApiWorker;
  if (!api?.workerApiRequest) {
    throw new Error('API worker helpers not loaded.');
  }

  await self.__qtsApplySessionStore?.setActive?.({
    applicationId,
    jobTabId,
    status: 'apply',
    applying: true,
  });

  const result = await api.workerApiRequest('GET', `/api/application-sessions/${applicationId}/result`);
  if (!result.success) {
    throw new Error(result.message || 'Could not load application result.');
  }

  const fillFields = (result.fields || [])
    .filter((field) => field.category === 'ai_generation' && field.generatedAnswer)
    .map((field) => ({
      ...field,
      fillValue: field.generatedAnswer,
      fillStatus: 'filled',
    }));

  const remainingFields = (result.fields || [])
    .filter((field) => field.fieldType !== 'file'
      && field.category !== 'ai_generation'
      && field.category !== 'candidate_profile'
      && !HUMAN_REVIEW_SAVED_KEYS.has(field.savedAnswerKey)
      && field.generatedAnswer
      && field.fillStatus !== 'filled')
    .map((field) => ({
      ...field,
      fillValue: field.generatedAnswer,
      fillStatus: 'filled',
    }));

  const fileUploadFields = await api.workerBuildFileUploadFields(applicationId, result.fields || []);

  const detectedTemplate = await getApplyTemplateForTab(tabId);
  const fillPolicy = self.__qtsFillPolicy?.getFillPolicyForTemplate?.(detectedTemplate?.templateId);
  let payload = [...fillFields, ...remainingFields, ...fileUploadFields];
  if (fillPolicy?.gptApplyDocumentsOnly) {
    payload = fileUploadFields;
  }

  if (!payload.length) {
    throw new Error('No GPT answers or documents found on server yet.');
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
    lastSourceTabId = tabId;
  } catch {
    // continue with stored tab id
  }

  await scanApplicationFormOnTab(tabId, { openApplyForm: true });
  const fillResponse = await fillApplicationFormOnTab(tabId, payload);
  if (fillResponse?.error) {
    throw new Error(fillResponse.error);
  }

  const uploadedCount = fillResponse?.fill?.results?.filter(
    (item) => item.ok && fileUploadFields.some((field) => field.stableFieldId === item.stableFieldId)
  ).length || 0;
  const filledCount = fillResponse?.fill?.results?.filter((item) => item.ok)?.length || 0;
  const uploadNote = uploadedCount ? ` Uploaded ${uploadedCount} PDF(s).` : '';

  await showPageDetectAlert(
    tabId,
    fillPolicy?.gptApplyDocumentsOnly
      ? `Resume uploaded from Custom GPT.${uploadNote} Review name, email & CV before submit.`
      : `GPT package applied (${filledCount} field(s)).${uploadNote} Review before submit.`,
    uploadedCount ? 'success' : 'warn'
  );

  return { fillResponse, filledCount, uploadedCount, tabId };
}

async function pollAndApplyGptTask({ taskId, applicationId, jobTabId, timeoutMs = 180000, intervalMs = 3000 }) {
  const api = self.__qtsApiWorker;
  const appId = Number(applicationId) || api?.workerParseApplicationId?.(taskId);
  if (!taskId || !appId) {
    throw new Error('Invalid GPT task for apply pipeline.');
  }

  stopGptPollAndApply();
  const job = { taskId, applicationId: appId, jobTabId, cancelled: false };
  gptPollApplyJob = job;

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (gptPollApplyJob !== job || job.cancelled) {
      throw new Error('GPT apply pipeline cancelled.');
    }

    const status = await api.workerApiRequest('GET', `/api/application-tasks/${encodeURIComponent(taskId)}/status`);
    if (!status.success) {
      throw new Error(status.message || 'Could not read GPT task status.');
    }
    if (status.gptTaskStatus === 'ready' || status.readyToApply) {
      const applied = await applyGptPackageToJobTab(appId, jobTabId);
      chrome.runtime.sendMessage({
        type: 'GPT_APPLY_FINISHED',
        success: true,
        taskId,
        applicationId: appId,
        ...applied,
      }).catch(() => {});
      if (gptPollApplyJob === job) gptPollApplyJob = null;
      return applied;
    }
    if (status.gptTaskStatus === 'error') {
      throw new Error(status.error || 'GPT task failed on server.');
    }
    await sleep(intervalMs);
  }

  if (gptPollApplyJob === job) gptPollApplyJob = null;
  throw new Error('Timed out waiting for Custom GPT. Click Allow in the GPT tab, then use Apply GPT package.');
}

function startGptPollAndApply(options) {
  pollAndApplyGptTask(options).catch((e) => {
    chrome.runtime.sendMessage({
      type: 'GPT_APPLY_FINISHED',
      success: false,
      taskId: options?.taskId,
      applicationId: options?.applicationId,
      error: e?.message || String(e),
    }).catch(() => {});
    const tabId = options?.jobTabId || lastSourceTabId;
    if (tabId) {
      showPageDetectAlert(tabId, e?.message || 'GPT apply failed.', 'fail').catch(() => {});
    }
  });
}
const JOB_PANEL_WATCH_FILE = 'content/job-panel-watch.js';
const LINKEDIN_PANEL_WATCH_FILE = 'content/linkedin-panel-watch.js';
const AUTO_DETECT_DELAY_MS = 100;
const injectedExtractorTabs = new Set();
const extractorInjectInFlight = new Map();

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function canInjectIntoTab(tab) {
  if (!tab?.id || !tab.url) return false;
  if (!isExtractablePageUrl(tab.url)) return false;
  if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) return false;
  return tab.status === 'complete' || tab.status === 'loading';
}

async function injectExtractors(tabId) {
  const tab = await getTab(tabId);
  if (!(await canInjectIntoTab(tab))) return false;
  if (injectedExtractorTabs.has(tabId)) return true;

  const inFlight = extractorInjectInFlight.get(tabId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const [{ result: hasExtractors }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => typeof window.__extractJobData === 'function',
      });
      if (hasExtractors) {
        injectedExtractorTabs.add(tabId);
        return true;
      }

      await chrome.scripting.executeScript({ target: { tabId }, files: EXTRACTOR_FILES });
      injectedExtractorTabs.add(tabId);
      return true;
    } catch (err) {
      console.warn('[QTS_Startup] Skipped injection on', tab?.url, err?.message || err);
      return false;
    } finally {
      extractorInjectInFlight.delete(tabId);
    }
  })();

  extractorInjectInFlight.set(tabId, promise);
  return promise;
}

async function injectJobPanelWatch(tabId, pageUrl) {
  const url = pageUrl || (await getTab(tabId))?.url || '';
  const watchFile = url.includes('linkedin.com')
    ? LINKEDIN_PANEL_WATCH_FILE
    : JOB_PANEL_WATCH_FILE;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [watchFile] });
    return true;
  } catch {
    return false;
  }
}

async function extractJobFromTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.id) {
    return { error: 'No active tab', tab: null };
  }
  if (!isExtractablePageUrl(tab.url)) {
    return { error: restrictedPageMessage(tab.url), tab, manualOnly: true };
  }

  try {
    const injected = await injectExtractors(tab.id);
    if (!injected) {
      return {
        error: 'Could not access this page for extraction.',
        tab,
        manualOnly: true,
      };
    }
    let data = null;
    for (const delay of [0, 300, 600, 900, 1200]) {
      if (delay) await sleep(delay);
      const currentTab = await getTab(tab.id);
      if (!currentTab?.id || currentTab.url !== tab.url) {
        return { error: 'The page changed while job details were being extracted.', tab: currentTab || tab };
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (window.__extractJobData ? window.__extractJobData() : null),
      });
      data = mergeJobExtractionSamples(data, results[0]?.result, tab.url);
      if (isValidDetectedJob(data, tab.url)) break;
    }
    return {
      data,
      url: tab.url,
      title: tab.title,
      tab,
    };
  } catch (e) {
    return {
      error: e.message || 'Extraction failed.',
      tab,
      manualOnly: true,
    };
  }
}

async function saveGetJdResult(tabId, result, notifyPage = true) {
  const stored = await chrome.storage.local.get([GET_JD_RESULTS_KEY]);
  const results = stored[GET_JD_RESULTS_KEY] || {};
  const tabKey = String(tabId);
  delete results[tabKey];
  results[tabKey] = result;
  const keys = Object.keys(results);
  for (const oldKey of keys.slice(0, Math.max(0, keys.length - 5))) {
    delete results[oldKey];
  }
  await chrome.storage.local.set({ [GET_JD_RESULTS_KEY]: results });
  if (notifyPage) {
    chrome.tabs.sendMessage(tabId, {
      type: 'QTS_GET_JD_RESULT_UPDATED',
      result,
    }).catch(() => {});
  }
}

async function readGetJdResultForTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.url) return null;
  const stored = await chrome.storage.local.get([GET_JD_RESULTS_KEY]);
  const result = stored[GET_JD_RESULTS_KEY]?.[String(tabId)];
  return result?.pageUrl === tab.url ? result : null;
}

async function updateGetJdSelection(tabId, profileIds) {
  if (
    !Array.isArray(profileIds) ||
    profileIds.length > MAX_GET_JD_PROFILE_SELECTION ||
    !profileIds.every((id) => typeof id === 'string') ||
    new Set(profileIds).size !== profileIds.length
  ) {
    return { ok: false, error: 'The selected candidate list is invalid.' };
  }
  const result = await readGetJdResultForTab(tabId);
  if (
    !result ||
    result.status !== 'complete' ||
    result.classification?.isJobPage !== true
  ) {
    return { ok: false, error: 'The current job review is no longer available.' };
  }
  const allowedIds = new Set(
    (result.profiles || [])
      .filter((profile) => profile.available !== false)
      .map((profile) => profile.id),
  );
  if (profileIds.some((id) => !allowedIds.has(id))) {
    return { ok: false, error: 'One or more selected candidates are unavailable.' };
  }
  const updated = {
    ...result,
    selectedProfileIds: profileIds,
    updatedAt: Date.now(),
  };
  await saveGetJdResult(tabId, updated, false);
  return { ok: true };
}

async function cancelGetJdReview(tabId) {
  const result = await readGetJdResultForTab(tabId);
  if (!result || result.status !== 'complete') {
    return { ok: false, error: 'The current job review is no longer available.' };
  }
  await saveGetJdResult(tabId, {
    ...result,
    status: 'cancelled',
    reviewDismissed: true,
    message: 'Cancelled. No Job List rows were saved.',
    updatedAt: Date.now(),
  });
  return { ok: true };
}

async function saveGetJdSelection(tabId, profileIds) {
  const selection = await updateGetJdSelection(tabId, profileIds);
  if (!selection.ok) return selection;
  if (!profileIds.length) {
    return { ok: false, error: 'Select at least one candidate before saving.' };
  }
  const result = await readGetJdResultForTab(tabId);
  const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
  if (!token) {
    return { ok: false, error: 'Your extension session has expired. Sign in again.' };
  }
  const response = await workerApiRequest(
    'POST',
    '/api/extension/get-jd/save',
    {
      job: result.classification.job,
      profileIds,
    },
  );
  if (response.success !== true) {
    return {
      ok: false,
      error: response.message || 'Could not save selected candidates.',
    };
  }
  const savedCount = Number(response.savedCount || 0);
  const failedCount = Number(response.failedCount || 0);
  const duplicateCount = Number(response.duplicateCount || 0);
  if (failedCount > 0 || duplicateCount > 0 || savedCount !== profileIds.length) {
    const message = failedCount > 0
      ? 'Some candidates could not be saved. Please review and retry.'
      : 'Some selected candidates already have this job. Only new records were saved.';
    const responseByProfile = new Map(
      (response.results || []).map((profileResult) => [profileResult.profileId, profileResult]),
    );
    await saveGetJdResult(tabId, {
      ...result,
      status: 'complete',
      saveError: message,
      saveResponse: response,
      profiles: (result.profiles || []).map((profile) => {
        const profileResult = responseByProfile.get(profile.id);
        return profileResult && profileResult.status !== 'failed'
          ? { ...profile, available: false, saveResult: profileResult }
          : { ...profile, saveResult: profileResult || null };
      }),
      selectedProfileIds: (response.results || [])
        .filter((profileResult) => profileResult.status === 'failed')
        .map((profileResult) => profileResult.profileId),
      updatedAt: Date.now(),
    });
    return { ok: false, error: message };
  }
  await saveGetJdResult(tabId, {
    ...result,
    status: 'saved',
    saveError: null,
    message: 'Job List save finished.',
    saveResponse: response,
    updatedAt: Date.now(),
  });
  return { ok: true };
}

async function processGetJdPage(tabId, url, documentId = '') {
  if (!isExtractablePageUrl(url) || isChatGptHostUrl(url)) return;
  if (getJdInFlightTabs.has(tabId)) return;

  if (!(await isGetJdActive())) return;

  const pageKey = `${documentId}:${url}`;
  if (getJdLastPageByTab.get(tabId) === pageKey) return;
  getJdLastPageByTab.set(tabId, pageKey);
  getJdInFlightTabs.add(tabId);

  const initialResult = {
    tabId,
    pageUrl: url,
    runId: `${Date.now()}:${documentId}`,
    pageTitle: '',
    status: 'processing',
    message: 'Reading this page and checking Jobs and Bids…',
    updatedAt: Date.now(),
    classification: null,
  };
  try {
    await saveGetJdResult(tabId, initialResult);
    const tab = await getTab(tabId);
    if (!tab?.id || tab.url !== url) return;
    const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
    if (!token) {
      await saveGetJdResult(tabId, {
        ...initialResult,
        status: 'error',
        message: 'Your extension session has expired. Sign in again.',
        updatedAt: Date.now(),
      });
      return;
    }

    const extraction = await extractJobFromTab(tabId);
    if (!(await isGetJdActive())) return;
    if (extraction.error) {
      await saveGetJdResult(tabId, {
        ...initialResult,
        pageTitle: extraction.title || tab.title || '',
        status: 'error',
        message: extraction.error,
        updatedAt: Date.now(),
      });
      return;
    }

    if (!(await isGetJdActive())) return;
    const pageUrl = extraction.url || url;
    const extractedJobDetails = normalizeDetectedJobData(extraction.data, pageUrl);
    const result = await workerApiRequest('POST', '/api/extension/get-jd/check', {
      job: {
        jobUrl: extractedJobDetails.url,
        jobTitle: extractedJobDetails.title,
        company: extractedJobDetails.company,
      },
    });
    if (result.success !== true) {
      throw new Error(result.message || 'Get JD duplicate check failed.');
    }
    if (!(await isGetJdActive())) return;

    const profiles = Array.isArray(result.profiles)
      ? result.profiles.filter((profile) => profile && typeof profile.id === 'string')
      : [];
    const availableProfiles = profiles.filter((profile) => profile.available !== false);
    if (result.exists === true || result.allCandidatesAssigned === true || availableProfiles.length === 0) {
      await saveGetJdResult(tabId, {
        ...initialResult,
        pageTitle: extraction.title || tab.title || '',
        status: 'duplicate',
        message: result.message || 'This job already exists.',
        toastKind: result.toastKind,
        toastMessage: result.toastMessage,
        inJobs: result.inJobs === true,
        inBids: result.inBids === true,
        updatedAt: Date.now(),
      });
      return;
    }
    const currentTab = await getTab(tabId);
    if (!currentTab?.url || currentTab.url !== url || !(await isGetJdActive())) return;

    await saveGetJdResult(tabId, {
      ...initialResult,
      pageTitle: extraction.title || tab.title || '',
      status: 'complete',
      message: result.message || 'Select candidates to save this job.',
      hasDuplicates: result.exists === true,
      toastKind: result.toastKind,
      toastMessage: result.toastMessage,
      updatedAt: Date.now(),
      classification: {
        isJobPage: true,
        isRemote: /\bremote\b/i.test(
          `${extractedJobDetails.workplaceType} ${extractedJobDetails.location}`,
        ),
        matchingProfileIds: [],
        job: {
          title: extractedJobDetails.title,
          company: extractedJobDetails.company,
          location: extractedJobDetails.location,
          country: extractedJobDetails.country,
          employmentType: extractedJobDetails.employmentType,
          workplaceType: extractedJobDetails.workplaceType,
          salary: extractedJobDetails.salary,
          jobUrl: extractedJobDetails.url,
        },
      },
      profiles,
      selectedProfileIds: [],
      jobDescription: extractedJobDetails.description,
    });
  } catch (error) {
    if (!(await isGetJdActive())) return;
    console.error('[QTS Get JD] Page duplicate check failed:', error);
    await saveGetJdResult(tabId, {
      ...initialResult,
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not classify this page.',
      updatedAt: Date.now(),
    });
  } finally {
    getJdInFlightTabs.delete(tabId);
    const currentTab = await getTab(tabId).catch(() => null);
    if (
      currentTab?.url &&
      currentTab.url !== url &&
      await isGetJdActive()
    ) {
      processGetJdPage(tabId, currentTab.url).catch((error) => {
        console.error('[QTS Get JD] Could not process the next page:', error);
      });
    }
  }
}

async function enableGetJdForTab(tabId) {
  getJdLastPageByTab.clear();
  const tab = tabId ? await getTab(tabId) : (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  }))[0];
  if (tab?.id && tab.url) {
    if (!isExtractablePageUrl(tab.url)) {
      await saveGetJdResult(tab.id, {
        tabId: tab.id,
        pageUrl: tab.url,
        pageTitle: tab.title || '',
        status: 'error',
        message: 'Get JD can read web pages only. Open an http:// or https:// page.',
        updatedAt: Date.now(),
        classification: null,
      });
      return;
    }
    await processGetJdPage(tab.id, tab.url, `manual:${Date.now()}`);
  }
}

async function isGetJdActive() {
  const stored = await chrome.storage.local.get([EXTENSION_STATUS_KEY]);
  return stored[EXTENSION_STATUS_KEY] === 'get_jd';
}

async function verifyFormScanScripts(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        applicationFlow: typeof window.__qtsApplicationFlow?.getNavigationBoundaryReason === 'function',
        scan: typeof window.__scanApplicationForm === 'function',
        shadowDom: typeof window.__qtsQueryAllOpenShadowRoots === 'function',
        discover: typeof window.__discoverApplicationForm === 'function',
        registry: typeof window.__qtsTemplateRegistry === 'object',
        justjoin: typeof window.__qtsPlatformJustjoin === 'object',
        learning: typeof window.__qtsLearningRecorder === 'object',
      }),
    });
    return results[0]?.result || {};
  } catch {
    return {};
  }
}

async function ensureFormScanScripts(tabId) {
  const tab = await getTab(tabId);
  if (!(await canInjectIntoTab(tab))) {
    return { ok: false, reason: 'cannot_inject', status: {} };
  }

  let status = await verifyFormScanScripts(tabId);
  if (status.applicationFlow && status.discover && status.scan && status.shadowDom) {
    return { ok: true, status };
  }

  for (const file of FORM_SCAN_SCRIPT_FILES) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (e) {
      console.warn('[QTS] inject failed:', file, e?.message || e);
    }
  }

  status = await verifyFormScanScripts(tabId);
  return {
    ok: Boolean(status.applicationFlow && status.discover && status.scan && status.shadowDom && status.learning),
    status,
  };
}

async function injectFormScan(tabId) {
  const result = await ensureFormScanScripts(tabId);
  return result.ok;
}

function isTemplateCandidateUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (/justjoin\.it\/job-offer\//i.test(url)) return true;
  return false;
}

async function readApplyTemplateMap() {
  const stored = await chrome.storage.session.get([APPLY_TEMPLATE_TAB_KEY]);
  return stored[APPLY_TEMPLATE_TAB_KEY] || {};
}

async function setApplyTemplateForTab(tabId, detection) {
  const map = await readApplyTemplateMap();
  map[String(tabId)] = detection;
  await chrome.storage.session.set({ [APPLY_TEMPLATE_TAB_KEY]: map });
}

async function getApplyTemplateForTab(tabId) {
  const map = await readApplyTemplateMap();
  return map[String(tabId)] || null;
}

async function readDiscoveryCheckpointMap() {
  const stored = await chrome.storage.session.get([DISCOVERY_CHECKPOINT_TAB_KEY]);
  return stored[DISCOVERY_CHECKPOINT_TAB_KEY] || {};
}

async function removeDiscoveryCheckpointForTab(tabId) {
  const checkpointMap = await readDiscoveryCheckpointMap();
  delete checkpointMap[String(tabId)];
  await chrome.storage.session.set({ [DISCOVERY_CHECKPOINT_TAB_KEY]: checkpointMap });
}

async function persistDiscoveryCheckpoint(tabId, discovery, reusableTemplate = null) {
  const appFlow = self.__qtsApplicationFlow;
  if (typeof appFlow?.buildDiscoveryCheckpoint !== 'function') {
    return { success: false, message: 'Discovery checkpoint helper is unavailable.' };
  }

  const checkpointMap = await readDiscoveryCheckpointMap();
  const current = checkpointMap[String(tabId)];
  const reusableCheckpoint = reusableTemplate?.navigation?.discoveryCheckpoint;
  const previous = current?.siteKey === discovery.siteKey
    ? current
    : (reusableCheckpoint?.siteKey === discovery.siteKey ? reusableCheckpoint : {});
  const checkpoint = appFlow.buildDiscoveryCheckpoint(discovery, previous);
  checkpointMap[String(tabId)] = checkpoint;
  await chrome.storage.session.set({ [DISCOVERY_CHECKPOINT_TAB_KEY]: checkpointMap });

  const fields = checkpoint.steps.flatMap((step) => step.fields.map((field) => ({
    ...field,
    fieldId: `${step.stepId}:${field.fieldId}`.slice(0, 255),
  }))).slice(0, 300);
  const coverage = {
    visibleFields: fields.length,
    matchedFields: fields.filter((field) => field.status === 'matched').length,
    unresolvedFields: fields.filter((field) => field.status !== 'matched').length,
  };
  const payload = {
    siteKey: checkpoint.siteKey,
    platform: checkpoint.platform,
    host: checkpoint.host,
    templateVersion: 'discovery-v1',
    pageSignature: discovery.pageSignature || null,
    status: coverage.matchedFields > 0 ? 'partial' : 'draft',
    coverage,
    navigation: {
      discoveryCheckpoint: checkpoint,
      candidates: discovery.navigationCandidates || [],
    },
    verification: {},
    metadata: {
      schemaVersion: 1,
      source: 'extension-discovery',
      finalBoundaryFound: checkpoint.finalBoundaryFound,
    },
    fields,
  };
  const saved = await self.__qtsApiWorker.workerApiRequest(
    'POST',
    '/api/application-templates/from-discovery',
    payload
  );
  return {
    success: Boolean(saved?.success),
    message: saved?.success ? null : (saved?.message || 'Template draft was not persisted.'),
    template: saved?.template || null,
    checkpoint,
  };
}

async function removeApplyTemplateForTab(tabId) {
  const map = await readApplyTemplateMap();
  delete map[String(tabId)];
  await chrome.storage.session.set({ [APPLY_TEMPLATE_TAB_KEY]: map });
}

function notifyApplyTemplateDetected(tabId) {
  chrome.runtime.sendMessage({ type: 'APPLY_TEMPLATE_DETECTED', tabId }).catch(() => {});
}

async function injectApplyModalWatch(tabId, url) {
  if (!/justjoin\.it\/job-offer\//i.test(url || '')) return false;
  await injectFormScan(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: APPLY_MODAL_WATCH_FILE_LIST,
    });
    return true;
  } catch {
    return false;
  }
}

async function detectApplyTemplateOnTab(tabId, url) {
  const pageUrl = url || (await getTab(tabId))?.url;
  if (!pageUrl || !isTemplateCandidateUrl(pageUrl)) {
    await removeApplyTemplateForTab(tabId);
    return null;
  }

  const injected = await injectFormScan(tabId);
  if (!injected) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.__detectApplyTemplateOnPage
        ? window.__detectApplyTemplateOnPage()
        : null),
    });
    const detection = results[0]?.result;
    if (!detection) {
      await removeApplyTemplateForTab(tabId);
      return null;
    }
    if (!detection.templateId && !detection.applyMethod && !detection.platform) {
      await removeApplyTemplateForTab(tabId);
      return detection;
    }
    await setApplyTemplateForTab(tabId, detection);
    notifyApplyTemplateDetected(tabId);
    return detection;
  } catch {
    return null;
  }
}

async function runFormScanScript(tabId, func, args = []) {
  const tab = await getTab(tabId);
  if (!tab?.id) return { error: 'No active tab' };
  if (!isExtractablePageUrl(tab.url)) {
    return { error: restrictedPageMessage(tab.url), manualOnly: true };
  }
  const injected = await injectFormScan(tab.id);
  if (!injected) return { error: 'Could not access this page for form scanning.' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func,
      args,
    });
    return { success: true, result: results[0]?.result ?? null, url: tab.url, title: tab.title };
  } catch (e) {
    return { error: e.message || 'Form scan failed.' };
  }
}

async function waitForTabSettled(tabId, timeoutMs = 12000) {
  const tab = await getTab(tabId);
  if (!tab?.id) return;
  if (tab.status === 'complete') {
    await sleep(1500);
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 1500);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function scanApplicationFormOnTab(tabId, options = {}) {
  const openApplyForm = options.openApplyForm !== false;
  let applyFlow = null;

  let scanResult = await runFormScanScript(tabId, () => (
    window.__scanApplicationForm ? window.__scanApplicationForm() : null
  ));
  if (scanResult.error) return scanResult;

  let scan = scanResult.result;
  let hasForm = await runFormScanScript(
    tabId,
    (payload) => window.__looksLikeApplicationForm?.(payload),
    [scan]
  );
  let formDetected = Boolean(hasForm.result);

  if (openApplyForm && !formDetected) {
    const clickResult = await runFormScanScript(tabId, () => (
      window.__clickApplyToOpenForm ? window.__clickApplyToOpenForm() : { clicked: false, reason: 'unavailable' }
    ));
    if (clickResult.error) return clickResult;

    applyFlow = clickResult.result || { clicked: false, reason: 'unknown' };
    if (applyFlow.clicked) {
      await waitForTabSettled(tabId);
      for (let attempt = 0; attempt < 14; attempt += 1) {
        await sleep(500);
        scanResult = await runFormScanScript(tabId, () => (
          window.__scanApplicationForm ? window.__scanApplicationForm() : null
        ));
        if (scanResult.error) return scanResult;
        scan = scanResult.result;
        hasForm = await runFormScanScript(
          tabId,
          (payload) => window.__looksLikeApplicationForm?.(payload),
          [scan]
        );
        formDetected = Boolean(hasForm.result);
        if (formDetected) break;
      }
      applyFlow.formAppeared = formDetected;
      applyFlow.finalFieldCount = scan?.fields?.length || 0;
    }
  }

  return {
    success: true,
    scan,
    url: scanResult.url,
    title: scanResult.title,
    applyFlow,
    formDetected,
  };
}

function validateTemplateAgainstDiscovery(template, discovery) {
  const savedSteps = template?.navigation?.discoveryCheckpoint?.steps;
  const savedFields = Array.isArray(savedSteps)
    ? savedSteps.flatMap((step) => Array.isArray(step.fields) ? step.fields : [])
    : (Array.isArray(template?.fields) ? template.fields : []);
  const liveFields = Array.isArray(discovery?.fields) ? discovery.fields : [];
  const fieldResults = liveFields.map((field) => {
    const hints = field?.selectorHints || {};
    const question = String(field?.question || field?.label || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const match = savedFields.find((saved) => {
      if (String(saved?.fieldType || '') !== String(field?.fieldType || '')) return false;
      const savedHints = saved?.selectorHints || {};
      const exactSelector = ['id', 'name', 'data-testid'].some((key) =>
        hints[key] && savedHints[key] && String(hints[key]) === String(savedHints[key])
      );
      const savedQuestion = String(saved?.question || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return exactSelector || Boolean(question && savedQuestion === question);
    });
    return {
      fieldId: String(field?.stableFieldId || field?.fieldId || 'unknown-field'),
      matched: Boolean(match),
      method: match ? 'revalidated-structure' : 'generic-scan-fallback',
    };
  });
  return {
    templateVersion: template.templateVersion || null,
    templateStatus: template.status,
    genericScanUsed: true,
    matchedFieldCount: fieldResults.filter((field) => field.matched).length,
    fallbackFieldCount: fieldResults.filter((field) => !field.matched).length,
    requiresReview: true,
    fields: fieldResults,
  };
}

async function discoverApplicationFormOnTab(tabId, options = {}) {
  const tab = await getTab(tabId);
  if (!tab?.id) return { error: 'No active tab' };
  if (!isExtractablePageUrl(tab.url)) {
    return { error: restrictedPageMessage(tab.url), manualOnly: true };
  }

  const appFlow = self.__qtsApplicationFlow;
  const mode = appFlow?.normalizeApplicationMode?.(options.mode) || 'DISCOVERY';
  const navigationAction = appFlow?.classifyNavigationAction?.('continue', { mode });
  if (mode === 'REAL_APPLICATION' && options.readOnly === false && !options.allowUserApprovedAction) {
    return {
      success: false,
      blocked: true,
      error: 'Real application mode is read-only unless the user explicitly approves a page action.',
      recovery: appFlow?.buildRecoveryErrorPayload?.({
        sessionId: options.sessionId || `tab:${tabId}`,
        stepId: 'DISCOVERY',
        errorCode: 'REAL_APPLICATION_MODE_REQUIRES_APPROVAL',
        recoverable: true,
        attempts: 1,
        action: 'USER_REQUIRED',
        diagnostics: { mode, navigationAction },
      }),
    };
  }

  const preDetectedTemplate = options.preDetectedTemplate
    || await getApplyTemplateForTab(tab.id);
  const platform = appFlow?.detectPlatformFromUrl?.(tab.url) || 'generic';
  const host = new URL(tab.url).hostname.toLowerCase();
  const siteKey = `${platform}:${host}`;
  const templateLookup = await self.__qtsApiWorker.workerApiRequest(
    'GET',
    `/api/application-templates/reuse?siteKey=${encodeURIComponent(siteKey)}&host=${encodeURIComponent(host)}&platform=${encodeURIComponent(platform)}`
  );
  const reusableTemplate = templateLookup?.success && templateLookup.safeToReuse
    ? templateLookup.template
    : null;

  const scriptReady = await ensureFormScanScripts(tab.id);
  if (!scriptReady.ok) {
    return {
      error: 'Could not load form discovery scripts on this page.',
      debug: scriptReady.status,
    };
  }

  const discoveryOptions = {
    openApplyForm: options.openApplyForm,
    allowUserApprovedAction: options.allowUserApprovedAction === true,
    expandDynamic: options.expandDynamic,
    dynamicWaitMs: options.dynamicWaitMs,
    mode,
    preDetectedTemplate,
  };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => {
        const run = window.__runDiscoverApplicationForm || window.__discoverApplicationForm;
        if (!run) {
          return {
            __qtsDiscoveryError: 'Form discovery scripts are not available on this tab.',
            debug: {
              scan: !!window.__scanApplicationForm,
              discover: !!window.__discoverApplicationForm,
            },
          };
        }
        return run(opts);
      },
      args: [discoveryOptions],
    });
    const discovery = results[0]?.result;
    if (!discovery) {
      return { error: 'Form discovery returned no result. Reload the job tab and try again.' };
    }
    if (discovery.__qtsDiscoveryError) {
      return {
        error: discovery.__qtsDiscoveryError,
        warnings: discovery.warnings,
        debug: discovery.debug,
      };
    }
    discovery.siteKey = siteKey;
    discovery.host = host;
    discovery.platform = platform;
    discovery.templateVersion = reusableTemplate?.templateVersion || discovery.templateVersion || 'discovery-v1';
    const templateSave = mode === 'DISCOVERY'
      ? await persistDiscoveryCheckpoint(tab.id, discovery, reusableTemplate)
      : null;
    const templateValidation = reusableTemplate
      ? validateTemplateAgainstDiscovery(reusableTemplate, discovery)
      : null;
    return {
      success: true,
      discovery,
      scan: {
        pageUrl: discovery.scanMeta?.pageUrl || tab.url,
        pageTitle: discovery.scanMeta?.pageTitle || tab.title,
        pageStep: discovery.scanMeta?.pageStep || '',
        scannedAt: discovery.discoveredAt,
        fields: discovery.fields || [],
      },
      url: tab.url,
      title: tab.title,
      formDetected: discovery.formDetected,
      applyFlow: discovery.applyFlow,
      templateReuse: {
        found: Boolean(reusableTemplate),
        status: reusableTemplate?.status || null,
        genericScanUsed: true,
        validation: templateValidation,
      },
      templateSave,
      templateLookupError: templateLookup?.success || templateLookup?._httpStatus === 404
        ? null
        : (templateLookup?.message || 'Template lookup failed.'),
    };
  } catch (e) {
    return { error: e.message || 'Form discovery failed.' };
  }
}

async function captureApplicationStepOnTab(tabId, options = {}) {
  const tab = await getTab(tabId);
  if (!tab?.id) return { success: false, error: 'No active tab is available for Scanner verification.' };
  if (!isExtractablePageUrl(tab.url)) {
    return { success: false, error: restrictedPageMessage(tab.url), manualOnly: true };
  }
  const ready = await ensureFormScanScripts(tab.id);
  if (!ready.ok) return { success: false, error: 'Could not load Scanner verification scripts on this page.' };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async ({ maxWaitMs, intervalMs, minWaitMs }) => {
        const capture = () => window.__captureApplicationStep?.();
        const signature = (scan) => JSON.stringify((scan?.fields || []).map((field) => ({
          label: String(field.label || '').replace(/\s+/g, ' ').trim().toLowerCase(),
          type: field.fieldType,
          required: Boolean(field.required),
          options: (field.options || []).map((item) => String(item).replace(/\s+/g, ' ').trim().toLowerCase()),
          section: String(field.sectionHeading || '').replace(/\s+/g, ' ').trim().toLowerCase(),
          hints: {
            tag: field.selectorHints?.tag,
            name: field.selectorHints?.name,
            role: field.selectorHints?.role,
            testId: field.selectorHints?.testId,
            automationId: field.selectorHints?.automationId,
          },
          dom: {
            control: field.domEvidence?.control
              ? {
                tag: field.domEvidence.control.tag,
                role: field.domEvidence.control.role,
                testId: field.domEvidence.control.testId,
                automationId: field.domEvidence.control.automationId,
                classes: (field.domEvidence.control.classNames || []).filter((name) =>
                  name.length <= 48
                  && !/(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(name)
                  && !/^(?:css|sc|jss|emotion|jsx)-[a-z0-9_-]{6,}$/i.test(name)
                  && !/\d{5,}/.test(name)
                ).sort(),
              }
              : null,
            ancestors: (field.domEvidence?.ancestors || []).map((node) => ({
              tag: node.tag,
              role: node.role,
              testId: node.testId,
              automationId: node.automationId,
              classes: (node.classNames || []).filter((name) =>
                name.length <= 48
                && !/(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(name)
                && !/^(?:css|sc|jss|emotion|jsx)-[a-z0-9_-]{6,}$/i.test(name)
                && !/\d{5,}/.test(name)
              ).sort(),
            })),
          },
        })));
        const startedAt = Date.now();
        let previousSignature = '';
        let stablePasses = 0;
        let latest = null;
        while (Date.now() - startedAt <= maxWaitMs) {
          latest = capture();
          if (!latest) return { success: false, error: 'Scanner capture helper is unavailable on this page.' };
          const currentSignature = signature(latest);
          if (currentSignature === previousSignature) stablePasses += 1;
          else {
            previousSignature = currentSignature;
            stablePasses = 0;
          }
          if (Date.now() - startedAt >= minWaitMs && stablePasses >= 1) {
            return { success: true, scan: latest, settled: true };
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        return {
          success: false,
          error: 'The application step kept changing during Scanner verification. Wait for the page to settle, then scan again.',
          scan: latest,
        };
      },
      args: [{
        maxWaitMs: 2200,
        intervalMs: 250,
        minWaitMs: 500,
      }],
    });
    const result = results[0]?.result;
    if (!result?.success) {
      return { success: false, error: result?.error || 'Scanner could not verify the current application step.' };
    }
    const capturedUrl = result.scan?.pageUrl;
    if (capturedUrl) {
      const capturedPage = new URL(capturedUrl);
      const initialPage = new URL(tab.url);
      if (capturedPage.origin !== initialPage.origin || capturedPage.pathname !== initialPage.pathname) {
        return { success: false, error: 'The application navigated to another step during Scanner verification. Scan the new step explicitly.' };
      }
    }
    return { success: true, scan: result.scan, url: tab.url, title: tab.title };
  } catch (error) {
    return { success: false, error: error?.message || 'Scanner verification capture failed.' };
  }
}

async function saveScannerStepEvidenceOnTab(tabId, metadata, fields) {
  const tab = await getTab(tabId);
  if (!tab?.id || !tab.url) {
    return { success: false, message: 'The application tab is unavailable; verified Scanner evidence was not saved.' };
  }
  if (!isExtractablePageUrl(tab.url) || !Array.isArray(fields) || fields.length > 150) {
    return { success: false, message: 'The current page or Scanner evidence payload is not valid.' };
  }
  const host = new URL(tab.url).hostname.toLowerCase();
  if (String(metadata?.host || '').toLowerCase() !== host) {
    return { success: false, message: 'The application site changed before Scanner evidence could be saved.' };
  }
  const discovery = {
    siteKey: String(metadata.siteKey || '').slice(0, 255),
    platform: String(metadata.platform || 'generic').slice(0, 64),
    host,
    pageSignature: String(metadata.pageSignature || '').slice(0, 255),
    discoveredAt: new Date().toISOString(),
    scanMeta: {
      pageUrl: String(metadata.pageUrl || '').slice(0, 2000),
      pageStep: String(metadata.pageStep || '').slice(0, 180),
      pageSignature: String(metadata.pageSignature || '').slice(0, 255),
    },
    fields,
    navigationCandidates: [],
  };
  if (!discovery.siteKey || !discovery.pageSignature) {
    return { success: false, message: 'Scanner evidence is missing its site or step identity.' };
  }
  const saved = await persistDiscoveryCheckpoint(tab.id, discovery);
  return {
    success: Boolean(saved?.success),
    message: saved?.message || null,
    checkpoint: saved?.checkpoint || null,
  };
}

async function fillApplicationFormOnTab(tabId, fields, options = {}) {
  const appFlow = self.__qtsApplicationFlow;
  const mode = appFlow?.normalizeApplicationMode?.(options.mode) || 'DISCOVERY';
  if (mode === 'REAL_APPLICATION' && !options.allowUserApprovedFill) {
    return {
      success: false,
      blocked: true,
      error: 'Real application mode will not auto-fill fields without explicit user approval.',
      recovery: appFlow?.buildRecoveryErrorPayload?.({
        sessionId: options.sessionId || `tab:${tabId}`,
        stepId: 'FILLING',
        fieldId: Array.isArray(fields) && fields.length ? fields[0]?.stableFieldId || null : null,
        errorCode: 'REAL_APPLICATION_MODE_REQUIRES_APPROVAL',
        recoverable: true,
        attempts: 1,
        action: 'USER_REQUIRED',
        diagnostics: { mode, totalFields: Array.isArray(fields) ? fields.length : 0 },
      }),
    };
  }

  const tab = await getTab(tabId);
  if (!tab?.id) return { error: 'No active tab' };
  if (!tab.url) {
    return { error: 'The active tab does not have a valid page URL.' };
  }
  const injected = await injectFormScan(tab.id);
  if (!injected) return { error: 'Could not access this page for form filling.' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => window.__fillApplicationFields?.(payload) || { results: [] },
      args: [fields],
    });
    return { success: true, fill: results[0]?.result || { results: [] } };
  } catch (e) {
    return { error: e.message || 'Form fill failed.' };
  }
}

async function advanceManagerApplicationStepOnTab(tabId) {
  const applyAccess = await verifyManagerApplyAccess();
  if (!applyAccess.allowed) return { success: false, error: applyAccess.message };
  const tab = await getTab(tabId);
  if (!tab?.id || !isExtractablePageUrl(tab.url)) {
    return { success: false, error: 'The application page is no longer available for safe step advancement.' };
  }
  const ready = await ensureFormScanScripts(tab.id);
  if (!ready.ok) return { success: false, error: 'Could not inspect application controls before advancing.' };

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const queryAll = (selector) => window.__qtsQueryAllOpenShadowRoots
        ? window.__qtsQueryAllOpenShadowRoots(selector)
        : Array.from(document.querySelectorAll(selector));
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const fieldLabel = (element) => {
        const label = element.labels?.[0]?.textContent
          || element.getAttribute('aria-label')
          || element.getAttribute('placeholder')
          || element.getAttribute('name')
          || 'Required field';
        return String(label).replace(/\s+/g, ' ').trim().slice(0, 160);
      };
      const controls = queryAll(
        'input:not([type="hidden"]), select, textarea, [aria-required="true"]'
      ).filter((element) => (
        !element.disabled
        && element.getAttribute('aria-disabled') !== 'true'
        && visible(element)
      ));
      const invalidFields = [];
      for (const element of controls) {
        const required = element.required === true || element.getAttribute('aria-required') === 'true';
        const hasNativeError = element.validity?.valid === false
          || element.getAttribute('aria-invalid') === 'true';
        const value = element.type === 'checkbox' || element.type === 'radio'
          ? (element.checked ? 'checked' : '')
          : element.isContentEditable
            ? element.textContent.trim()
            : String(element.value || '').trim();
        if (hasNativeError || (required && !value)) invalidFields.push(fieldLabel(element));
      }
      const scan = window.__scanApplicationForm?.();
      const invalidScannedFields = (scan?.fields || []).filter((field) => (
        field.invalid === true
      )).map((field) => field.label || 'Invalid field');
      const unansweredRequiredFields = (scan?.fields || []).filter((field) => {
        if (!field.required || field.invalid) return false;
        const value = String(field.currentValue || '').trim();
        return ['checkbox', 'switch'].includes(field.fieldType)
          ? value !== 'true'
          : !value;
      }).map((field) => field.label || 'Required field');
      invalidFields.push(...invalidScannedFields, ...unansweredRequiredFields);
      const uniqueInvalidFields = [...new Set(invalidFields)];
      if (uniqueInvalidFields.length) {
        return {
          advanced: false,
          reason: `Required or invalid fields remain: ${uniqueInvalidFields.slice(0, 8).join(', ')}.`,
          invalidFields: uniqueInvalidFields,
        };
      }

      const candidates = queryAll(
        'button, input[type="button"], input[type="submit"], [role="button"]'
      ).filter(visible).map((element) => {
        const host = element.getRootNode?.()?.host;
        const label = window.__qtsGetAccessibleControlLabel?.(element) || String(
          element.textContent
          || element.value
          || element.getAttribute('aria-label')
          || element.getAttribute('title')
          || host?.getAttribute('aria-label')
          || host?.innerText
          || host?.textContent
          || ''
        ).replace(/\s+/g, ' ').trim();
        let contextRoot = element.closest('form, [role="dialog"], [aria-modal="true"]');
        if (!contextRoot) {
          for (let parent = element.parentElement, depth = 0; parent && depth < 6; parent = parent.parentElement, depth += 1) {
            if (parent.querySelector('input, textarea, select, [role="textbox"], [role="combobox"]')) {
              contextRoot = parent;
              break;
            }
          }
        }
        const contextText = String(contextRoot?.innerText || contextRoot?.textContent || '')
          .replace(/\s+/g, ' ').trim();
        return {
          element,
          label,
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
          contextRoot,
          contextText,
        };
      }).filter((candidate) => candidate.label);
      const flow = window.__qtsApplicationFlow;
      if (!flow?.selectAutomaticNextAction || !flow?.classifyNavigationAction) {
        return { advanced: false, reason: 'The safe navigation classifier is unavailable.' };
      }
      const otpControlCount = queryAll(
        'input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="verification" i], input[id*="verification" i], input[maxlength="1"][inputmode="numeric"], input[maxlength="1"][inputmode="decimal"]'
      ).filter(visible).length;
      const segmentedCodeInputs = queryAll('input[maxlength="1"]').filter(visible).length >= 4;
      const verificationCopy = /\b(enter|type|input|check for).{0,60}\b(verification|security|one[- ]time|confirmation) code\b|\bcode sent to your (email|phone|mobile)\b|\b(verify|verification required|confirm your email)\b/i
        .test(document.body.innerText || '');
      const otpStepDetected = otpControlCount > 0 || segmentedCodeInputs || verificationCopy;
      const actions = candidates.map(({ element, contextText, ...candidate }) => {
        const navigationBoundaryReason = flow.getNavigationBoundaryReason?.({
          verificationRequired: otpStepDetected,
          fieldTypes: (scan?.fields || []).map((field) => field.fieldType),
          hasEmailField: (scan?.fields || []).some((field) => field.fieldType === 'email'
            || /email/i.test(`${field.label} ${field.autocompleteAttr} ${field.nameAttr}`)),
          text: contextText,
        });
        return {
          ...candidate,
          navigationBoundaryReason,
          classification: flow.classifyNavigationAction(candidate.label, { mode: 'REAL_APPLICATION' }).classification,
          element,
        };
      });
      const protectedControl = queryAll(
        'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'
      ).filter(visible).some((element) => {
        const label = element.labels?.[0]?.textContent
          || element.getAttribute('aria-label')
          || element.parentElement?.textContent
          || '';
        return /\b(certif(?:y|ication)|attest|truthful|accurate|electronic signature|i agree|consent to)\b/i.test(label);
      });
      const verificationRequired = otpStepDetected || Boolean(queryAll(
        'iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i], input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i]'
      ).length) || /\b(captcha|one[- ]time password|verification code|two[- ]factor code)\b/i.test(document.body.innerText || '');
      const humanBoundaryReason = protectedControl
        ? 'A consent, attestation, or signature control needs Manager input. Apply paused.'
        : verificationRequired
          ? 'A CAPTCHA or one-time verification step needs a person. Apply paused.'
          : null;
      const choice = flow.selectAutomaticNextAction(actions);
      if (choice.action && humanBoundaryReason) {
        return { advanced: false, reason: humanBoundaryReason };
      }
      if (!choice.action) {
        const finalSubmitFound = actions.some((action) => (
          action.classification === flow.ACTION_CLASSIFICATIONS.FINAL_SUBMIT
        ));
        const submitChoice = flow.selectAutomaticFinalSubmitAction?.(actions);
        if (submitChoice?.action) {
          if (humanBoundaryReason) {
            return {
              advanced: false,
              finalSubmitFound: true,
              reason: humanBoundaryReason.replace('Apply paused.', 'Apply did not submit.'),
            };
          }
          submitChoice.action.element.click();
          return { advanced: false, submitted: true, label: submitChoice.action.label };
        }
        return {
          advanced: false,
          finalSubmitFound,
          reason: humanBoundaryReason || (finalSubmitFound
            ? submitChoice?.reason || 'The application needs Manager review before final submission.'
            : choice.reason),
        };
      }
      choice.action.element.click();
      return { advanced: true, label: choice.action.label };
    },
  });

  const result = injection?.result;
  if (!result?.advanced && !result?.submitted) return { success: true, ...result };
  await waitForTabSettled(tab.id);
  if (result.submitted) {
    const [confirmation] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => /\b(application (was )?submitted|application received|thanks for applying|we received your application|successfully applied)\b/i
        .test(document.body?.innerText || ''),
    });
    return {
      success: true,
      ...result,
      submittedAt: Date.now(),
      submissionConfirmed: confirmation?.result === true,
    };
  }
  return { success: true, ...result };
}

function isChatGptHostUrl(url) {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.isChatGptHost) {
    return worker.isChatGptHost(url || '');
  }
  try {
    const host = new URL(url || '').hostname.replace(/^www\./, '').toLowerCase();
    return host === 'chatgpt.com' || host === 'chat.openai.com';
  } catch {
    return /chatgpt\.com|chat\.openai\.com/i.test(String(url || ''));
  }
}

function isCustomGptUrl(url, title = '') {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.isQtsGptTab) {
    return worker.isQtsGptTab({ url: url || '', title: title || '' });
  }
  const gptId = self.__qtsCustomGpt?.CUSTOM_GPT_ID;
  return Boolean(url && gptId && url.includes(gptId));
}

async function getPinnedGptTabId() {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.readPinnedGptTabId) {
    return worker.readPinnedGptTabId(GPT_TAB_STORAGE_KEY);
  }
  const stored = await chrome.storage.local.get([GPT_TAB_STORAGE_KEY]);
  return stored[GPT_TAB_STORAGE_KEY] || null;
}

async function isPinnedGptTab(tabId) {
  const worker = self.__qtsGptWorkerHandoff;
  if (worker?.isPinnedGptTabId) {
    return worker.isPinnedGptTabId(tabId, GPT_TAB_STORAGE_KEY);
  }
  const pinnedId = await getPinnedGptTabId();
  return Number(pinnedId) === Number(tabId);
}

function isExtensionOrInternalUrl(url) {
  if (!url) return true;
  try {
    const protocol = new URL(url).protocol.replace(':', '');
    return protocol === 'chrome' || protocol === 'chrome-extension' || protocol === 'edge' || protocol === 'about';
  } catch {
    return false;
  }
}

async function resolveJobTabIdForCapture(preferredTabId) {
  const tab = preferredTabId ? await getTab(preferredTabId) : null;
  if (tab?.id && tab.url && !isExtensionOrInternalUrl(tab.url) && !(await isPinnedGptTab(tab.id))) {
    return tab.id;
  }

  const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
  const storedTabId = stored[JOB_SOURCE_TAB_STORAGE_KEY];
  if (storedTabId) {
    const storedTab = await getTab(storedTabId);
    if (storedTab?.id && storedTab.url && !isExtensionOrInternalUrl(storedTab.url) && !(await isPinnedGptTab(storedTab.id))) {
      return storedTab.id;
    }
  }

  if (lastSourceTabId) {
    const lastTab = await getTab(lastSourceTabId);
    if (lastTab?.id && lastTab.url && !isExtensionOrInternalUrl(lastTab.url) && !(await isPinnedGptTab(lastTab.id))) {
      return lastTab.id;
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id && activeTab.url && !isExtensionOrInternalUrl(activeTab.url) && !(await isPinnedGptTab(activeTab.id))) {
    return activeTab.id;
  }

  return null;
}

async function closeCapturePanel(jobTabId = lastSourceTabId) {
  if (!jobTabId) return;
  try {
    await chrome.tabs.sendMessage(jobTabId, { type: 'QTS_CLOSE_CAPTURE_PANEL' });
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error?.message || '')) {
      throw error;
    }
  }
}

async function focusBrowserWindowForTab(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.windowId == null) return;
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // tab or window may be closed
  }
}

async function releaseUiForGptHandoff({ jobTabId, gptTabId } = {}) {
  await closeCapturePanel(jobTabId);
  const focusTabId = gptTabId || await getPinnedGptTabId();
  if (focusTabId) {
    await focusBrowserWindowForTab(focusTabId);
  } else if (jobTabId) {
    await focusBrowserWindowForTab(jobTabId);
  }
}

function stopGptApprovalWatcher() {
  if (gptApprovalWatchTimer) {
    clearInterval(gptApprovalWatchTimer);
    gptApprovalWatchTimer = null;
  }
  const tabId = gptPageWatchJob?.tabId;
  if (tabId) {
    void self.__qtsGptWorkerHandoff?.stopAllowWatchInTab?.(tabId);
  }
  gptPageWatchJob = null;
}

function notifyGptPageStatus(payload) {
  chrome.runtime.sendMessage({
    type: 'GPT_PAGE_STATUS',
    ...payload,
  }).catch(() => {});
}

function startGptPageWatch(tabId, taskId, options = {}) {
  stopGptApprovalWatcher();
  const job = {
    tabId,
    taskId,
    applicationId: options.applicationId,
    pollAndApply: options.pollAndApply,
    jobTabId: options.jobTabId,
    cancelled: false,
  };
  gptPageWatchJob = job;

  (async () => {
    const worker = self.__qtsGptWorkerHandoff;
    if (!worker?.watchGptTabAfterSend) return;

    try {
      await releaseUiForGptHandoff({
        jobTabId: options.jobTabId || lastSourceTabId,
        gptTabId: tabId,
      });

      const result = await worker.watchGptTabAfterSend(tabId, taskId, {
        timeoutMs: options.timeoutMs || 180000,
        pollMs: options.pollMs || 1200,
        getTaskStatus: async () => {
          const api = self.__qtsApiWorker;
          if (!api?.workerApiRequest) return null;
          return api.workerApiRequest(
            'GET',
            `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/extension-status`
          );
        },
        onStatus: (snap) => {
          if (gptPageWatchJob !== job || job.cancelled) return;
          notifyGptPageStatus(snap);
        },
      });

      if (gptPageWatchJob !== job || job.cancelled) return;

      chrome.runtime.sendMessage({
        type: 'GPT_PAGE_WATCH_FINISHED',
        taskId,
        applicationId: options.applicationId,
        ...result,
      }).catch(() => {});

      if (options.pollAndApply && options.applicationId) {
        if (result.ok || (result.totalAllowClicks || 0) > 0) {
          startGptPollAndApply({
            taskId,
            applicationId: options.applicationId,
            jobTabId: options.jobTabId || lastSourceTabId,
          });
        }
      }
    } catch (e) {
      chrome.runtime.sendMessage({
        type: 'GPT_PAGE_WATCH_FINISHED',
        taskId,
        applicationId: options.applicationId,
        ok: false,
        error: e?.message || String(e),
      }).catch(() => {});
    } finally {
      if (gptPageWatchJob === job) gptPageWatchJob = null;
      await worker?.stopAllowWatchInTab?.(tabId);
      await restoreJobBrowserFocus(options.jobTabId || job.jobTabId || lastSourceTabId);
    }
  })();
}

async function notifyGptActionApprovalNeeded(
  jobTabId,
  taskId,
  message = 'Custom GPT is waiting for Action approval. Open the pinned GPT tab and click Allow.'
) {
  const pinnedGptTabId = await getPinnedGptTabId();
  if (pinnedGptTabId) {
    await focusBrowserWindowForTab(pinnedGptTabId);
  }
  if (jobTabId) {
    await showPageDetectAlert(jobTabId, message, 'warn');
  }
  chrome.runtime.sendMessage({
    type: 'GPT_ACTION_APPROVAL_NEEDED',
    taskId,
    message,
  }).catch(() => {});
}

async function focusJobTab(jobTabId) {
  if (!jobTabId) return;
  try {
    const tab = await getTab(jobTabId);
    if (tab?.id && !isCustomGptUrl(tab.url, tab.title) && !(await isPinnedGptTab(tab.id))) {
      await chrome.tabs.update(jobTabId, { active: true });
    }
  } catch {
    // tab may be closed
  }
}

async function preloadCustomGptTab() {
  if (gptPrewarmPromise) return gptPrewarmPromise;

  gptPrewarmPromise = (async () => {
    const worker = self.__qtsGptWorkerHandoff;
    if (!worker?.ensurePinnedGptTab) {
      throw new Error('GPT worker handoff module not loaded.');
    }

    return worker.ensurePinnedGptTab({
      storageKey: GPT_TAB_STORAGE_KEY,
      focus: false,
      preparePage: true,
      pinInBrowser: true,
    });
  })().finally(() => {
    gptPrewarmPromise = null;
  });

  return gptPrewarmPromise;
}

function isJobPageCandidateUrl(url) {
  return isExtractablePageUrl(url) && !isIgnoredSite(url) && !isChatGptHostUrl(url);
}

async function maybePrewarmCustomGptOnJobPage(url) {
  if (!isJobPageCandidateUrl(url)) return;
  if (!(await isAutoApplyArmed())) return;
  preloadCustomGptTab().catch(() => {});
}

async function restoreJobBrowserFocus(jobTabId) {
  if (jobTabId) {
    await focusBrowserWindowForTab(jobTabId);
    return;
  }
  if (lastSourceTabId) {
    await focusBrowserWindowForTab(lastSourceTabId);
  }
}

async function persistPendingGptDispatch(payload) {
  if (!payload?.taskId) return;
  await chrome.storage.local.set({
    [PENDING_GPT_DISPATCH_KEY]: {
      ...payload,
      startedAt: Date.now(),
    },
  });
}

async function clearPendingGptDispatch() {
  await chrome.storage.local.remove(PENDING_GPT_DISPATCH_KEY);
}

async function readPendingGptDispatch() {
  const stored = await chrome.storage.local.get([PENDING_GPT_DISPATCH_KEY]);
  return stored[PENDING_GPT_DISPATCH_KEY] || null;
}

function notifyGptDispatchFinished(payload) {
  chrome.runtime.sendMessage({
    type: 'GPT_DISPATCH_FINISHED',
    ...payload,
  }).catch(() => {});
}

async function resumePendingGptDispatchIfAny() {
  if (gptDispatchInFlight) return null;
  const pending = await readPendingGptDispatch();
  if (!pending?.taskId || pending.sent) return null;
  if (Date.now() - (pending.startedAt || 0) < 2000) return null;

  const result = await runSendGptTask({
    taskId: pending.taskId,
    jobTabId: pending.jobTabId,
    applicationId: pending.applicationId,
    pollAndApply: pending.pollAndApply,
  });

  if (result.handoff?.sent) {
    await clearPendingGptDispatch();
    notifyGptDispatchFinished({
      taskId: pending.taskId,
      applicationId: pending.applicationId,
      ...result,
    });
  }

  return result;
}

async function waitForScannerChatGptTab(tabId, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error('Timed out waiting for the ChatGPT page to load.'));
      }, timeoutMs);
      const onUpdated = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(tab);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId)
        .then((current) => {
          if (current.status !== 'complete') return;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(current);
        })
        .catch((error) => {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          reject(error);
        });
    });
  }

  async function showScannerChatGptStatus(tabId, taskId, phase, message, type = 'info') {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: 'QTS_GPT_SET_STATUS',
          taskId,
          phase,
          message,
          statusType: type,
          label: `v${chrome.runtime.getManifest().version} · handoff ${self.__qtsChatGptComposerHandoff?.version || 'unknown'}`,
          persistent: phase !== 'scanner-complete',
        });
        if (result?.ok) return;
      } catch (error) {
        if (attempt === 9) {
          console.warn('[QTS Scanner] Could not update ChatGPT progress card:', error);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    console.warn('[QTS Scanner] ChatGPT progress card did not acknowledge the status update.');
  }

  async function showScannerJobPageStatus(jobTabId, taskId, message, type = 'info') {
    if (!Number.isInteger(jobTabId)) return;

    chrome.runtime.sendMessage({
      type: 'QTS_SCANNER_JOB_PROGRESS',
      jobTabId,
      taskId,
      message,
    }).catch(() => {});

    try {
      await chrome.scripting.executeScript({
        target: { tabId: jobTabId },
        files: ['content/capture-panel.js'],
      });
      await chrome.tabs.sendMessage(jobTabId, {
        type: 'QTS_CLEAR_PAGE_ALERT',
        alertId: 'scanner-progress',
      });
      const result = await chrome.tabs.sendMessage(jobTabId, {
        type: 'QTS_SHOW_PAGE_TOAST',
        message,
        toastType: type,
        durationMs: 6000,
        persistUntilCleared: true,
        alertId: 'scanner-progress',
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'The application page did not acknowledge the progress update.');
      }
    } catch (error) {
      console.warn('[QTS Scanner] Could not update application-page progress:', error);
    }
  }

  async function scannerChatGptSnapshot(tabId, baseline) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (initial) => {
        const messages = globalThis.__qtsChatGptComposerHandoff?.findAssistantMessages?.()
          || [...document.querySelectorAll('[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]')];
        const last = messages[messages.length - 1];
        const text = String(last?.innerText || last?.textContent || '').trim();
        const generating = Boolean(
          document.querySelector('[data-testid="stop-button"]')
          || [...document.querySelectorAll('button')].some((button) =>
            /stop generating|stop streaming/i.test(button.getAttribute('aria-label') || '')
          )
        );
        return {
          text,
          messageCount: messages.length,
          isNew: messages.length > initial.messageCount || text !== initial.lastText,
          generating,
        };
      },
      args: [baseline],
    });
    return results[0]?.result;
  }

  async function runScannerChatGptTask(msg) {
    const taskId = String(msg?.taskId || '').trim();
    const prompt = String(msg?.prompt || '').trim();
    if (!/^task_[0-9a-f-]{36}$/i.test(taskId)) throw new Error('A valid Scanner task ID is required.');
    if (!prompt) throw new Error('The Scanner prompt is empty.');
    if (!self.__qtsScannerChatGpt?.extractPackage) {
      throw new Error('The ChatGPT Scanner response parser is unavailable.');
    }
    const jobTabId = Number(msg?.jobTabId);

    const tabStorageKey = `qtsScannerChatGptTab:${taskId}`;
    const storedTab = await chrome.storage.local.get(tabStorageKey);
    let chatTab = null;
    const storedTabId = Number(storedTab[tabStorageKey]);
    if (Number.isInteger(storedTabId) && storedTabId > 0) {
      const tabs = await chrome.tabs.query({});
      chatTab = tabs.find((tab) => tab.id === storedTabId && isChatGptHost(tab.url)) || null;
      if (!chatTab) await chrome.storage.local.remove(tabStorageKey);
    }
    if (!chatTab) {
      const existingChatTabs = await chrome.tabs.query({
        url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      });
      existingChatTabs.sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
      for (const candidate of existingChatTabs) {
        if (candidate.id == null) continue;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: candidate.id },
            files: ['shared/chatgpt-composer-handoff.js'],
          });
          const matchingDraft = await chrome.scripting.executeScript({
            target: { tabId: candidate.id },
            func: (expectedPrompt) => {
              const composer = globalThis.__qtsChatGptComposerHandoff;
              const editor = composer?.findUnifiedComposerEditor?.(expectedPrompt);
              const expected = String(expectedPrompt || '').replace(/\s+/g, ' ').trim();
              return Boolean(editor && composer.readEditorText?.(editor) === expected);
            },
            args: [prompt],
          });
          if (matchingDraft[0]?.result) {
            chatTab = candidate;
            break;
          }
        } catch (error) {
          console.warn('[QTS Scanner] Could not inspect an existing ChatGPT tab for this task:', error);
        }
      }
    }
    if (!chatTab) {
      chatTab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: false });
      if (chatTab?.id == null) throw new Error('Could not open a ChatGPT tab.');
      await chrome.storage.local.set({ [tabStorageKey]: chatTab.id });
    }

    const tabId = chatTab.id;
    try {
      await showScannerChatGptStatus(tabId, taskId, 'scanner-opening', 'Opening ChatGPT for this Scanner task…');
      await showScannerJobPageStatus(
        jobTabId,
        taskId,
        'Opening ChatGPT in a background tab. Scanner is working; keep this application page open and wait for the review prompt.'
      );
      await waitForScannerChatGptTab(tabId);
      await showScannerChatGptStatus(tabId, taskId, 'scanner-composer', 'Waiting for the ChatGPT message box…');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['shared/chatgpt-composer-handoff.js', 'content/chatgpt-handoff.js'],
      });
      await showScannerChatGptStatus(tabId, taskId, 'scanner-typing', 'Checking the ChatGPT composer and sending the Scanner prompt…');
      const handoffResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (message, taskId) => {
          const composer = globalThis.__qtsChatGptComposerHandoff;
          if (!composer?.runUnifiedComposerHandoffAsync) {
            return { ok: false, error: 'The asynchronous ChatGPT composer helper is unavailable.' };
          }
          const startedAt = Date.now();
          while (Date.now() - startedAt < 45000) {
            const editor = composer.findUnifiedComposerEditor?.();
            if (!editor) {
              await new Promise((resolve) => setTimeout(resolve, 300));
              continue;
            }
            const generating = Boolean(
              document.querySelector('[data-testid="stop-button"]')
              || [...document.querySelectorAll('button')].some((button) =>
                /stop generating|stop streaming/i.test(button.getAttribute('aria-label') || '')
              )
            );
            if (generating) {
              return { ok: false, error: 'ChatGPT is already generating a response. Wait for it to finish, then retry.' };
            }
            const assistantMessages = composer.findAssistantMessages?.()
              || [...document.querySelectorAll('[data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]')];
            const baseline = {
              messageCount: assistantMessages.length,
              lastText: String(assistantMessages[assistantMessages.length - 1]?.innerText || '').trim(),
            };
            const result = await composer.runUnifiedComposerHandoffAsync(message, {
              onSending: () => chrome.runtime.sendMessage({
                type: 'QTS_SCANNER_CHATGPT_PROGRESS',
                taskId,
                phase: 'scanner-sending',
                message: 'Prompt typed. Sending it to ChatGPT…',
              }),
            });
            if (result.phase === 'no_editor') {
              await new Promise((resolve) => setTimeout(resolve, 300));
              continue;
            }
            return { ...result, baseline };
          }
          return { ok: false, error: 'Timed out waiting for the ChatGPT message box.' };
        },
        args: [prompt, taskId],
      });
      const handoff = handoffResults[0]?.result;
      if (!handoff?.ok || !handoff.sent) {
        const detail = handoff?.error
          || (handoff?.method === 'send_uncertain'
            ? `The ChatGPT Send button${handoff.sendButtonFound ? ` (${handoff.sendButtonLabel || handoff.sendButtonType || 'submit'})` : ''} was clicked, but submission was not confirmed. Check whether the prompt remains in the composer before taking action. Do not start Scanner again until you confirm the message state.`
            : 'ChatGPT send status is ambiguous. Check the conversation before taking action. If the prompt is still in the composer and no new user message or generation started, click Send once. Do not start Scanner again until you confirm the message state.');
        throw new Error(detail);
      }

      await showScannerChatGptStatus(
        tabId,
        taskId,
        'scanner-sending',
        'ChatGPT accepted the prompt. Confirming the response has started…'
      );
      await showScannerJobPageStatus(
        jobTabId,
        taskId,
        'ChatGPT accepted the prompt. Waiting for its answer package; keep this application page open.'
      );
      const startedAt = Date.now();
      const timeoutMs = 240000;
      let previousText = '';
      let stableSince = 0;
      let responseText = '';
      let packageData = null;
      let lastPackageError = null;
      let generationStatusShown = false;
      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const snapshot = await scannerChatGptSnapshot(tabId, handoff.baseline);
        if (snapshot?.generating && !generationStatusShown) {
          generationStatusShown = true;
          await showScannerChatGptStatus(tabId, taskId, 'scanner-generating', 'ChatGPT is generating the Scanner response…');
          await showScannerJobPageStatus(jobTabId, taskId, 'ChatGPT is generating the Scanner response…');
        }
        if (!snapshot?.isNew || !snapshot.text || snapshot.generating) {
          previousText = '';
          stableSince = 0;
          continue;
        }
        if (snapshot.text !== previousText) {
          previousText = snapshot.text;
          stableSince = Date.now();
          await showScannerChatGptStatus(tabId, taskId, 'scanner-reading', 'ChatGPT finished. Waiting for the response text to settle…');
          continue;
        }
        if (Date.now() - stableSince >= 5000) {
          try {
            packageData = self.__qtsScannerChatGpt.extractPackage(snapshot.text);
            responseText = snapshot.text;
            break;
          } catch (error) {
            lastPackageError = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (!responseText) {
        const parseDetail = lastPackageError
          ? ` The latest response was not yet a complete valid package: ${lastPackageError}`
          : '';
        throw new Error(`Timed out waiting for ChatGPT to finish its Scanner response. Check the ChatGPT tab; do not resend while a response may still be generating.${parseDetail}`);
      }

      await showScannerChatGptStatus(tabId, taskId, 'scanner-reading', 'Extracting the structured answer package from ChatGPT’s response…');
      await showScannerJobPageStatus(jobTabId, taskId, 'ChatGPT finished. Reading the structured answer package…');
      await showScannerChatGptStatus(tabId, taskId, 'scanner-saving', 'Saving ChatGPT’s answer package to this Scanner task…');
      await showScannerJobPageStatus(jobTabId, taskId, 'Saving ChatGPT’s answer package to this Scanner task…');
      const submission = await workerApiRequest(
        'POST',
        `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/package`,
        packageData
      );
      if (!submission.success) {
        throw new Error(submission.message || "The server rejected ChatGPT's Scanner package.");
      }
      await showScannerChatGptStatus(
        tabId,
        taskId,
        'scanner-complete',
        'Answer package saved. Return to the application page to review answers and documents.',
        'success'
      );
      await showScannerJobPageStatus(
        jobTabId,
        taskId,
        'Answer package saved. Review the generated answers and documents in the Scanner panel.',
        'success'
      );
      try {
        await chrome.storage.local.remove(tabStorageKey);
      } catch (error) {
        console.warn('[QTS Scanner] Could not clear the completed ChatGPT tab mapping:', error);
      }
      return {
        ok: true,
        taskId,
        handoff: { ok: true, sent: true, accepted: true, status: submission.status },
        package: submission,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scanner could not complete the ChatGPT step.';
      await showScannerChatGptStatus(tabId, taskId, 'scanner-error', message, 'error');
      await showScannerJobPageStatus(jobTabId, taskId, `Scanner could not finish the ChatGPT step: ${message}`, 'error');
      throw error;
    }
  }

async function runSendGptTask(msg) {
  const taskId = String(msg?.taskId || '').trim();
  if (!taskId) throw new Error('Missing task id');

  const worker = self.__qtsGptWorkerHandoff;
  if (!worker?.sendTaskToCustomGpt) {
    throw new Error('GPT worker handoff module not loaded.');
  }

  let sourceTabId = msg.jobTabId || lastSourceTabId;
  if (sourceTabId) {
    try {
      const sourceTab = await getTab(sourceTabId);
      if (!sourceTab?.id || isCustomGptUrl(sourceTab.url, sourceTab.title) || await isPinnedGptTab(sourceTab.id)) {
        sourceTabId = null;
      }
    } catch {
      sourceTabId = null;
    }
  }

  if (sourceTabId) {
    await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: sourceTabId });
    lastSourceTabId = sourceTabId;
  }

  const prompt = self.__qtsCustomGpt?.buildPrompt?.(taskId) || `PROCESS_TASK: ${taskId}`;
  await persistPendingGptDispatch({
    taskId,
    prompt,
    jobTabId: sourceTabId,
    applicationId: msg.applicationId,
    pollAndApply: msg.pollAndApply,
    sent: false,
  });

  if (gptPrewarmPromise) {
    await gptPrewarmPromise.catch(() => {});
  }

  const sendResult = await worker.sendTaskToCustomGpt(taskId, {
    storageKey: GPT_TAB_STORAGE_KEY,
    loadTimeoutMs: 45000,
    composerTimeoutMs: 30000,
    sendTimeoutMs: 15000,
  });

  if (sendResult.tabId) {
    await releaseUiForGptHandoff({ jobTabId: sourceTabId, gptTabId: sendResult.tabId });
  }

  const handoff = sendResult.handoff || {
    ok: sendResult.ok,
    sent: Boolean(sendResult.ok && sendResult.handoff?.sent !== false),
    error: sendResult.error,
    message: sendResult.message || prompt,
  };

  if (handoff.sent) {
    await clearPendingGptDispatch();
  } else {
    await persistPendingGptDispatch({
      taskId,
      prompt,
      jobTabId: sourceTabId,
      applicationId: msg.applicationId,
      pollAndApply: msg.pollAndApply,
      sent: false,
      error: handoff.error,
    });
  }

  if (sourceTabId) {
    const handoffNote = handoff.sent
      ? 'PROCESS_TASK sent. Extension is clicking Allow and watching Custom GPT Actions.'
      : `GPT handoff failed: ${handoff.error || 'Could not send PROCESS_TASK.'}`;
    await showPageDetectAlert(sourceTabId, handoffNote, handoff.sent ? 'success' : 'warn');
  }

  if (!handoff.sent) {
    await chrome.storage.local.set({ qtsLastProcessTaskPrompt: prompt });
  }

  if (handoff.sent && sendResult.tabId) {
    startGptPageWatch(sendResult.tabId, taskId, {
      applicationId: msg.applicationId,
      pollAndApply: msg.pollAndApply,
      jobTabId: sourceTabId,
    });
  } else {
    await notifyGptActionApprovalNeeded(sourceTabId, taskId);
  }

  return {
    ok: Boolean(handoff.sent || sendResult.ok),
    tabId: sendResult.tabId || null,
    taskId,
    handoff,
    gptWatchStarted: Boolean(handoff.sent && sendResult.tabId),
  };
}

async function executeSendGptTask(msg) {
  if (gptDispatchInFlight) {
    throw new Error('GPT handoff already in progress.');
  }
  gptDispatchInFlight = true;
  const keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 3000);
  try {
    return await runSendGptTask(msg);
  } finally {
    gptDispatchInFlight = false;
    clearInterval(keepalive);
  }
}

async function dispatchCustomGptTask(taskId, prompt, jobTabId, options = {}) {
  const worker = self.__qtsGptWorkerHandoff;
  const message = prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
  const keepalive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 4000);
  let handoff = null;
  let gptTabId = null;

  if (gptDispatchInFlight) {
    throw new Error('GPT handoff already in progress.');
  }
  gptDispatchInFlight = true;

  try {
    let sourceTabId = jobTabId || lastSourceTabId;

    if (sourceTabId) {
      try {
        const sourceTab = await getTab(sourceTabId);
        if (!sourceTab?.id || isCustomGptUrl(sourceTab.url, sourceTab.title) || await isPinnedGptTab(sourceTab.id)) {
          sourceTabId = null;
        }
      } catch {
        sourceTabId = null;
      }
    }

    if (sourceTabId) {
      await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: sourceTabId });
      lastSourceTabId = sourceTabId;
    }

    if (!worker?.sendTaskToCustomGpt) {
      throw new Error('GPT worker handoff module not loaded.');
    }

    await persistPendingGptDispatch({
      taskId,
      prompt: message,
      jobTabId: sourceTabId,
      applicationId: options.applicationId,
      pollAndApply: options.pollAndApply,
      sent: false,
    });

    const sendResult = await worker.sendTaskToCustomGpt(taskId || message, {
      storageKey: GPT_TAB_STORAGE_KEY,
      loadTimeoutMs: 45000,
      composerTimeoutMs: 30000,
      sendTimeoutMs: 15000,
    });
    gptTabId = sendResult.tabId || null;
    handoff = sendResult.handoff || {
      ok: sendResult.ok,
      sent: Boolean(sendResult.ok),
      method: 'gpt_worker_dom',
      error: sendResult.error,
      message: sendResult.message || message,
    };

    if (handoff.sent || handoff.needsManualSend) {
      await clearPendingGptDispatch();
    } else {
      await persistPendingGptDispatch({
        taskId,
        prompt: message,
        jobTabId: sourceTabId,
        applicationId: options.applicationId,
        pollAndApply: options.pollAndApply,
        sent: false,
        error: handoff.error,
      });
    }

    if (sourceTabId) {
      const handoffNote = handoff.sent
        ? 'PROCESS_TASK sent. Extension is clicking Allow and watching Custom GPT Actions.'
        : `GPT handoff failed: ${handoff.error || 'Could not send PROCESS_TASK.'}`;
      await showPageDetectAlert(sourceTabId, handoffNote, handoff.sent ? 'success' : 'warn');
    }

    if (gptTabId && (handoff.sent || handoff.needsManualSend)) {
      startGptPageWatch(gptTabId, taskId, {
        applicationId: options.applicationId,
        pollAndApply: options.pollAndApply,
        jobTabId: sourceTabId,
      });
    }
    if (!handoff.sent) {
      const notice = handoff.needsManualSend
        ? 'PROCESS_TASK may be in the GPT chat but was not confirmed. If it is still in the composer, click Send; approve any requested Action.'
        : 'PROCESS_TASK was not sent. Open the pinned GPT tab and send it manually.';
      await notifyGptActionApprovalNeeded(sourceTabId, taskId, notice);
      await chrome.storage.local.set({ qtsLastProcessTaskPrompt: message });
    }

    const result = {
      ok: Boolean(handoff.sent || handoff.ok),
      tabId: gptTabId,
      jobTabId: sourceTabId,
      taskId,
      handoff,
    };

    if (options.notify) {
      notifyGptDispatchFinished(result);
    }

    return result;
  } finally {
    gptDispatchInFlight = false;
    clearInterval(keepalive);
  }
}

self.__qtsDispatchActiveApplicationTask = async ({ taskId, jobTabId }) => {
  const result = await dispatchCustomGptTask(taskId, null, jobTabId, {
    pollAndApply: false,
    focus: true,
  });
  if (!result?.handoff?.sent && !result?.handoff?.needsManualSend) {
    throw new Error(result?.handoff?.error || 'Could not send the application task to the assigned Custom GPT.');
  }
  return result;
};

async function injectDetectToast(tabId) {
  try {
    const [{ result: hasToast }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof window.__showQtsDetectToast === 'function',
    });
    if (!hasToast) {
      await chrome.scripting.executeScript({ target: { tabId }, files: [DETECT_TOAST_FILE] });
    }
    return true;
  } catch {
    return false;
  }
}

async function showPageDetectAlert(tabId, message, type, durationMs, options = {}) {
  const tab = await getTab(tabId);
  const tabUrl = tab?.url || tab?.pendingUrl || '';
  if (isChatGptHostUrl(tabUrl) && !options.allowOnGptTab) return;

  if (!(await injectDetectToast(tabId))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, toastType, hideMs, oncePerPage) => {
        window.__showQtsDetectToast?.(msg, toastType, hideMs, oncePerPage);
      },
      args: [message, type, durationMs ?? null, options.oncePerPage === true],
    });
  } catch {
    // non-fatal
  }
}

async function isAutoApplyArmed() {
  return Boolean(await self.__qtsAutoApplicationPipeline?.isExtensionOperational?.());
}

function disarmJobPageActivity() {
  lastAutoDetectKeyByTab.clear();
  lastAutoPipelineKeyByTab.clear();
  lastApplyMethodDetectKeyByTab.clear();
  autoPipelineInFlight.clear();
  detectGenerationByTab.clear();
  stopGptApprovalWatcher();
  stopGptPollAndApply();
}

async function autoDetectJob(
  tabId,
  url,
  { forcePipeline = false, captureOnly = false } = {}
) {
  if (!forcePipeline && !captureOnly && !(await isAutoApplyArmed())) return;

  if (!isExtractablePageUrl(url) || isIgnoredSite(url) || isChatGptHostUrl(url)) return;

  const generation = (detectGenerationByTab.get(tabId) || 0) + 1;
  detectGenerationByTab.set(tabId, generation);

  await new Promise((resolve) => setTimeout(resolve, AUTO_DETECT_DELAY_MS));

  if (detectGenerationByTab.get(tabId) !== generation) return;

  const tab = await getTab(tabId);
  if (!tab?.id || tab.url !== url) return;

  const result = await extractJobFromTab(tabId);
  if (detectGenerationByTab.get(tabId) !== generation) return;

  const pageUrl = result.tab?.url || url;
  const entry = buildDetectedJobEntry(tabId, pageUrl, result.data);
  if (result.error) {
    entry.valid = false;
    entry.data = null;
  }

  await setDetectedJobForTab(entry);
  await injectJobPanelWatch(tabId, pageUrl);
  prefetchTabContext(tabId).catch(() => {});
  detectApplyTemplateOnTab(tabId, pageUrl).catch(() => {});

  notifyCapturePopup(tabId);
  if (!captureOnly) {
    maybeStartAutoApplicationPipeline(tabId, pageUrl, entry, {
      force: Boolean(forcePipeline),
    }).catch(() => {});
  }
}

async function startAutoApplyOnJobTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab?.id || !tab.url) {
    throw new Error('Open a job page in your browser first.');
  }
  if (!isExtractablePageUrl(tab.url) || isIgnoredSite(tab.url)) {
    throw new Error('This tab is not a supported job page.');
  }

  const pipeline = self.__qtsAutoApplicationPipeline;
  if (!(await pipeline?.isExtensionOperational?.())) {
    throw new Error('Sign in, turn on auto-apply, and choose a default candidate first.');
  }

  lastAutoPipelineKeyByTab.delete(tabId);
  lastAutoDetectKeyByTab.delete(tabId);
  lastSourceTabId = tabId;
  await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: tabId });

  await closeCapturePanel(tabId);
  await restoreJobBrowserFocus(tabId);
  preloadCustomGptTab().catch(() => {});
  await showPageDetectAlert(tabId, 'QTS: Discovering job details and starting application…', 'info');
  await autoDetectJob(tabId, tab.url, { forcePipeline: true });
}

async function maybeStartAutoApplicationPipeline(tabId, url, detectedEntry, options = {}) {
  ensureAutoPipelineDeps();
  const pipeline = self.__qtsAutoApplicationPipeline;
  if (!pipeline?.runAutoApplicationPipeline) return;

  if (!(await pipeline.isAutoApplyEnabled())) return;
  const candidateId = await pipeline.resolveDefaultCandidateId();
  if (!candidateId) return;
  if (autoPipelineInFlight.has(tabId)) return;

  const normalizedUrl = pipeline.normalizePipelineUrl(url);
  const pipelineKey = `${tabId}:${normalizedUrl}`;
  const force = Boolean(options.force);
  if (!force && lastAutoPipelineKeyByTab.get(tabId) === pipelineKey) return;

  autoPipelineInFlight.add(tabId);
  preloadCustomGptTab().catch(() => {});
  try {
    if (!force) {
      await sleep(AUTO_PIPELINE_DELAY_MS);
    } else {
      await sleep(200);
    }
    const tab = await getTab(tabId);
    if (!tab?.id || pipeline.normalizePipelineUrl(tab.url) !== normalizedUrl) return;

    const result = await pipeline.runAutoApplicationPipeline(tabId, {
      candidateId,
      jobUrl: normalizedUrl,
      detectedJob: detectedEntry,
    });

    if (result?.ok || result?.reason === 'already_applied') {
      lastAutoPipelineKeyByTab.set(tabId, pipelineKey);
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (!/no application fields|external apply|apply button/i.test(message)) {
      await showPageDetectAlert(tabId, `QTS auto-apply: ${message}`, 'warn');
    }
  } finally {
    autoPipelineInFlight.delete(tabId);
  }
}

function notifyCapturePopup(tabId) {
  chrome.runtime.sendMessage({ type: 'JOB_DETECTED_UPDATE', tabId }).catch(() => {});
}

function maybeDetectApplyMethodOnOpen(tabId, url) {
  (async () => {
    if (!(await isAutoApplyArmed())) return;
    if (!url || isIgnoredSite(url)) return;
    if (!isTemplateCandidateUrl(url)) return;
    const autoKey = `${tabId}:${url}`;
    if (lastApplyMethodDetectKeyByTab.get(tabId) === autoKey) {
      injectApplyModalWatch(tabId, url).catch(() => {});
      return;
    }
    lastApplyMethodDetectKeyByTab.set(tabId, autoKey);
    detectApplyTemplateOnTab(tabId, url)
      .then(() => injectApplyModalWatch(tabId, url))
      .catch(() => {});
  })().catch(() => {});
}

async function runDetectForActiveTab(tabId) {
  if (!(await isAutoApplyArmed())) return;
  const tab = await getTab(tabId);
  if (!tab?.id || !tab.url) return;
  if (!isExtractablePageUrl(tab.url) || isIgnoredSite(tab.url) || isChatGptHostUrl(tab.url)) return;
  lastAutoDetectKeyByTab.delete(tabId);
  await autoDetectJob(tabId, tab.url).catch(() => {});
}

function maybeTrackAutoOpen(tabId, url) {
  if (!isJobPageCandidateUrl(url)) return;
  (async () => {
    const autoKey = `${tabId}:${url}`;
    if (lastAutoDetectKeyByTab.get(tabId) === autoKey) return;
    lastAutoDetectKeyByTab.set(tabId, autoKey);
    const autoApplyArmed = await isAutoApplyArmed();
    if (autoApplyArmed) maybePrewarmCustomGptOnJobPage(url);
    await autoDetectJob(tabId, url, {
      captureOnly: !autoApplyArmed,
    });
  })().catch((error) => {
    console.warn('[QTS_Startup] Could not inspect the loaded job page:', error);
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'qts-gpt-handoff') return;

  port.onMessage.addListener((msg) => {
    if (msg?.type !== 'SEND_GPT_TASK') return;

    executeSendGptTask(msg)
      .then((result) => {
        const payload = { type: 'GPT_HANDOFF_RESULT', ...result };
        port.postMessage(payload);
        notifyGptDispatchFinished(result);
      })
      .catch((e) => {
        const payload = {
          type: 'GPT_HANDOFF_RESULT',
          ok: false,
          taskId: msg.taskId,
          error: e.message || 'Could not send PROCESS_TASK.',
          handoff: { ok: false, sent: false, error: e.message || 'Could not send PROCESS_TASK.' },
        };
        port.postMessage(payload);
        notifyGptDispatchFinished(payload);
      });
  });
});

const featureMessageGroups = {
  textHighlights: new Set([
    'GET_GLOBAL_TEXT_HIGHLIGHTS',
  ]),
  scanner: new Set([
    'DISCOVER_APPLICATION_FORM',
    'CAPTURE_APPLICATION_STEP',
    'SAVE_SCANNER_STEP_EVIDENCE',
    'GET_APPLY_TEMPLATE',
    'DETECT_APPLY_TEMPLATE',
    'SCAN_APPLICATION_FORM',
    'FILL_APPLICATION_FORM',
  ]),
  applicationAutomation: new Set([
    'ADVANCE_MANAGER_APPLICATION_STEP',
    'CHECK_APPLICATION_SUBMISSION_STATUS',
    'POLL_AND_APPLY_GPT_TASK',
    'APPLY_GPT_PACKAGE_TO_TAB',
    'SEND_GPT_TASK',
    'DISPATCH_GPT_TASK',
    'START_AUTO_APPLY_ON_TAB',
  ]),
};

function disabledFeatureForMessage(type) {
  for (const [feature, messageTypes] of Object.entries(featureMessageGroups)) {
    if (messageTypes.has(type) && !self.__qtsRuntimeConfig.isFeatureEnabled(feature)) {
      return feature;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const disabledFeature = disabledFeatureForMessage(msg?.type);
  if (disabledFeature) {
    sendResponse({
      ok: false,
      success: false,
      disabled: true,
      error: `${disabledFeature} is not enabled in this QTS release.`,
    });
    return false;
  }
  if (msg.type === 'GET_QTS_RUNTIME_CONFIG') {
    self.__qtsRuntimeConfig.getServerUrl()
      .then((serverUrl) => sendResponse({
        ok: true,
        serverUrl,
        features: self.__qtsRuntimeConfig.features,
      }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'QTS_PAGE_ACTION') {
    (async () => {
      const action = String(msg.action || '');
      const tabId = sender.tab?.id;
      if (action === 'sign_in') {
        if (tabId == null) {
          sendResponse({ ok: false, error: 'Sign in must be opened from a web page.' });
          return;
        }
        const loginName = typeof msg.loginName === 'string' ? msg.loginName.trim() : '';
        const password = typeof msg.password === 'string' ? msg.password : '';
        if (!loginName || !password) {
          sendResponse({ ok: false, error: 'User Name and Password are required.' });
          return;
        }
        await self.__qtsAccountAuth?.clearAuth?.();
        const serverUrl = await self.__qtsRuntimeConfig.getServerUrl();
        const response = await fetch(`${serverUrl}/api/extension/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginName, password }),
        });
        let result;
        try {
          result = await response.json();
        } catch {
          sendResponse({ ok: false, error: `QTS returned an invalid response (${response.status}).` });
          return;
        }
        if (!response.ok || result.success !== true || !result.token) {
          sendResponse({ ok: false, error: result.message || 'Sign in failed.' });
          return;
        }
        const sessionUser = {
          id: result.id,
          username: result.username,
          role: result.role,
          name: result.name || result.username,
        };
        await self.__qtsAccountAuth.storeAuth(result.token, sessionUser, result.expiresAt);
        sendResponse({ ok: true, signedIn: true });
        return;
      }
      if (action === 'sign_out') {
        await self.__qtsAccountAuth?.clearAuth?.();
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
        getJdInFlightTabs.clear();
        getJdLastPageByTab.clear();
        sendResponse({ ok: true, message: 'Signed out.' });
        return;
      }
      if (action === 'cancel_status') {
        const stored = await chrome.storage.local.get([EXTENSION_STATUS_KEY]);
        const cancelledStatus = stored[EXTENSION_STATUS_KEY];
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: 'cancel' });
        getJdInFlightTabs.clear();
        getJdLastPageByTab.clear();
        if (cancelledStatus === 'get_jd' && tabId != null) {
          const result = await readGetJdResultForTab(tabId);
          if (result?.status === 'complete') await cancelGetJdReview(tabId);
        }
        const cancelledLabel = cancelledStatus === 'get_jd'
          ? 'Get JD'
          : cancelledStatus === 'generation'
            ? 'Generation'
            : cancelledStatus === 'apply'
              ? 'Apply'
              : 'Current action';
        sendResponse({
          ok: true,
          status: 'cancel',
          cancelledStatus,
          message: `${cancelledLabel} cancelled.`,
        });
        return;
      }
      if (action === 'generation' || action === 'apply') {
        sendResponse({
          ok: false,
          disabled: true,
          error: `${action === 'generation' ? 'Generation' : 'Apply'} is not enabled yet.`,
        });
        return;
      }
      if (action !== 'get_jd') {
        sendResponse({ ok: false, error: 'Unknown QTS action.' });
        return;
      }
      if (tabId == null) {
        sendResponse({ ok: false, error: 'Get JD must be started from a web page.' });
        return;
      }
      const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
      if (!token) {
        sendResponse({ ok: false, authRequired: true, error: 'Sign in before starting Get JD.' });
        return;
      }
      await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: 'get_jd' });
      getJdLastPageByTab.clear();
      enableGetJdForTab(tabId).catch((error) => {
        console.error('[QTS Get JD] Could not start page monitoring:', error);
      });
      sendResponse({
        ok: true,
        status: 'get_jd',
        message: "Let's start finding Your Remote Job!",
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not run this QTS action.',
    }));
    return true;
  }
  if (msg.type === 'GET_JD_PREVIEW') {
    (async () => {
      const tabId = Number.isInteger(msg.tabId) ? msg.tabId : null;
      if (tabId == null) {
        sendResponse({ ok: false, error: 'Open a web page before starting Get JD.' });
        return;
      }
      const extraction = await extractJobFromTab(tabId);
      if (extraction.error) {
        sendResponse({ ok: false, error: extraction.error });
        return;
      }
      const details = normalizeDetectedJobData(
        extraction.data,
        extraction.url || extraction.tab?.url,
      );
      sendResponse({
        ok: true,
        job: {
          title: details.title,
          company: details.company,
          jobUrl: details.url,
          description: details.description,
          country: details.country,
          employmentType: details.employmentType,
          workplaceType: details.workplaceType,
          salary: details.salary,
        },
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not extract this page.',
    }));
    return true;
  }
  if (msg.type === 'QTS_CLOSE_SIGN_IN_PANEL') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'The sign-in page is unavailable.' });
      return false;
    }
    chrome.tabs.sendMessage(tabId, { type: 'QTS_CLOSE_CAPTURE_PANEL' })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'GET_JD_PAGE_RESULT') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'Get JD review must be requested from a web page.' });
      return false;
    }
    readGetJdResultForTab(tabId)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not load the current job review.',
      }));
    return true;
  }
  if (msg.type === 'UPDATE_GET_JD_SELECTION') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'Candidate selection must come from a web page.' });
      return false;
    }
    updateGetJdSelection(tabId, msg.profileIds)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not update the candidate selection.',
      }));
    return true;
  }
  if (msg.type === 'SAVE_GET_JD_SELECTION') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'Saving candidates must come from a web page.' });
      return false;
    }
    saveGetJdSelection(tabId, msg.profileIds)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not save the selected candidates.',
      }));
    return true;
  }
  if (msg.type === 'CANCEL_GET_JD_REVIEW') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'Cancelling the review must come from a web page.' });
      return false;
    }
    cancelGetJdReview(tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not cancel this review.',
      }));
    return true;
  }
  if (msg.type === 'SET_EXTENSION_STATUS') {
    (async () => {
      const status = msg.status === 'get_jd' ? 'get_jd' : null;
      if (status === 'get_jd') {
        if (!self.__qtsRuntimeConfig.isFeatureEnabled('geminiEvaluation')) {
          await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
          sendResponse({
            ok: false,
            disabled: true,
            error: 'Gemini evaluation is paused. Use the in-page Get JD preview.',
          });
          return;
        }
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: status });
        enableGetJdForTab(Number.isInteger(msg.tabId) ? msg.tabId : null)
          .catch((error) => {
            console.error('[QTS Get JD] Could not start current-page classification:', error);
          });
        if (Number.isInteger(msg.tabId)) {
          chrome.tabs.sendMessage(msg.tabId, { type: 'QTS_CLOSE_CAPTURE_PANEL' }).catch(() => {});
        }
      } else {
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
        getJdLastPageByTab.clear();
      }
      sendResponse({ ok: true, status });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not update extension status.',
    }));
    return true;
  }
  if (msg.type === 'QTS_SCANNER_CHATGPT_PROGRESS') {
    const tabId = sender.tab?.id;
    if (tabId == null || !String(msg.taskId || '').trim()) {
      sendResponse({ ok: false, error: 'Scanner ChatGPT progress is missing its task or tab.' });
      return false;
    }
    showScannerChatGptStatus(
      tabId,
      String(msg.taskId),
      String(msg.phase || 'scanner-sending'),
      String(msg.message || 'Sending Scanner prompt…')
    )
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.warn('[QTS Scanner] Could not update the ChatGPT progress card:', error);
        sendResponse({ ok: false, error: error?.message || 'Could not update ChatGPT progress.' });
      });
    return true;
  }
  if (msg.type === 'GET_GLOBAL_TEXT_HIGHLIGHTS') {
    refreshGlobalTextHighlights()
      .then(sendResponse)
      .catch((error) => {
        console.error('[QTS text highlights] Could not refresh shared rules:', error);
        sendResponse({ success: false, message: error?.message || 'Could not load shared text highlights.' });
      });
    return true;
  }
  if (msg.type === 'AUTH_SESSION_EXPIRED') {
    disarmJobPageActivity();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'QTS_CLOSE_PAGE_TAB') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'The requesting page tab is unavailable.' });
      return false;
    }
    chrome.tabs.remove(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || 'Could not close the page tab.' }));
    return true;
  }
  if (msg.type === 'SEND_SCANNER_CHATGPT_TASK') {
    const keepalive = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {});
    }, 3000);
    runScannerChatGptTask(msg)
      .then((result) => notifyGptDispatchFinished(result))
      .catch((error) => notifyGptDispatchFinished({
        taskId: msg.taskId,
        ok: false,
        error: error?.message || 'Could not complete the ChatGPT Scanner handoff.',
        handoff: {
          ok: false,
          sent: false,
          error: error?.message || 'Could not complete the ChatGPT Scanner handoff.',
        },
      }))
      .finally(() => clearInterval(keepalive));
    sendResponse({ ok: true, started: true });
    return false;
  }
  if (msg.type === 'EXTRACT_JOB') {
    (async () => {
      let tab = null;
      if (msg.tabId) tab = await getTab(msg.tabId);
      if (!tab && lastSourceTabId) tab = await getTab(lastSourceTabId);
      if (!tab) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tab = activeTab;
      }
      if (!tab?.id) {
        sendResponse({ error: 'No active tab' });
        return;
      }

      const result = await extractJobFromTab(tab.id);
      if (result.error) {
        sendResponse({
          error: result.error,
          manualOnly: result.manualOnly,
          url: tab.url,
          title: tab.title,
        });
        return;
      }

      const pageUrl = result.url || tab.url;
      const entry = buildDetectedJobEntry(tab.id, pageUrl, result.data);
      await setDetectedJobForTab(entry);

      sendResponse({
        data: result.data,
        url: pageUrl,
        title: tab.title,
        detected: entry.valid,
        detectMessage: entry.valid ? DETECT_SUCCESS_MESSAGE : DETECT_FAIL_MESSAGE,
      });
    })().catch((e) => sendResponse({ error: e.message || 'Extraction failed.', manualOnly: true }));
    return true;
  }

  if (msg.type === 'REGISTER_JOB_TAB') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      const jobTabId = await resolveJobTabIdForCapture(tabId);
      if (jobTabId) {
        lastSourceTabId = jobTabId;
        await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: jobTabId });
      }
      sendResponse({ ok: true, tabId: jobTabId || tabId || null });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'GET_CURRENT_TAB_URL') {
    (async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      sendResponse({
        url: activeTab?.url,
        title: activeTab?.title,
        tabId: activeTab?.id ?? null,
      });
    })().catch(() => sendResponse({ url: null, title: null, tabId: null }));
    return true;
  }

  if (msg.type === 'URL_CHANGED') {
    const tabId = sender.tab?.id;
    if (tabId && msg.url) maybeTrackAutoOpen(tabId, msg.url);
    return false;
  }

  if (msg.type === 'APPLY_MODAL_CHANGED') {
    const tabId = sender.tab?.id;
    const url = msg.url || sender.tab?.url;
    if (!tabId || !url || !isTemplateCandidateUrl(url)) return false;
    (async () => {
      if (!(await isAutoApplyArmed())) return;
      detectApplyTemplateOnTab(tabId, url).catch(() => {});
    })().catch(() => {});
    return false;
  }

  if (msg.type === 'JOB_PANEL_CHANGED') {
    const tabId = sender.tab?.id;
    const url = msg.url || sender.tab?.url;
    if (!tabId || !url || !isExtractablePageUrl(url) || isIgnoredSite(url)) return false;
    (async () => {
      if (!(await isAutoApplyArmed())) return;
      lastAutoDetectKeyByTab.delete(tabId);
      lastAutoPipelineKeyByTab.delete(tabId);
      await autoDetectJob(tabId, url).catch(() => {});
    })().catch(() => {});
    return false;
  }

  if (msg.type === 'SET_CUSTOM_GPT_CONFIG') {
    self.__qtsCustomGpt?.applyCustomGptConfig?.(msg.customGpt || null);
    if (!msg.customGpt?.url) {
      chrome.storage.local.remove([GPT_TAB_STORAGE_KEY]);
      stopGptPollAndApply();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'DISCOVER_APPLICATION_FORM') {
    (async () => {
      if (msg.managerApply === true) {
        const applyAccess = await verifyManagerApplyAccess();
        if (!applyAccess.allowed) {
          sendResponse({ success: false, error: applyAccess.message });
          return;
        }
      } else if (msg.managerScanner === true) {
        const scannerAccess = await verifyManagerScannerAccess();
        if (!scannerAccess.allowed) {
          sendResponse({ success: false, error: scannerAccess.message });
          return;
        }
      }
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      const preDetectedTemplate = await getApplyTemplateForTab(tabId);
      sendResponse(await discoverApplicationFormOnTab(tabId, {
        openApplyForm: msg.openApplyForm,
        expandDynamic: msg.expandDynamic,
        dynamicWaitMs: msg.dynamicWaitMs || 4000,
        preDetectedTemplate,
        mode: msg.mode,
        allowTestNavigation: msg.allowTestNavigation,
        readOnly: msg.readOnly,
      }));
    })().catch((e) => sendResponse({ error: e.message || 'Form discovery failed.' }));
    return true;
  }

  if (msg.type === 'ADVANCE_MANAGER_APPLICATION_STEP') {
    advanceManagerApplicationStepOnTab(msg.tabId || sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({
        success: false,
        error: error?.message || 'Could not safely advance the application step.',
      }));
    return true;
  }

  if (msg.type === 'CHECK_APPLICATION_SUBMISSION_STATUS') {
    (async () => {
      const applyAccess = await verifyManagerApplyAccess();
      if (!applyAccess.allowed) {
        sendResponse({ success: false, error: applyAccess.message });
        return;
      }
      const tab = await getTab(msg.tabId || sender.tab?.id);
      if (!tab?.id || !isExtractablePageUrl(tab.url)) {
        sendResponse({ success: false, error: 'The application page is unavailable for confirmation checking.' });
        return;
      }
      const [confirmation] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => /\b(application (was )?submitted|application received|thanks for applying|we received your application|successfully applied)\b/i
          .test(document.body?.innerText || ''),
      });
      sendResponse({ success: true, submissionConfirmed: confirmation?.result === true });
    })().catch((error) => sendResponse({
      success: false,
      error: error?.message || 'Could not check the application submission status.',
    }));
    return true;
  }

  if (msg.type === 'CAPTURE_APPLICATION_STEP') {
    (async () => {
      if (msg.managerApply === true) {
        const applyAccess = await verifyManagerApplyAccess();
        if (!applyAccess.allowed) {
          sendResponse({ success: false, error: applyAccess.message });
          return;
        }
      } else if (msg.managerScanner === true) {
        const scannerAccess = await verifyManagerScannerAccess();
        if (!scannerAccess.allowed) {
          sendResponse({ success: false, error: scannerAccess.message });
          return;
        }
      }
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ success: false, error: 'No source tab is available for Scanner verification.' });
        return;
      }
      sendResponse(await captureApplicationStepOnTab(tabId));
    })().catch((error) => {
      sendResponse({ success: false, error: error?.message || 'Scanner verification capture failed.' });
    });
    return true;
  }

  if (msg.type === 'SAVE_SCANNER_STEP_EVIDENCE') {
    (async () => {
      if (msg.managerScanner === true) {
        const scannerAccess = await verifyManagerScannerAccess();
        if (!scannerAccess.allowed) {
          sendResponse({ success: false, message: scannerAccess.message });
          return;
        }
      }
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ success: false, message: 'No source tab is available to save Scanner evidence.' });
        return;
      }
      sendResponse(await saveScannerStepEvidenceOnTab(tabId, msg.metadata || {}, msg.fields || []));
    })().catch((error) => {
      sendResponse({ success: false, message: error?.message || 'Verified Scanner evidence could not be saved.' });
    });
    return true;
  }

  if (msg.type === 'GET_APPLY_TEMPLATE') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab' });
        return;
      }
      let detection = await getApplyTemplateForTab(tabId);
      const tab = await getTab(tabId);
      if (!detection && tab?.url && isTemplateCandidateUrl(tab.url)) {
        detection = await detectApplyTemplateOnTab(tabId, tab.url);
      }
      sendResponse({ success: true, detection });
    })().catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'DETECT_APPLY_TEMPLATE') {
    (async () => {
      const tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab' });
        return;
      }
      const tab = await getTab(tabId);
      const detection = await detectApplyTemplateOnTab(tabId, tab?.url);
      sendResponse({ success: true, detection });
    })().catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SCAN_APPLICATION_FORM') {
    (async () => {
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      sendResponse(await scanApplicationFormOnTab(tabId, {
        openApplyForm: msg.openApplyForm !== false,
      }));
    })().catch((e) => sendResponse({ error: e.message || 'Form scan failed.' }));
    return true;
  }

  if (msg.type === 'FILL_APPLICATION_FORM') {
    (async () => {
      if (msg.managerApply === true) {
        const applyAccess = await verifyManagerApplyAccess();
        if (!applyAccess.allowed) {
          sendResponse({ success: false, error: applyAccess.message });
          return;
        }
      } else if (msg.managerScanner === true) {
        const scannerAccess = await verifyManagerScannerAccess();
        if (!scannerAccess.allowed) {
          sendResponse({ success: false, error: scannerAccess.message });
          return;
        }
      }
      let tabId = msg.tabId || lastSourceTabId;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = activeTab?.id;
      }
      if (!tabId) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      sendResponse(await fillApplicationFormOnTab(tabId, msg.fields || [], {
        mode: msg.mode,
        allowUserApprovedFill: msg.allowUserApprovedFill,
      }));
    })().catch((e) => sendResponse({ error: e.message || 'Form fill failed.' }));
    return true;
  }

  if (msg.type === 'POLL_AND_APPLY_GPT_TASK') {
    startGptPollAndApply({
      taskId: msg.taskId,
      applicationId: msg.applicationId,
      jobTabId: msg.jobTabId || lastSourceTabId,
    });
    sendResponse({ ok: true, started: true });
    return false;
  }

  if (msg.type === 'STOP_GPT_POLL_AND_APPLY') {
    stopGptPollAndApply();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'APPLY_GPT_PACKAGE_TO_TAB') {
    (async () => {
      try {
        const applied = await applyGptPackageToJobTab(msg.applicationId, msg.jobTabId || lastSourceTabId);
        sendResponse({ ok: true, ...applied });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Could not apply GPT package.' });
      }
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === 'SEND_GPT_TASK') {
    const run = async () => executeSendGptTask(msg);

    if (msg.async !== false) {
      run()
        .then((result) => notifyGptDispatchFinished({ taskId: msg.taskId, applicationId: msg.applicationId, ...result }))
        .catch((e) => notifyGptDispatchFinished({
          taskId: msg.taskId,
          applicationId: msg.applicationId,
          ok: false,
          error: e.message || 'Could not send PROCESS_TASK.',
          handoff: { ok: false, sent: false, error: e.message || 'Could not send PROCESS_TASK.' },
        }));
      sendResponse({ ok: true, started: true });
      return false;
    }

    run()
      .then((result) => sendResponse({ ...result }))
      .catch((e) => sendResponse({ ok: false, error: e.message || 'Could not send PROCESS_TASK.' }));
    return true;
  }

  if (msg.type === 'DISPATCH_GPT_TASK') {
    const runDispatch = async () => {
      const taskId = msg.taskId;
      const prompt = msg.prompt || self.__qtsCustomGpt?.buildPrompt(taskId);
      if (!taskId) {
        return { ok: false, error: 'taskId is required.' };
      }
      const result = await dispatchCustomGptTask(taskId, prompt, msg.jobTabId, {
        applicationId: msg.applicationId,
        pollAndApply: msg.pollAndApply,
        focus: msg.focus === true,
        notify: Boolean(msg.async),
      });
      if (msg.async) {
        notifyGptDispatchFinished({
          taskId,
          applicationId: msg.applicationId,
          ...result,
        });
      }
      return result;
    };

    if (msg.async) {
      runDispatch().catch((e) => {
        notifyGptDispatchFinished({
          taskId: msg.taskId,
          applicationId: msg.applicationId,
          ok: false,
          error: e.message || 'Could not dispatch GPT task.',
          handoff: { ok: false, sent: false, error: e.message || 'Could not dispatch GPT task.' },
        });
      });
      sendResponse({ ok: true, started: true });
      return false;
    }

    runDispatch()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message || 'Could not dispatch GPT task.' }));
    return true;
  }

  if (msg.type === 'START_AUTO_APPLY_ON_TAB') {
    (async () => {
      const stored = await chrome.storage.local.get([JOB_SOURCE_TAB_STORAGE_KEY]);
      const jobTabId = msg.jobTabId || stored[JOB_SOURCE_TAB_STORAGE_KEY] || lastSourceTabId;
      if (!jobTabId) {
        sendResponse({ ok: false, error: 'No job tab found. Open a job listing first.' });
        return;
      }
      await startAutoApplyOnJobTab(jobTabId);
      sendResponse({ ok: true, tabId: jobTabId });
    })().catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (msg.type === 'RESET_AUTO_PIPELINE_STATE') {
    disarmJobPageActivity();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'RELEASE_UI_FOR_GPT') {
    releaseUiForGptHandoff({ jobTabId: msg.jobTabId || lastSourceTabId, gptTabId: msg.gptTabId })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }

  if (msg.type === 'GPT_ALLOW_AUTO_CLICKED') {
    notifyGptPageStatus({
      taskId: gptPageWatchJob?.taskId,
      tabId: sender?.tab?.id,
      totalAllowClicks: msg.clicked || (msg.allowClicked ? 1 : 0),
      allowClicked: Boolean(msg.allowClicked || msg.clicked),
      clickedLabel: msg.clickedLabel || msg.labels?.[0],
      allowButtonCount: msg.allowButtonCount,
      hasApprovalDialog: msg.hasApprovalDialog,
      hasGetTaskContext: msg.hasGetTaskContext,
      hasSubmitTaskPackage: msg.hasSubmitTaskPackage,
      taskSaved: msg.taskSaved,
      thinking: msg.thinking,
      stoppedThinking: msg.stoppedThinking,
      snippet: msg.snippet,
      source: 'content_auto_watch',
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'STOP_GPT_APPROVAL_WATCH') {
    stopGptApprovalWatcher();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ENSURE_CUSTOM_GPT_TAB' || msg.type === 'PREWARM_CUSTOM_GPT_TAB') {
    (async () => {
      try {
        const worker = self.__qtsGptWorkerHandoff;
        if (!worker?.ensurePinnedGptTab) {
          throw new Error('GPT worker handoff module not loaded.');
        }
        const background = msg.type === 'PREWARM_CUSTOM_GPT_TAB' || msg.background !== false;
        const result = await worker.ensurePinnedGptTab({
          storageKey: GPT_TAB_STORAGE_KEY,
          focus: !background,
          preparePage: true,
          pinInBrowser: true,
        });
        sendResponse({ ...result, prewarmed: background });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Could not open Custom GPT tab.' });
      }
    })().catch((e) => sendResponse({ ok: false, error: e.message || 'Could not open Custom GPT tab.' }));
    return true;
  }

  if (msg.type === 'GET_PINNED_GPT_TAB') {
    (async () => {
      const tabId = await getPinnedGptTabId();
      sendResponse({ ok: true, tabId });
    })().catch(() => sendResponse({ ok: false, tabId: null }));
    return true;
  }
});

const AUTO_APPLY_ENABLED_KEY = 'qtsAutoApplyEnabled';

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.authToken) {
    if (!changes.authToken.newValue) {
      disarmJobPageActivity();
      chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null }).catch(() => {});
      getJdInFlightTabs.clear();
      getJdLastPageByTab.clear();
    }
    return;
  }
  if (area === 'local' && changes[AUTO_APPLY_ENABLED_KEY] && !changes[AUTO_APPLY_ENABLED_KEY].newValue) {
    disarmJobPageActivity();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  self.__qtsCustomGpt?.loadCustomGptConfigFromStorage?.().catch(() => {});
});

self.__qtsCustomGpt?.loadCustomGptConfigFromStorage?.().catch(() => {});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await getTab(activeInfo.tabId);
  const onPinnedGpt = await isPinnedGptTab(activeInfo.tabId);
  if (tab?.url && !onPinnedGpt && (await isAutoApplyArmed())) {
    maybeDetectApplyMethodOnOpen(activeInfo.tabId, tab.url);
    runDetectForActiveTab(activeInfo.tabId).catch(() => {});
    prefetchTabContext(activeInfo.tabId).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    lastAutoDetectKeyByTab.delete(tabId);
    lastAutoPipelineKeyByTab.delete(tabId);
    lastApplyMethodDetectKeyByTab.delete(tabId);
    return;
  }

  const url = changeInfo.url || tab.url;
  if (!url || !isExtractablePageUrl(url)) return;
  if (changeInfo.status === 'complete') {
    (async () => {
      if (await isAutoApplyArmed()) maybeDetectApplyMethodOnOpen(tabId, url);
      maybeTrackAutoOpen(tabId, url);
    })().catch(() => {});
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  processGetJdPage(details.tabId, details.url, details.documentId).catch((error) => {
    console.error('[QTS Get JD] Could not process the loaded page:', error);
  });
  if (isChatGptHostUrl(details.url)) return;
  injectedExtractorTabs.delete(details.tabId);
  maybePrewarmCustomGptOnJobPage(details.url);
  (async () => {
    if (!(await isAutoApplyArmed())) return;
    injectExtractors(details.tabId).catch(() => {});
    if (details.transitionQualifiers?.includes('reload') || details.transitionType === 'reload') {
      lastAutoDetectKeyByTab.delete(details.tabId);
      lastApplyMethodDetectKeyByTab.delete(details.tabId);
    }
    maybeDetectApplyMethodOnOpen(details.tabId, details.url);
  })().catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  processGetJdPage(details.tabId, details.url, details.documentId).catch((error) => {
    console.error('[QTS Get JD] Could not process the updated page:', error);
  });
  (async () => {
    if (await isAutoApplyArmed()) maybeDetectApplyMethodOnOpen(details.tabId, details.url);
    maybeTrackAutoOpen(details.tabId, details.url);
  })().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastAutoDetectKeyByTab.delete(tabId);
  capturePanelOpenPromisesByTab.delete(tabId);
  lastAutoPipelineKeyByTab.delete(tabId);
  lastApplyMethodDetectKeyByTab.delete(tabId);
  autoPipelineInFlight.delete(tabId);
  injectedExtractorTabs.delete(tabId);
  extractorInjectInFlight.delete(tabId);
  detectGenerationByTab.delete(tabId);
  removeDetectedJobForTab(tabId).catch(() => {});
  removeApplyTemplateForTab(tabId).catch(() => {});
  removeDiscoveryCheckpointForTab(tabId).catch(() => {});
  chrome.storage.local.get([GPT_TAB_STORAGE_KEY], (stored) => {
    if (stored[GPT_TAB_STORAGE_KEY] === tabId) {
      chrome.storage.local.remove(GPT_TAB_STORAGE_KEY);
    }
  });
});

function isIgnoredSite(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const ignored = new Set([
      'google.com',
      'mail.google.com',
      'docs.google.com',
      'drive.google.com',
      'youtube.com',
      'facebook.com',
      'instagram.com',
      'twitter.com',
      'x.com',
      'reddit.com',
      'amazon.com',
      'github.com',
      'stackoverflow.com',
      'chromewebstore.google.com',
      'chrome.google.com',
      'chatgpt.com',
      'chat.openai.com',
    ]);
    return ignored.has(host);
  } catch {
    return false;
  }
}

async function openCapturePanel(tabId, { toggle = false } = {}) {
  const jobTabId = await resolveJobTabIdForCapture(tabId);
  if (!jobTabId) {
    throw new Error('Open a regular webpage before opening the QTS panel.');
  }
  const tab = await getTab(jobTabId);
  if (!tab?.url || !isExtractablePageUrl(tab.url)) {
    throw new Error('QTS cannot open on this browser page.');
  }

  const pendingOpen = capturePanelOpenPromisesByTab.get(jobTabId);
  if (pendingOpen) return pendingOpen;

  const opening = (async () => {
    lastSourceTabId = jobTabId;
    await chrome.storage.local.set({ [JOB_SOURCE_TAB_STORAGE_KEY]: jobTabId });
    await chrome.scripting.executeScript({
      target: { tabId: jobTabId },
      files: [CAPTURE_PANEL_FILE],
    });
    const result = await chrome.tabs.sendMessage(jobTabId, {
      type: toggle ? 'QTS_TOGGLE_CAPTURE_PANEL' : 'QTS_SHOW_CAPTURE_PANEL',
      tabId: jobTabId,
    });
    if (!result?.ok) {
      throw new Error(result?.error || 'QTS panel did not respond.');
    }
    if (await isAutoApplyArmed()) {
      runDetectForActiveTab(jobTabId).catch(() => {});
      prefetchTabContext(jobTabId).catch(() => {});
    }
  })();
  capturePanelOpenPromisesByTab.set(jobTabId, opening);
  try {
    return await opening;
  } finally {
    if (capturePanelOpenPromisesByTab.get(jobTabId) === opening) {
      capturePanelOpenPromisesByTab.delete(jobTabId);
    }
  }
}
