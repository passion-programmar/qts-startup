// Background service worker — tab tracking, capture window, messages

importScripts(
  '../shared/page-exclusions.js',
  '../shared/job-page-detection.js',
  '../shared/tab-ownership.js',
  '../shared/runtime-config.js',
  '../shared/application-flow.js',
  '../shared/job-detect.js',
  '../shared/job-detection-url-rules.js',
  '../shared/get-jd-save-payload.js',
  '../shared/api-prefetch.js',
  '../shared/custom-gpt.js',
  '../shared/scanner-chatgpt.js',
  '../shared/generation-chatgpt.js',
  '../shared/auth-token-store.js',
  '../shared/account-auth-storage.js',
  '../shared/text-highlighting.js',
  '../shared/apply-session-store.js',
  '../shared/api-worker.js',
  '../shared/gpt-worker-handoff.js',
  '../shared/field-classifier.js',
  '../shared/candidate-matcher.js',
  '../shared/fill-policy.js',
  '../shared/auto-application-pipeline.js',
  '../shared/chatgpt-composer-handoff.js',
  '../shared/apply-answers.js',
  '../shared/apply-recipes.js',
  '../shared/apply-pdf.js',
  'apply-runner.js'
);

function isExtractablePageUrl(url) {
  if (!url || typeof url !== 'string') return false;
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
// Each Chrome has two switches: Get JD on/off, and a work slot for Generation or Apply (never both).
// EXTENSION_STATUS_KEY holds the work slot: 'generation', 'apply', 'cancel' while stopping, or null.
const EXTENSION_STATUS_KEY = 'qtsExtensionStatus';
const GET_JD_ON_KEY = 'qtsGetJdOn';
const GENERATION_IDLE_NOTICE_KEY = 'qtsGenerationIdleNoticeShown';
// Tabs and windows Generation or Apply opened; Get JD never touches them.
const tabOwnership = self.__qtsTabOwnership.createTabOwnership(chrome.storage.session);

async function isWorkflowTab(tabId, tab = null) {
  const windowId = tab?.windowId ?? (await getTab(tabId))?.windowId ?? null;
  return Boolean(await tabOwnership.ownerOf(tabId, windowId));
}
const GET_JD_RESULTS_KEY = 'qtsGetJdResults';
const MAX_GET_JD_PROFILE_SELECTION = 100;
const ACTIVE_GENERATION_JOB_KEY = 'qtsActiveGenerationJobId';
const GENERATION_BROWSER_STATE_KEY = 'qtsGenerationBrowserState';
const GENERATION_NOTICE_KEY = 'qtsGenerationNotice';
const GENERATION_QUEUE_RUN_KEY = 'qtsGenerationQueueRun';
const getJdInFlightTabs = new Set();
const getJdLastPageByTab = new Map();
const generationInFlightTabs = new Set();
const generationCancellationByTab = new Map();
let generationQueueInFlight = false;
const generationHeartbeatOkAt = new Map();
// The server lease lasts 20 minutes, so brief heartbeat outages are safe to ride out.
const GENERATION_HEARTBEAT_GRACE_MS = 5 * 60 * 1000;
// ChatGPT has this long from sending a prompt to finishing its answer.
const GENERATION_ANSWER_MAX_WAIT_MS = 3 * 60 * 1000;
// Without ChatGPT's copy button, an answer that stopped changing this long counts as finished.
const GENERATION_ANSWER_QUIET_MS = 3000;
// One pinned ChatGPT tab serves this many jobs (a new chat each), then a fresh tab takes over.
const GENERATION_JOBS_PER_CHATGPT_TAB = 10;
const GENERATION_QUEUE_ALARM = 'qts-generation-queue';
let lastSourceTabId = null;
const lastAutoDetectKeyByTab = new Map();
const CAPTURE_PANEL_FILE = 'content/capture-panel.js';
const detectGenerationByTab = new Map();
const GLOBAL_TEXT_HIGHLIGHT_REFRESH_TTL_MS = 60_000;
let globalTextHighlightRefreshPromise = null;
const PAGE_EXCLUSIONS_STORAGE_KEY = 'qtsManagerPageExclusions';
const PAGE_EXCLUSIONS_UPDATED_AT_KEY = 'qtsManagerPageExclusionsUpdatedAt';
const PAGE_EXCLUSIONS_MANAGER_ID_KEY = 'qtsManagerPageExclusionsManagerId';
const PAGE_EXCLUSIONS_REFRESH_TTL_MS = 5 * 60_000;
let pageExclusionsRefreshPromise = null;
const JOB_DETECTION_URL_RULES_STORAGE_KEY = 'qtsManagerJobDetectionUrlRules';
const JOB_DETECTION_URL_RULES_UPDATED_AT_KEY = 'qtsManagerJobDetectionUrlRulesUpdatedAt';
const JOB_DETECTION_URL_RULES_MANAGER_ID_KEY = 'qtsManagerJobDetectionUrlRulesManagerId';
const JOB_DETECTION_URL_RULES_REFRESH_TTL_MS = 5 * 60_000;
let jobDetectionUrlRulesRefreshPromise = null;
const MANAGER_FEATURES_STORAGE_KEY = 'qtsManagerExtensionFeatures';
const MANAGER_FEATURES_UPDATED_AT_KEY = 'qtsManagerExtensionFeaturesUpdatedAt';
const MANAGER_FEATURES_MANAGER_ID_KEY = 'qtsManagerExtensionFeaturesManagerId';
const MANAGER_FEATURES_REFRESH_TTL_MS = 5 * 60_000;
let managerFeaturesRefreshPromise = null;

async function getManagerExtensionFeatures(forceRefresh = false) {
  const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
  if (!manager?.id || manager.role !== 'manager') {
    return { success: false, message: 'Sign in as a Manager to check extension permissions.' };
  }
  const stored = await chrome.storage.local.get([
    MANAGER_FEATURES_STORAGE_KEY,
    MANAGER_FEATURES_UPDATED_AT_KEY,
    MANAGER_FEATURES_MANAGER_ID_KEY,
  ]);
  const cached = stored[MANAGER_FEATURES_MANAGER_ID_KEY] === manager.id
    ? stored[MANAGER_FEATURES_STORAGE_KEY]
    : null;
  const updatedAt = Number(stored[MANAGER_FEATURES_UPDATED_AT_KEY] || 0);
  const fresh = cached && updatedAt > 0 && Date.now() - updatedAt < MANAGER_FEATURES_REFRESH_TTL_MS;
  if (!forceRefresh && fresh) return { success: true, features: cached, cached: true };
  if (!forceRefresh && cached) {
    fetchManagerExtensionFeatures().catch((error) => {
      console.warn('[QTS extension] Could not refresh Manager permissions:', error);
    });
    return { success: true, features: cached, cached: true, stale: true };
  }
  return fetchManagerExtensionFeatures();
}

async function fetchManagerExtensionFeatures() {
  if (managerFeaturesRefreshPromise) return managerFeaturesRefreshPromise;
  managerFeaturesRefreshPromise = (async () => {
    const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
    if (!manager?.id || manager.role !== 'manager') {
      return { success: false, message: 'Sign in as a Manager to check extension permissions.' };
    }
    const result = await workerApiRequest('GET', '/api/extension/features/me');
    if (result.success !== true || !result.features) return result;
    await chrome.storage.local.set({
      [MANAGER_FEATURES_STORAGE_KEY]: result.features,
      [MANAGER_FEATURES_UPDATED_AT_KEY]: Date.now(),
      [MANAGER_FEATURES_MANAGER_ID_KEY]: manager.id,
    });
    return result;
  })();
  try {
    return await managerFeaturesRefreshPromise;
  } finally {
    managerFeaturesRefreshPromise = null;
  }
}

async function fetchManagerPageExclusions() {
  if (pageExclusionsRefreshPromise) return pageExclusionsRefreshPromise;
  pageExclusionsRefreshPromise = (async () => {
    const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
    if (!manager?.id || manager.role !== 'manager') {
      return {
        success: true,
        managerId: null,
        canManagePageExclusions: false,
        exclusions: [],
      };
    }
    const result = await workerApiRequest('GET', '/api/extension/page-exclusions');
    if (result.success !== true || !Array.isArray(result.exclusions)) return result;
    const exclusions = result.exclusions.filter((entry) =>
      entry && typeof entry.id === 'string' && typeof entry.url === 'string',
    );
    await chrome.storage.local.set({
      [PAGE_EXCLUSIONS_STORAGE_KEY]: exclusions,
      [PAGE_EXCLUSIONS_UPDATED_AT_KEY]: Date.now(),
      [PAGE_EXCLUSIONS_MANAGER_ID_KEY]: manager.id,
      qtsCanManagePageExclusions: result.canManagePageExclusions === true,
    });
    return { ...result, exclusions };
  })();
  try {
    return await pageExclusionsRefreshPromise;
  } finally {
    pageExclusionsRefreshPromise = null;
  }
}

async function getManagerPageExclusions() {
  const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
  if (!manager?.id || manager.role !== 'manager') {
    const stored = await chrome.storage.local.get([
      PAGE_EXCLUSIONS_STORAGE_KEY,
      PAGE_EXCLUSIONS_MANAGER_ID_KEY,
    ]);
    return {
      success: true,
      managerId: stored[PAGE_EXCLUSIONS_MANAGER_ID_KEY] || null,
      canManagePageExclusions: false,
      exclusions: Array.isArray(stored[PAGE_EXCLUSIONS_STORAGE_KEY])
        ? stored[PAGE_EXCLUSIONS_STORAGE_KEY]
        : [],
      cached: true,
    };
  }
  const stored = await chrome.storage.local.get([
    PAGE_EXCLUSIONS_STORAGE_KEY,
    PAGE_EXCLUSIONS_UPDATED_AT_KEY,
    PAGE_EXCLUSIONS_MANAGER_ID_KEY,
    'qtsCanManagePageExclusions',
  ]);
  const cached = stored[PAGE_EXCLUSIONS_MANAGER_ID_KEY] === manager.id
    && Array.isArray(stored[PAGE_EXCLUSIONS_STORAGE_KEY])
    ? stored[PAGE_EXCLUSIONS_STORAGE_KEY]
    : null;
  const updatedAt = Number(stored[PAGE_EXCLUSIONS_UPDATED_AT_KEY] || 0);
  const fresh = cached && updatedAt > 0 && Date.now() - updatedAt < PAGE_EXCLUSIONS_REFRESH_TTL_MS;
  if (fresh) {
    return {
      success: true,
      managerId: manager.id,
      canManagePageExclusions: stored.qtsCanManagePageExclusions === true,
      exclusions: cached,
      cached: true,
    };
  }
  if (cached) {
    fetchManagerPageExclusions().catch((error) => {
      console.warn('[QTS job-page detection] Could not refresh detection keywords:', error);
    });
    return {
      success: true,
      managerId: manager.id,
      canManagePageExclusions: stored.qtsCanManagePageExclusions === true,
      exclusions: cached,
      cached: true,
      stale: true,
    };
  }
  return fetchManagerPageExclusions();
}

async function savePageExclusionsResponse(result) {
  if (result.success !== true || !Array.isArray(result.exclusions)) return result;
  const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
  if (!manager?.id || result.managerId !== manager.id) {
    return { success: false, message: 'The page exclusion response belongs to a different Manager.' };
  }
  const exclusions = result.exclusions.filter((entry) =>
    entry && typeof entry.id === 'string' && typeof entry.url === 'string',
  );
  await chrome.storage.local.set({
    [PAGE_EXCLUSIONS_STORAGE_KEY]: exclusions,
    [PAGE_EXCLUSIONS_UPDATED_AT_KEY]: Date.now(),
    [PAGE_EXCLUSIONS_MANAGER_ID_KEY]: manager.id,
    qtsCanManagePageExclusions: result.canManagePageExclusions === true,
  });
  return { ...result, exclusions };
}

async function refreshManagerJobDetectionUrlRules() {
  if (jobDetectionUrlRulesRefreshPromise) return jobDetectionUrlRulesRefreshPromise;
  jobDetectionUrlRulesRefreshPromise = (async () => {
    const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
    if (!manager?.id || manager.role !== 'manager') {
      return { success: false, message: 'Sign in as a Manager to load job-detection URL rules.' };
    }
    const result = await workerApiRequest('GET', '/api/extension/job-detection-url-rules');
    if (result.success !== true || result.managerId !== manager.id || !Array.isArray(result.rules)) {
      return result.success === true
        ? { success: false, message: 'The URL-rule response belongs to a different Manager.' }
        : result;
    }
    const rules = result.rules.filter((entry) =>
      entry && typeof entry.id === 'string' && typeof entry.url === 'string',
    );
    await chrome.storage.local.set({
      [JOB_DETECTION_URL_RULES_STORAGE_KEY]: rules,
      [JOB_DETECTION_URL_RULES_UPDATED_AT_KEY]: Date.now(),
      [JOB_DETECTION_URL_RULES_MANAGER_ID_KEY]: manager.id,
      qtsCanManageJobDetectionUrlRules: result.canManageJobDetectionUrlRules === true,
    });
    return { ...result, rules };
  })();
  try {
    return await jobDetectionUrlRulesRefreshPromise;
  } finally {
    jobDetectionUrlRulesRefreshPromise = null;
  }
}

async function getCachedManagerJobDetectionUrlRules() {
  const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
  if (!manager?.id || manager.role !== 'manager') return [];
  const stored = await chrome.storage.local.get([
    JOB_DETECTION_URL_RULES_STORAGE_KEY,
    JOB_DETECTION_URL_RULES_UPDATED_AT_KEY,
    JOB_DETECTION_URL_RULES_MANAGER_ID_KEY,
  ]);
  const managerMatches = stored[JOB_DETECTION_URL_RULES_MANAGER_ID_KEY] === manager.id;
  const cachedRules = managerMatches && Array.isArray(stored[JOB_DETECTION_URL_RULES_STORAGE_KEY])
    ? stored[JOB_DETECTION_URL_RULES_STORAGE_KEY]
    : [];
  const cacheUpdatedAt = Number(stored[JOB_DETECTION_URL_RULES_UPDATED_AT_KEY]) || 0;
  if (managerMatches && cacheUpdatedAt > 0
    && Date.now() - cacheUpdatedAt < JOB_DETECTION_URL_RULES_REFRESH_TTL_MS) {
    return cachedRules;
  }

  const result = await refreshManagerJobDetectionUrlRules();
  if (result.success === true && Array.isArray(result.rules)) return result.rules;
  if (managerMatches) {
    console.warn(
      '[QTS Get JD] Could not refresh database URL rules; using the Manager-scoped cached rules.',
      result.message || 'Unknown URL-rule refresh error.',
    );
    return cachedRules;
  }
  console.warn(
    '[QTS extension] Could not load the Manager blocked-URL rules.',
    result.message || 'Unknown URL-rule refresh error.',
  );
  return [];
}

function isManagerBlockedUrl(url, rules) {
  return rules.some((rule) =>
    self.__qtsJobDetectionUrlRules.jobDetectionUrlRuleMatches(url, rule.url),
  );
}

async function isPageBlockedForManager(url) {
  return isManagerBlockedUrl(url, await getCachedManagerJobDetectionUrlRules());
}

const JOB_PAGE_TEXT_FILE = 'shared/job-page-text.js';

// Job boards that companies embed in their own careers pages.
const JOB_BOARD_FRAME_HOST = /(?:^|\.)(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|icims\.com|jobvite\.com|smartrecruiters\.com|workable\.com|recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr|applytojob\.com|personio\.(?:de|com)|rippling\.com)$/i;
const JOB_BOARD_FRAME_MIN_TEXT = 300;
// A description page read in place of an apply form must hold more than a form would.
const APPLY_DESCRIPTION_MIN_TEXT = 500;

async function readJobTextInFrames(tabId, frameIds) {
  const target = { tabId, frameIds };
  await chrome.scripting.executeScript({ target, files: [JOB_PAGE_TEXT_FILE] });
  const results = await chrome.scripting.executeScript({
    target,
    func: () => String(globalThis.__qtsReadJobPageText?.() || document.body?.innerText || ''),
  });
  return (results || []).map((entry) => String(entry?.result || ''));
}

// The text of embedded job-board frames that the page itself does not already repeat.
async function readJobBoardFrameText(tabId, pageText) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  const frameIds = (frames || [])
    .filter((frame) => {
      if (frame.frameId === 0) return false;
      try {
        return JOB_BOARD_FRAME_HOST.test(new URL(frame.url).hostname);
      } catch {
        return false;
      }
    })
    .map((frame) => frame.frameId);
  if (!frameIds.length) return '';
  const compact = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const pageCompact = compact(pageText);
  const texts = await readJobTextInFrames(tabId, frameIds).catch(() => []);
  return texts
    .filter((text) => text.length >= JOB_BOARD_FRAME_MIN_TEXT && !pageCompact.includes(compact(text).slice(0, 200)))
    .join('\n\n');
}

// The job's text, shown or collapsed, without the site's header, footer, menus, or cookie banners,
// with any embedded job board's text after it.
async function readVisiblePageText(tabId) {
  await waitForJobText(tabId);
  const [pageText = ''] = await readJobTextInFrames(tabId, [0]);
  const frameText = await readJobBoardFrameText(tabId, pageText);
  return frameText ? `${pageText}\n\nJob from the embedded job board:\n${frameText}` : pageText;
}

// Pages that build the job with scripts (Workable) show only their cookie banner for a few seconds
// before the job appears. The job reader leaves the banner out, so while it finds almost nothing,
// wait for the job instead of sending Gemini the banner. A page with an embedded job board does not
// wait: its job is read from the frame.
const JOB_TEXT_WAIT_MS = 12_000;

async function waitForJobText(tabId) {
  const target = { tabId, frameIds: [0] };
  const deadline = Date.now() + JOB_TEXT_WAIT_MS;
  await chrome.scripting.executeScript({ target, files: [JOB_PAGE_TEXT_FILE] }).catch(() => {});
  for (;;) {
    const [result] = await chrome.scripting.executeScript({
      target,
      func: (frameHostSource) => {
        const frameHost = new RegExp(frameHostSource, 'i');
        const hasJobBoardFrame = [...document.querySelectorAll('iframe[src]')].some((frame) => {
          try {
            return frameHost.test(new URL(frame.src).hostname);
          } catch {
            return false;
          }
        });
        return { length: String(globalThis.__qtsReadJobPageText?.() || '').length, hasJobBoardFrame };
      },
      args: [JOB_BOARD_FRAME_HOST.source],
    }).catch(() => []);
    const state = result?.result;
    if (!state || state.hasJobBoardFrame || state.length >= JOB_BOARD_FRAME_MIN_TEXT || Date.now() > deadline) return;
    await sleep(1000);
  }
}

// Background tabs Get JD opens to read a description page; Get JD itself never runs in them.
const getJdHelperTabs = new Set();
const HELPER_TAB_LOAD_TIMEOUT_MS = 15_000;

// Reads a page that builds its job with scripts (Workable) in a background tab next to the job tab,
// then closes that tab.
async function readJobTextInBackgroundTab(openerTab, url) {
  let helperTabId = null;
  try {
    const helper = await chrome.tabs.create({
      url,
      active: false,
      windowId: openerTab.windowId,
      index: openerTab.index + 1,
      openerTabId: openerTab.id,
    });
    helperTabId = helper.id;
    getJdHelperTabs.add(helperTabId);
    const deadline = Date.now() + HELPER_TAB_LOAD_TIMEOUT_MS;
    while ((await getTab(helperTabId))?.status !== 'complete') {
      if (Date.now() > deadline) return '';
      await sleep(250);
    }
    const target = { tabId: helperTabId, frameIds: [0] };
    await chrome.scripting.executeScript({ target, func: waitForPageToSettleInPage, args: [700, 6000] });
    await waitForJobText(helperTabId);
    const [text = ''] = await readJobTextInFrames(helperTabId, [0]);
    return text;
  } catch {
    return '';
  } finally {
    if (helperTabId != null) {
      await chrome.tabs.remove(helperTabId).catch(() => {});
      getJdHelperTabs.delete(helperTabId);
    }
  }
}

// Get JD's job text. An apply-form page (Lever, Workable, PeopleForce) is read from its description
// page instead: fetched in place when the site sends the job in its HTML, otherwise loaded in a
// background tab. applyFormOnly says neither worked, with the description's address to open.
async function readGetJdJobText(tabId, url) {
  const descriptionUrl = self.__qtsJobPageDetection.descriptionUrlForApplyPage(url);
  if (descriptionUrl) {
    const target = { tabId, frameIds: [0] };
    await chrome.scripting.executeScript({ target, files: [JOB_PAGE_TEXT_FILE] });
    const [result] = await chrome.scripting.executeScript({
      target,
      func: (address) => globalThis.__qtsReadJobPageTextFrom?.(address).catch(() => '') ?? '',
      args: [descriptionUrl],
    }).catch(() => []);
    let descriptionText = String(result?.result || '');
    if (descriptionText.length < APPLY_DESCRIPTION_MIN_TEXT) {
      const tab = await getTab(tabId);
      if (tab) descriptionText = await readJobTextInBackgroundTab(tab, descriptionUrl);
    }
    if (descriptionText.length >= APPLY_DESCRIPTION_MIN_TEXT) {
      return { text: descriptionText, descriptionUrl, applyFormOnly: false };
    }
    return { text: '', descriptionUrl, applyFormOnly: true };
  }
  return { text: await readVisiblePageText(tabId), descriptionUrl: '', applyFormOnly: false };
}

// Runs in the page. Resolves once the DOM has been quiet for quietMs (or after maxMs),
// so single-page sites have rendered the job before it is read.
function waitForPageToSettleInPage(quietMs, maxMs) {
  return new Promise((resolve) => {
    let quietTimer = null;
    let finished = false;
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    function finish() {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      resolve(true);
    }
    const maxTimer = setTimeout(finish, maxMs);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    quietTimer = setTimeout(finish, quietMs);
  });
}

// Runs in the page, after JOB_PAGE_TEXT_FILE. Collects the job text, the visible text (closed-posting
// notices count only when shown), and the structural job signals.
function collectJobPageSnapshotInPage() {
  const visibleText = String(document.body?.innerText || document.documentElement?.innerText || '').slice(0, 2_000_000);
  const text = String(globalThis.__qtsReadJobPageText?.() || visibleText);
  // A browser check (Cloudflare and similar) or a sign-in page shown in place of the job.
  const shortPage = visibleText.trim().length < 1500;
  const browserCheck = /^just a moment/i.test(document.title)
    || Boolean(document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, .cf-turnstile, [name="cf-turnstile-response"]'))
    || (shortPage && /\b(?:verify(?:ing)? you are (?:a )?human|checking your browser|checking if the site connection is secure)\b/i.test(visibleText));
  const signInPage = shortPage && (
    Boolean(document.querySelector('input[type="password"]'))
    || /\/(?:log-?in|sign-?in)(?:[/?#]|$)/i.test(location.pathname)
  );
  const readText = (element) => String(element?.innerText || element?.textContent || '').trim();
  const hasJobPostingData = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .some((script) => /"@type"\s*:\s*(?:\[[^\]]*)?"(?:https?:\/\/schema\.org\/)?JobPosting"/i.test(script.textContent || ''))
    || Boolean(document.querySelector('[itemtype*="schema.org/JobPosting" i]'));
  const headingPattern = /^(?:key |main |your |the |job |role )?(responsibilities|requirements|qualifications|preferred qualifications|minimum qualifications|basic qualifications|about the (?:role|job|position|opportunity)|what you['’]ll do|what you will do|what we['’]re looking for|what you['’]ll bring|who you are|benefits|perks|job description|role description|skills and experience)\b/i;
  const headingMatches = new Set(
    [...document.querySelectorAll('h1, h2, h3, h4, h5, strong, b, dt, [role="heading"]')]
      .slice(0, 600)
      .map(readText)
      .filter((value) => value && value.length <= 80)
      .map((value) => value.match(headingPattern)?.[1]?.toLowerCase().replace(/’/g, "'"))
      .filter(Boolean),
  ).size;
  const applyPattern = /^(?:apply|apply now|apply here|apply online|easy apply|quick apply|apply for (?:this )?(?:job|role|position)|submit (?:your )?application|start (?:your )?application|i['’]m interested)$/i;
  const hasApplyControl = [...document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]')]
    .slice(0, 3000)
    .some((element) => applyPattern.test(
      (readText(element) || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
    ));
  const hasCvUpload = [...document.querySelectorAll('input[type="file"]')]
    .some((input) => /resume|r[eé]sum[eé]|\bcv\b|curriculum|pdf/i.test(
      [input.name, input.id, input.accept, input.getAttribute('aria-label')].join(' '),
    ));
  const jobLinkPattern = /\/(?:jobs?|careers?|positions?|vacanc(?:y|ies)|openings?|postings?)\/[^/?#]+|[?&](?:gh_jid|jk|currentJobId|jobId)=/i;
  const jobLinkCount = new Set(
    [...document.querySelectorAll('a[href]')]
      .slice(0, 4000)
      .map((anchor) => String(anchor.href || '').split('#')[0])
      .filter((href) => jobLinkPattern.test(href)),
  ).size;
  const hasJobDetailPane = Boolean(document.querySelector(
    '.jobs-search__job-details, .jobs-details, .job-view-layout, #jobsearch-ViewjobPaneWrapper, .jobsearch-JobComponent, [data-testid="jobsearch-ViewjobPaneWrapper"]',
  ));
  // An embedded job board's text is not part of this page's innerText, so the frame itself counts as a signal.
  const hasJobBoardFrame = [...document.querySelectorAll('iframe[src]')].some((frame) => (
    /^https:\/\/(?:[^/]+\.)?(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|icims\.com|jobvite\.com|smartrecruiters\.com|workable\.com|recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr|applytojob\.com|personio\.(?:de|com)|rippling\.com)\//i
      .test(frame.src)
  ));
  return { url: location.href, text, visibleText, blocked: browserCheck || signInPage, hasJobPostingData, headingMatches, hasApplyControl, hasCvUpload, jobLinkCount, hasJobDetailPane, hasJobBoardFrame };
}

async function readJobPageSnapshot(tabId, settle = null) {
  const target = { tabId, frameIds: [0] };
  if (settle) {
    await chrome.scripting.executeScript({ target, func: waitForPageToSettleInPage, args: [settle.quietMs, settle.maxMs] });
  }
  await chrome.scripting.executeScript({ target, files: [JOB_PAGE_TEXT_FILE] });
  const [result] = await chrome.scripting.executeScript({ target, func: collectJobPageSnapshotInPage });
  return result?.result || null;
}

async function evaluateJobPageForManager(tabId, settle = null) {
  const keywords = await getManagerPageExclusions();
  const snapshot = await readJobPageSnapshot(tabId, settle);
  if (!snapshot) return null;
  return self.__qtsJobPageDetection.evaluateJobPage(
    snapshot,
    keywords.success === true ? keywords.exclusions || [] : [],
    self.__qtsPageExclusions.countPageDetectionKeywordMatches,
  );
}

async function isPageDetectedAsJobForManager(tabId) {
  try {
    return (await evaluateJobPageForManager(tabId))?.isJobPage === true;
  } catch {
    return false;
  }
}

// Late-loading content is the main cause of missed jobs, so a page is checked after it
// settles and again at +2 s and +5 s before it is treated as not a job page.
const GET_JD_DETECTION_ATTEMPTS = [
  { delayMs: 0, quietMs: 700, maxMs: 6000 },
  { delayMs: 2000, quietMs: 500, maxMs: 2500 },
  { delayMs: 5000, quietMs: 500, maxMs: 2500 },
];

// Returns { status: 'pass' | 'rejected' | 'cancelled', reason, listPage }. A rejection keeps the last
// check's reason (closed, not-loaded, uncertain, or not-job); cancelled means a newer navigation,
// Get JD stopped, or an unreadable page.
async function detectGetJdJobPage(tabId, url, pageKey) {
  const stillCurrent = async () => getJdLastPageByTab.get(tabId) === pageKey
    && (await getTab(tabId))?.url === url
    && await isGetJdActive();
  let evaluation = null;
  for (const attempt of GET_JD_DETECTION_ATTEMPTS) {
    if (attempt.delayMs) await sleep(attempt.delayMs);
    if (!(await stillCurrent())) return { status: 'cancelled' };
    try {
      evaluation = await evaluateJobPageForManager(tabId, attempt);
    } catch {
      return { status: 'cancelled' };
    }
    if (!(await stillCurrent())) return { status: 'cancelled' };
    if (evaluation?.isJobPage) return { status: 'pass', reason: evaluation.reason, listPage: evaluation.listPage === true };
    if (evaluation?.reason === 'closed') break;
  }
  return { status: 'rejected', reason: evaluation?.reason || 'not-job', listPage: evaluation?.listPage === true };
}

async function buildManagerDetectedJobEntry(tabId, pageUrl, data) {
  const pageType = classifyJobPageUrl(pageUrl, true);
  return buildDetectedJobEntry(tabId, pageUrl, data, pageType);
}

async function saveManagerJobDetectionUrlRulesResponse(result) {
  if (result.success !== true || !Array.isArray(result.rules)) return result;
  const manager = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
  if (!manager?.id || result.managerId !== manager.id) {
    return { success: false, message: 'The URL-rule response belongs to a different Manager.' };
  }
  const rules = result.rules.filter((entry) =>
    entry && typeof entry.id === 'string' && typeof entry.url === 'string',
  );
  await chrome.storage.local.set({
    [JOB_DETECTION_URL_RULES_STORAGE_KEY]: rules,
    [JOB_DETECTION_URL_RULES_UPDATED_AT_KEY]: Date.now(),
    [JOB_DETECTION_URL_RULES_MANAGER_ID_KEY]: manager.id,
    qtsCanManageJobDetectionUrlRules: result.canManageJobDetectionUrlRules === true,
  });
  return { ...result, rules };
}

async function notifyPageUrlAccess(tabId, url) {
  const rules = await getCachedManagerJobDetectionUrlRules();
  await chrome.tabs.sendMessage(tabId, {
    type: 'QTS_PAGE_URL_CHANGED',
    excluded: isManagerBlockedUrl(url, rules),
  }).catch(() => {});
}

async function recheckLoadedPagesForManagerJobRules() {
  if (!(await isGetJdActive())) return;
  const tabs = await chrome.tabs.query({ status: 'complete' });
  for (const tab of tabs) {
    if (!tab.id || !/^https?:/i.test(tab.url || '')) continue;
    getJdLastPageByTab.delete(tab.id);
    processGetJdPage(tab.id, tab.url, `rules:${Date.now()}`).catch((error) => {
      console.warn('[QTS job-page matches] Could not check an open page:', error);
    });
  }
}

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

  const result = await workerApiRequest('GET', '/api/extension/highlights');
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
  const result = await workerApiRequest('GET', '/api/extension/features/me');
  return result.success && result.features?.canUseScanner === true
    ? { allowed: true }
    : {
      allowed: false,
      message: result.message || 'Ask your Super Admin for job-site Scanner access.',
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
  'content/extractors/job-sites.js',
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

// Company career pages often embed a Greenhouse, Lever, Workday or similar board in a frame.
const EMBEDDED_JOB_BOARD_URL = /^https:\/\/(?:[^/]+\.)?(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|icims\.com|jobvite\.com|smartrecruiters\.com|workable\.com|recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr|applytojob\.com|personio\.(?:de|com)|rippling\.com)\//i;
const EMBEDDED_JOB_FIELDS = ['title', 'company', 'description', 'location', 'country', 'employmentType', 'workplaceType', 'salary'];

// Reads the job from an embedded job-board frame when the page itself does not show it.
async function extractJobFromEmbeddedBoard(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  for (const frame of frames || []) {
    if (frame.frameId === 0 || !EMBEDDED_JOB_BOARD_URL.test(frame.url || '')) continue;
    try {
      const target = { tabId, frameIds: [frame.frameId] };
      const [probe] = await chrome.scripting.executeScript({
        target,
        func: () => typeof window.__extractJobData === 'function',
      });
      if (!probe?.result) await chrome.scripting.executeScript({ target, files: EXTRACTOR_FILES });
      const [result] = await chrome.scripting.executeScript({
        target,
        func: () => (window.__extractJobData ? window.__extractJobData() : null),
      });
      if (result?.result?.title) return result.result;
    } catch {
      // The frame is not readable (navigated away or restricted); try the next one.
    }
  }
  return null;
}

async function extractJobFromTab(tabId, { requireCompany = false } = {}) {
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
      if (
        isValidDetectedJob(data, tab.url)
        && (!requireCompany || normalizeDetectedJobData(data, tab.url).company)
      ) {
        break;
      }
    }
    if (
      !isValidDetectedJob(data, tab.url)
      || (requireCompany && !normalizeDetectedJobData(data, tab.url).company)
    ) {
      const embedded = await extractJobFromEmbeddedBoard(tab.id);
      if (embedded) {
        // The frame holds the job; the page URL stays the job's address (e.g. careers?gh_jid=123).
        const merged = { ...(data || {}), url: data?.url || tab.url };
        for (const field of EMBEDDED_JOB_FIELDS) {
          if (String(embedded[field] || '').trim()) merged[field] = embedded[field];
        }
        data = merged;
      }
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

const GET_JD_PANEL_FILE = 'content/get-jd-review.js';
const getJdPanelInjections = new Map();

// The Get JD panel is large, so it is injected only into tabs that need it.
async function ensureGetJdPanel(tabId) {
  if (!getJdPanelInjections.has(tabId)) {
    getJdPanelInjections.set(tabId, (async () => {
      const target = { tabId, frameIds: [0] };
      const [probe] = await chrome.scripting.executeScript({
        target,
        func: () => typeof globalThis.__qtsInitializeGetJdReview === 'function',
      });
      // Re-running the file would redeclare its top-level bindings, so inject it only once per page.
      if (!probe?.result) {
        await chrome.scripting.executeScript({ target, files: [GET_JD_PANEL_FILE] });
      }
    })().finally(() => getJdPanelInjections.delete(tabId)));
  }
  return getJdPanelInjections.get(tabId);
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
    if (result?.status !== 'cancelled') {
      // A freshly injected panel loads the stored result itself, so a missed message below is harmless.
      await ensureGetJdPanel(tabId).catch((error) => {
        console.warn('[QTS Get JD] Could not load the review panel on this page:', error);
      });
    }
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

// Mirrors the server's per-account states; older stored results fall back to duplicateKind.
function getJdProfileState(profile) {
  if (profile?.state) return profile.state;
  if (profile?.autoSaved) return 'has_job';
  if (profile?.duplicateKind === 'applied') return 'applied';
  if (profile?.duplicateKind === 'job_list') return 'has_job';
  return 'available';
}

// Applied accounts and running Generation stay checked and cannot be unchecked.
const GET_JD_LOCKED_STATES = new Set(['applied', 'generation_running']);
// Nothing can be changed for these: locked accounts, and candidates who work at the company now.
const GET_JD_FIXED_STATES = new Set([...GET_JD_LOCKED_STATES, 'works_here']);

// Stores the checked accounts only; Save applies the difference.
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
  const allowedIds = new Set((result.profiles || [])
    .filter((profile) => getJdProfileState(profile) !== 'works_here')
    .map((profile) => profile.id));
  if (profileIds.some((id) => !allowedIds.has(id))) {
    return { ok: false, error: 'One or more selected candidates are unavailable.' };
  }
  const lockedIds = (result.profiles || [])
    .filter((profile) => GET_JD_LOCKED_STATES.has(getJdProfileState(profile)))
    .map((profile) => profile.id);
  const selectedProfileIds = [...new Set([...profileIds, ...lockedIds])];
  const updated = { ...result, selectedProfileIds, selectionModified: true, updatedAt: Date.now() };
  await saveGetJdResult(tabId, updated, false);
  return { ok: true, selectedProfileIds, result: updated };
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
    message: (result.autoSavedProfileIds || []).length > 0
      ? 'Review closed. Jobs saved automatically for matching candidates stay in Jobs.'
      : 'Review closed. Nothing was saved.',
    updatedAt: Date.now(),
  });
  return { ok: true };
}

// Applies the checkbox difference: newly checked accounts are added to the job, and
// saved accounts the Manager unchecked are removed (the server keeps applied ones).
async function saveGetJdSelection(tabId, profileIds) {
  const selection = await updateGetJdSelection(tabId, profileIds);
  if (!selection.ok) return selection;
  const result = await readGetJdResultForTab(tabId);
  const checked = new Set(selection.selectedProfileIds);
  const profiles = result.profiles || [];
  const additions = profiles.filter((profile) => getJdProfileState(profile) === 'available' && checked.has(profile.id));
  const removals = profiles.filter((profile) => getJdProfileState(profile) === 'has_job' && !checked.has(profile.id));
  if (!additions.length && !removals.length) {
    return { ok: false, error: 'No changes to save. Check new candidates or uncheck saved ones.' };
  }
  const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
  if (!token) {
    return { ok: false, error: 'Your extension session has expired. Sign in again.' };
  }

  const results = [];
  for (const profile of removals) {
    const rowId = profile.rowId || profile.autoSaveJobId;
    const response = rowId
      ? await workerApiRequest('DELETE', `/api/extension/get-jd/job-accounts/${encodeURIComponent(rowId)}`)
      : { success: true };
    results.push({
      profileId: profile.id,
      name: profile.name,
      status: response.success === true ? 'removed' : response.locked === true ? 'locked' : 'failed',
      message: response.success === true
        ? 'Removed from this job.'
        : response.message || 'Could not remove this candidate from the job.',
    });
  }

  if (additions.length) {
    if (
      result.evaluationMode === 'gemini' &&
      (result.classification?.isJobPage !== true || result.classification?.isRemote !== true)
    ) {
      return { ok: false, error: 'This job did not pass validation or remote eligibility.' };
    }
    const job = self.__qtsGetJdSavePayload?.createGetJdSaveJob(result.classification, result.jobDescription);
    // Plain page text is read again right before saving, and only when there is no description.
    let pageText = '';
    if (job && !job.description) {
      pageText = (await readVisiblePageText(tabId).catch(() => '')).slice(0, 100_000).trim();
    }
    if (!job || (!job.description && !pageText)) {
      return { ok: false, error: 'The job description is missing. Run Get JD on the job page again.' };
    }
    const response = await workerApiRequest('POST', '/api/extension/get-jd/save', {
      job,
      openerUrl: await tabOpenedFrom(tabId),
      ...(pageText ? { pageText } : {}),
      profileIds: additions.map((profile) => profile.id),
      ...(result.evaluationMode === 'gemini'
        ? { evaluation: { isJobPage: result.classification.isJobPage, isRemote: result.classification.isRemote } }
        : {}),
    });
    if (response.success !== true) {
      return { ok: false, error: response.message || 'Could not save selected candidates.' };
    }
    results.push(...(response.results || []));
  }

  const count = (status) => results.filter((entry) => entry.status === status).length;
  const saveResponse = {
    results,
    savedCount: count('saved'),
    duplicateCount: count('already_exists'),
    removedCount: count('removed'),
    lockedCount: count('locked'),
    failedCount: count('failed'),
  };
  const resultByProfile = new Map(results.map((entry) => [entry.profileId, entry]));
  const updatedProfiles = profiles.map((profile) => {
    const entry = resultByProfile.get(profile.id);
    if (entry?.status === 'saved') {
      return { ...profile, state: 'has_job', rowId: entry.jobId || null, available: false, saveResult: entry };
    }
    if (entry?.status === 'already_exists') return { ...profile, state: 'has_job', available: false, saveResult: entry };
    if (entry?.status === 'removed') {
      return {
        ...profile,
        state: 'available',
        rowId: null,
        autoSaved: false,
        autoSaveJobId: null,
        available: true,
        duplicateKind: null,
        saveResult: entry,
      };
    }
    return entry ? { ...profile, saveResult: entry } : profile;
  });

  if (saveResponse.failedCount > 0 || saveResponse.lockedCount > 0) {
    const message = saveResponse.failedCount > 0
      ? 'Some candidates could not be saved or removed. Review and retry.'
      : 'Some candidates were kept because they applied or Generation is running.';
    await saveGetJdResult(tabId, {
      ...result,
      status: 'complete',
      saveError: message,
      saveResponse,
      profiles: updatedProfiles,
      selectedProfileIds: updatedProfiles
        .filter((profile) => getJdProfileState(profile) !== 'available')
        .map((profile) => profile.id),
      selectionModified: true,
      updatedAt: Date.now(),
    });
    return { ok: false, error: message };
  }
  await saveGetJdResult(tabId, {
    ...result,
    status: 'saved',
    saveError: null,
    message: 'Save finished.',
    saveResponse,
    profiles: updatedProfiles,
    updatedAt: Date.now(),
  });
  const savedProfiles = updatedProfiles.filter((profile) => getJdProfileState(profile) !== 'available').length;
  await showGetJdDone(
    tabId,
    result.pageUrl,
    savedProfiles > 0
      ? `Saved for ${savedProfiles} candidate${savedProfiles === 1 ? '' : 's'}.`
      : 'Removed from every candidate.',
  );
  return { ok: true };
}

const GET_JD_AUTO_CLOSE_KEY = 'qtsGetJdAutoClose';
const GET_JD_CLOSE_SECONDS = 5;
// The page Get JD last finished in each tab, and whether it is a search page showing one job.
const getJdFinishedPageByTab = new Map();

async function isGetJdAutoCloseOn() {
  const stored = await chrome.storage.local.get([GET_JD_AUTO_CLOSE_KEY]);
  return stored[GET_JD_AUTO_CLOSE_KEY] !== false;
}

// Get JD never closes a pinned tab, a window's last tab, or a search page showing one selected job.
// Generation tabs never reach Get JD, which runs only while it is the extension's mode.
async function canAutoCloseGetJdTab(tabId, url) {
  const tab = await getTab(tabId);
  if (!tab || tab.url !== url || tab.pinned) return false;
  if (await isWorkflowTab(tabId, tab)) return false;
  const finished = getJdFinishedPageByTab.get(tabId);
  if (!finished || finished.url !== url || finished.listPage) return false;
  const windowTabs = await chrome.tabs.query({ windowId: tab.windowId });
  return windowTabs.length > 1;
}

// Shows how Get JD ended on this tab in its launcher. A 'done' outcome needs nothing more from the
// Manager, so the tab closes after a countdown when that is allowed; a 'notice' keeps it open with
// a badge and the actions that can resolve it.
async function showGetJdOutcome(tabId, url, outcome) {
  const autoClose = await isGetJdAutoCloseOn();
  const closable = outcome.kind === 'done' && autoClose && await canAutoCloseGetJdTab(tabId, url);
  chrome.tabs.sendMessage(tabId, {
    type: 'QTS_GET_JD_OUTCOME',
    outcome: {
      ...outcome,
      pageUrl: url,
      autoClose,
      closeInSeconds: closable ? GET_JD_CLOSE_SECONDS : 0,
    },
  }, { frameId: 0 }).catch(() => {});
}

function showGetJdNotice(tabId, url, message, actions, extra = {}) {
  return showGetJdOutcome(tabId, url, { kind: 'notice', tone: 'warn', message, actions, ...extra });
}

function showGetJdDone(tabId, url, message, tone = 'success') {
  return showGetJdOutcome(tabId, url, { kind: 'done', tone, message });
}

// The narrowest blocked-URL fragment for a page: its host and path, without the query.
function suggestBlockedUrlFragment(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

// What the launcher says about a page Get JD rejected before reading it.
function showGetJdRejection(tabId, url, reason) {
  if (reason === 'closed') return showGetJdDone(tabId, url, 'This job is closed or removed.', 'info');
  if (reason === 'not-loaded') {
    return showGetJdNotice(
      tabId,
      url,
      "The job didn't load. Sign in or finish the browser check, then click Try again.",
      ['try_again', 'send_anyway'],
    );
  }
  if (reason === 'uncertain') {
    return showGetJdNotice(tabId, url, 'Not sure this is a job page.', ['send_anyway', 'never_on_site'], {
      blockedUrlFragment: suggestBlockedUrlFragment(url),
    });
  }
  chrome.tabs.sendMessage(tabId, { type: 'QTS_NOT_JOB_PAGE' }, { frameId: 0 }).catch(() => {});
  return undefined;
}

// options.force runs Get JD without the job-page check and reads the page as it is ("Send anyway").
async function processGetJdPage(tabId, url, documentId = '', options = {}) {
  if (!isExtractablePageUrl(url) || isChatGptHostUrl(url)) return;
  if (getJdInFlightTabs.has(tabId) || getJdHelperTabs.has(tabId)) return;

  if (!(await isGetJdActive())) return;
  // Starts when the page HTML is ready; detection itself waits for the content to settle.
  const tab = await getTab(tabId);
  if (!tab?.id || tab.url !== url) return;
  // Pages Generation or Apply opened are theirs: no check, no Gemini request, no panel or auto-close.
  if (await isWorkflowTab(tabId, tab)) return;

  if (await isPageBlockedForManager(url)) return;

  const pageKey = `${documentId}:${url}`;
  if (getJdLastPageByTab.get(tabId) === pageKey) return;
  // Claiming the page first lets a newer navigation in this tab cancel this check.
  getJdLastPageByTab.set(tabId, pageKey);
  chrome.tabs.sendMessage(tabId, { type: 'QTS_GET_JD_OUTCOME', outcome: { kind: 'clear' } }, { frameId: 0 })
    .catch(() => {});
  let listPage = false;
  if (options.force) {
    listPage = (await evaluateJobPageForManager(tabId).catch(() => null))?.listPage === true;
  } else {
    const detection = await detectGetJdJobPage(tabId, url, pageKey);
    if (detection.status === 'rejected') {
      getJdFinishedPageByTab.set(tabId, { url, listPage: detection.listPage === true });
      await showGetJdRejection(tabId, url, detection.reason);
    }
    if (detection.status !== 'pass') return;
    listPage = detection.listPage === true;
  }
  if (getJdInFlightTabs.has(tabId)) return;
  getJdFinishedPageByTab.set(tabId, { url, listPage });
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
    await saveGetJdResult(tabId, {
      ...initialResult,
      classification: { isJobPage: true },
    });
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

    const modeResult = await workerApiRequest('GET', '/api/extension/get-jd/mode');
    if (modeResult.success !== true) {
      throw new Error(modeResult.message || 'Could not load the Get JD matching mode.');
    }
    if (modeResult.mode === 'gemini') {
      const jobText = options.force
        ? { text: await readVisiblePageText(tabId), descriptionUrl: '', applyFormOnly: false }
        : await readGetJdJobText(tabId, url);
      if (jobText.applyFormOnly) {
        const message = 'This page has only the application form. Open the job description, and Get JD runs there.';
        await saveGetJdResult(tabId, { ...initialResult, pageTitle: tab.title || '', status: 'error', message, updatedAt: Date.now() });
        await showGetJdNotice(tabId, url, message, ['open_description', 'send_anyway'], {
          descriptionUrl: jobText.descriptionUrl,
        });
        return;
      }
      const pageText = jobText.text.slice(0, 100_000);
      if (!pageText.trim()) throw new Error('Could not read the job text from the loaded page.');
      const geminiResult = await workerApiRequest('POST', '/api/extension/get-jd', {
        pageUrl: url,
        pageTitle: tab.title || documentId || url,
        pageText,
        openerUrl: await tabOpenedFrom(tabId),
      });
      if (geminiResult.success !== true) {
        // The diagnostic code (for example gemini_http_400) names the real cause for troubleshooting.
        console.warn('[QTS Get JD] Gemini evaluation failed:', geminiResult.diagnosticCode || `HTTP ${geminiResult._httpStatus || '?'}`);
        throw new Error(geminiResult.message || 'Gemini candidate matching failed.');
      }
      // Gemini's verdict is final, so a page it rejects closes like a finished one.
      if (geminiResult.classification?.isJobPage !== true) {
        const reason = geminiResult.classification?.job?.reason;
        const message = geminiResult.message || (
          typeof reason === 'string' && reason.trim()
            ? `Not a valid job page: ${reason.trim()}`
            : 'Gemini determined this is not a job page.'
        );
        await saveGetJdResult(tabId, {
          ...initialResult,
          pageTitle: tab.title || '',
          status: 'error',
          message,
          classification: geminiResult.classification,
          updatedAt: Date.now(),
        });
        await showGetJdDone(tabId, url, message, 'info');
        return;
      }
      if (geminiResult.classification?.isRemote !== true) {
        const reason = geminiResult.classification?.job?.reason;
        const message = geminiResult.message || (
          typeof reason === 'string' && reason.trim()
            ? `Not eligible: ${reason.trim()}`
            : 'The job does not pass the saved remote eligibility rules.'
        );
        await saveGetJdResult(tabId, {
          ...initialResult,
          pageTitle: tab.title || '',
          status: 'error',
          message,
          classification: geminiResult.classification,
          updatedAt: Date.now(),
        });
        await showGetJdDone(tabId, url, message, 'info');
        return;
      }
      const profiles = Array.isArray(geminiResult.profiles) ? geminiResult.profiles : [];
      const autoSavedProfileIds = Array.isArray(geminiResult.autoSavedProfileIds)
        ? geminiResult.autoSavedProfileIds.filter((id) => typeof id === 'string')
        : [];
      // Only when no account can be added or unchecked is there nothing to review.
      // 7 days after its first application (any account), a job is skipped for everyone.
      if (geminiResult.expiredApplication) {
        await saveGetJdResult(tabId, {
          ...initialResult,
          pageTitle: tab.title || '',
          status: 'duplicate',
          message: geminiResult.message,
          toastKind: 'applied',
          toastMessage: geminiResult.message,
          inJobs: false,
          inBids: true,
          updatedAt: Date.now(),
        });
        await showGetJdDone(tabId, url, geminiResult.message, 'info');
        return;
      }
      if (profiles.every((profile) => GET_JD_FIXED_STATES.has(getJdProfileState(profile)))) {
        await saveGetJdResult(tabId, {
          ...initialResult,
          pageTitle: tab.title || '',
          status: 'duplicate',
          message: geminiResult.message || 'This job already exists for every active candidate.',
          toastKind: geminiResult.toastKind,
          toastMessage: geminiResult.toastMessage,
          inJobs: geminiResult.inJobs === true,
          inBids: geminiResult.inBids === true,
          updatedAt: Date.now(),
        });
        await showGetJdDone(tabId, url, 'Already saved for every candidate.', 'info');
        return;
      }
      const matchingIds = new Set(geminiResult.classification.matchingProfileIds || []);
      const matchingAvailableProfiles = profiles.filter(
        (profile) => profile.available !== false && matchingIds.has(profile.id),
      );
      await saveGetJdResult(tabId, {
        ...initialResult,
        pageTitle: tab.title || '',
        status: 'complete',
        message: autoSavedProfileIds.length || geminiResult.skippedEvaluation
          ? geminiResult.message
          : geminiResult.autoSaveFailureCount > 0
            ? geminiResult.message
          : matchingAvailableProfiles.length
            ? `Recommended ${matchingAvailableProfiles.length} candidate${matchingAvailableProfiles.length === 1 ? '' : 's'}. Recommended available candidates are checked; review the list before saving.`
          : 'Did not recommend any available candidates from their matching notes. All available profiles are listed unchecked so you can review and select manually.',
        hasDuplicates: geminiResult.exists === true,
        toastKind: geminiResult.toastKind,
        toastMessage: geminiResult.toastMessage,
        summaryText: geminiResult.summary?.text || '',
        updatedAt: Date.now(),
        // Gemini is skipped when every account already has the job; the page details stand in.
        classification: {
          ...geminiResult.classification,
          job: geminiResult.classification.job || {
            title: tab.title || '',
            company: '',
            jobUrl: url,
            reason: geminiResult.message || '',
          },
        },
        evaluationMode: 'gemini',
        jobDescription: geminiResult.jobDescription || geminiResult.classification.job?.description || '',
        profiles,
        autoSavedProfileIds,
        // Accounts that have the job (saved earlier or auto-saved now) start checked.
        selectedProfileIds: [...new Set([
          ...profiles
            .filter((profile) => getJdProfileState(profile) !== 'available')
            .map((profile) => profile.id),
          ...autoSavedProfileIds,
          ...matchingAvailableProfiles.map((profile) => profile.id),
        ])],
      });
      // Gemini's picks are final: no manual review. The job is saved for the candidates it matched
      // (or for none) and the tab closes after the countdown. Only a failed save stays open, so the
      // Manager can retry it.
      if (!(geminiResult.autoSaveFailureCount > 0)) {
        await showGetJdDone(
          tabId,
          url,
          autoSavedProfileIds.length > 0
            ? `Saved for ${autoSavedProfileIds.length} candidate${autoSavedProfileIds.length === 1 ? '' : 's'}.`
            : 'No candidate matched; nothing was saved.',
          autoSavedProfileIds.length > 0 ? 'success' : 'info',
        );
      }
      return;
    }

    const extraction = await extractJobFromTab(tabId, { requireCompany: true });
    if (!(await isGetJdActive())) return;
    if (extraction.error) {
      await saveGetJdResult(tabId, {
        ...initialResult,
        pageTitle: extraction.title || tab.title || '',
        status: 'error',
        message: extraction.error,
        updatedAt: Date.now(),
      });
      await showGetJdNotice(tabId, url, extraction.error, ['try_again']);
      return;
    }

    if (!(await isGetJdActive())) return;
    const pageUrl = extraction.url || url;
    const extractedJobDetails = normalizeDetectedJobData(extraction.data, pageUrl);
    if (!isValidGetJdCheckJob(extractedJobDetails, pageUrl)) {
      const hasCompletePosting = isValidDetectedJob(extractedJobDetails, pageUrl);
      const message = !extractedJobDetails.company
        ? 'Could not identify the hiring company on this page. Refresh the job page and try again.'
        : hasCompletePosting
          ? 'The extracted job details exceed supported limits. Open the job detail page and try again.'
          : 'This page does not contain a complete job posting. Open a job detail page and try again.';
      await saveGetJdResult(tabId, {
        ...initialResult,
        pageTitle: extraction.title || tab.title || '',
        status: 'error',
        message,
        updatedAt: Date.now(),
      });
      await showGetJdNotice(tabId, url, message, ['try_again']);
      return;
    }
    // Detection already passed; only a blocked-URL rule added meanwhile stops the check here.
    if (await isPageBlockedForManager(url)) {
      await saveGetJdResult(tabId, { ...initialResult, status: 'cancelled', updatedAt: Date.now() });
      return;
    }
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
    const matchingProfileIds = new Set(
      Array.isArray(result.matchingProfileIds)
        ? result.matchingProfileIds.filter((id) => typeof id === 'string')
        : [],
    );
    const recommendedProfileIds = profiles
      .filter((profile) => profile.recommended === true || matchingProfileIds.has(profile.id))
      .map((profile) => profile.id);
    // The review stays open while any account can still be added or unchecked.
    const actionableProfiles = profiles.filter((profile) => !GET_JD_FIXED_STATES.has(getJdProfileState(profile)));
    if (actionableProfiles.length === 0) {
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
      await showGetJdDone(tabId, url, 'Already saved for every candidate.', 'info');
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
        matchingProfileIds: recommendedProfileIds,
        job: {
          title: extractedJobDetails.title,
          company: extractedJobDetails.company,
          location: extractedJobDetails.location,
          description: extractedJobDetails.description,
          country: extractedJobDetails.country,
          employmentType: extractedJobDetails.employmentType,
          workplaceType: extractedJobDetails.workplaceType,
          salary: extractedJobDetails.salary,
          jobUrl: extractedJobDetails.url,
        },
      },
      profiles: profiles.map((profile) => ({
        ...profile,
        recommended: profile.recommended === true || matchingProfileIds.has(profile.id),
      })),
      summaryText: result.summary?.text || '',
      // Accounts that already have the job start checked; unchecking one removes it on Save.
      selectedProfileIds: [
        ...new Set([
          ...profiles
            .filter((profile) => getJdProfileState(profile) !== 'available')
            .map((profile) => profile.id),
          ...recommendedProfileIds,
        ]),
      ],
      jobDescription: extractedJobDetails.description,
    });
  } catch (error) {
    if (!(await isGetJdActive())) return;
    console.error('[QTS Get JD] Page duplicate check failed:', error);
    const message = error instanceof Error ? error.message : 'Could not process this job page.';
    await saveGetJdResult(tabId, {
      ...initialResult,
      status: 'error',
      message,
      updatedAt: Date.now(),
    });
    await showGetJdNotice(tabId, url, `Get JD couldn't finish: ${message}`, ['try_again'], { tone: 'error' });
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
  const stored = await chrome.storage.local.get([GET_JD_ON_KEY]);
  return stored[GET_JD_ON_KEY] === true;
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
  return isExtractablePageUrl(url) && !isChatGptHostUrl(url);
}

async function maybePrewarmCustomGptOnJobPage(tabId, url) {
  if (!isJobPageCandidateUrl(url)) return;
  if (await isPageBlockedForManager(url) || !(await isPageDetectedAsJobForManager(tabId))) return;
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

  async function scannerChatGptSnapshot(tabId, generationId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (taskId) => {
        const composer = globalThis.__qtsChatGptComposerHandoff;
        const response = composer?.findAssistantResponseForTask?.(taskId);
        const generating = Boolean(composer?.isGenerating?.());
        const text = String(response?.innerText || response?.textContent || '').trim();
        // ChatGPT shows the copy button under an answer once it has finished writing it.
        const turn = response?.closest?.('article, [data-testid^="conversation-turn"], [data-message-role]');
        // The newer interface marks a finished answer with data-message-complete.
        const finished = Boolean(
          response?.closest?.('[data-message-complete]')
          || turn?.querySelector(
            '[data-testid="copy-turn-action-button"], button[aria-label="Copy"], button[aria-label="Copy message"], button[aria-label="Copy response"]',
          ),
        );
        const errorPattern = /something went wrong|an error occurred|error generating|you['’]ve (?:reached|hit) (?:your|the)|usage (?:cap|limit)|rate limit|too many requests|network error|unusual activity|try again later|cloudflare_challenge|couldn['’]t load your account|response couldn['’]t load|browser check couldn['’]t finish/i;
        const errorNode = [...document.querySelectorAll(
          '[role="alert"], [data-testid*="error" i], .text-token-text-error, [class*="text-red"]',
        )].find((node) => errorPattern.test(node.innerText || ''));
        let chatError = errorNode ? String(errorNode.innerText).trim().slice(0, 200) : '';
        if (!chatError && text && !text.includes('{') && errorPattern.test(text)) chatError = text.slice(0, 200);
        // The browser check can replace the whole page instead of showing an alert.
        if (!chatError && /cloudflare_challenge|couldn['’]t load your account|browser check couldn['’]t finish/i.test(document.body?.innerText || '')) {
          chatError = "ChatGPT's browser check stopped the page.";
        }
        return { text, isNew: Boolean(response), generating, finished, chatError };
      },
      args: [generationId],
    });
    return results[0]?.result;
  }

  async function showGenerationPageStatus(jobTabId, message, type = 'info') {
    if (!Number.isInteger(jobTabId)) return;
    try {
      await chrome.tabs.sendMessage(jobTabId, {
        type: 'QTS_GENERATION_PROGRESS',
        message,
        statusType: type,
      });
    } catch {
      // The source page may have navigated while ChatGPT was generating.
    }
  }

  async function updateGenerationBrowserState(values) {
    const stored = await chrome.storage.local.get(GENERATION_BROWSER_STATE_KEY);
    const current = stored[GENERATION_BROWSER_STATE_KEY];
    await chrome.storage.local.set({
      [GENERATION_BROWSER_STATE_KEY]: {
        ...(current && typeof current === 'object' ? current : {}),
        ...values,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  async function persistGenerationQueueRun(runId, excludedJobIds) {
    await chrome.storage.local.set({
      [GENERATION_QUEUE_RUN_KEY]: {
        runId,
        excludedJobIds: [...excludedJobIds],
      },
    });
  }

  async function clearGenerationBrowserState(generationId = '') {
    if (generationId) {
      const stored = await chrome.storage.local.get(GENERATION_BROWSER_STATE_KEY);
      const current = stored[GENERATION_BROWSER_STATE_KEY];
      if (current?.generationId && current.generationId !== generationId) return;
    }
    await chrome.storage.local.remove(GENERATION_BROWSER_STATE_KEY);
  }

  async function notifyGenerationManager(message) {
    let sessionUser = null;
    try {
      sessionUser = await self.__qtsAccountAuth?.readWorkerSessionUser?.();
    } catch (error) {
      console.error('[QTS Generation] Could not read the Manager session for the notification:', error);
    }
    const notice = {
      managerId: sessionUser?.role === 'manager' ? sessionUser.id : null,
      message: String(message || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    if (!notice.message) return;
    try {
      await chrome.storage.local.set({ [GENERATION_NOTICE_KEY]: notice });
    } catch (error) {
      console.error('[QTS Generation] Could not retain the Manager notice in extension storage:', error);
    }
    if (!chrome.notifications?.create) {
      console.error('[QTS Generation] Chrome notifications are unavailable; the notice is available in the popup.');
      return;
    }
    await new Promise((resolve) => {
      chrome.notifications.create(
        `qts-generation-${Date.now()}`,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('assets/icon128.png'),
          title: 'QTS Generation',
          message: notice.message,
        },
        () => {
          const error = chrome.runtime.lastError;
          if (error) console.error('[QTS Generation] Could not show a Chrome notification:', error.message);
          resolve();
        },
      );
    });
  }

  // Generation works in its own window (pinned ChatGPT tab plus the job pages it opens), opened
  // without taking focus, so the Manager's browsing window stays theirs.
  async function acquireGenerationChatGptTab() {
    const window = await chrome.windows.create({ url: 'https://chatgpt.com/', focused: false, state: 'normal' });
    const created = window?.tabs?.[0];
    if (created?.id == null) throw new Error('Could not open a new pinned ChatGPT tab.');
    await tabOwnership.markWindow(window.id, 'generation');
    await chrome.tabs.update(created.id, { pinned: true }).catch(() => {});
    await tabOwnership.markTab(created.id, 'generation');
    const existingTabs = await chrome.tabs.query({});
    const otherChatTabs = existingTabs.filter((tab) =>
      tab.id != null &&
      tab.id !== created.id &&
      isChatGptHostUrl(tab.url || tab.pendingUrl || ''),
    );
    for (const tab of otherChatTabs) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (error) {
        console.error('[QTS Generation] Could not close an existing ChatGPT tab:', error);
        throw new Error('Could not close all existing ChatGPT tabs before Generation.');
      }
    }
    return created;
  }

  // A step card in the corner of the ChatGPT tab, so the Manager can follow Generation there. It also
  // leaves window.__qtsSetGenerationStep behind for steps that run inside the page (typing, sending).
  function generationStepCardInPage(step, message, kind) {
    const colors = { info: '#2563eb', success: '#059669', warn: '#d97706', error: '#dc2626' };
    const show = (nextStep, nextMessage, nextKind = 'info') => {
      let host = document.getElementById('qts-generation-steps');
      if (!host) {
        host = document.createElement('div');
        host.id = 'qts-generation-steps';
        host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<style>.card{width:300px;padding:10px 12px;border-radius:12px;background:#0f172aee;color:#f8fafc;'
          + 'font:13px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px #0006;border-left:5px solid var(--c)}'
          + '.title{font-weight:700;font-size:12px;letter-spacing:.02em;color:#cbd5e1}.step{font-weight:700;margin-top:2px}'
          + '.message{margin-top:2px;color:#e2e8f0;overflow-wrap:anywhere}</style>'
          + '<div class="card"><div class="title">QTS Generation</div><div class="step"></div><div class="message"></div></div>';
        (document.body || document.documentElement).append(host);
      }
      const root = host.shadowRoot;
      root.querySelector('.card').style.setProperty('--c', colors[nextKind] || colors.info);
      root.querySelector('.step').textContent = nextStep;
      root.querySelector('.message').textContent = nextMessage;
    };
    window.__qtsSetGenerationStep = show;
    show(step, message, kind);
  }

  async function showGenerationChatGptStep(chatTabId, step, message, kind = 'info') {
    if (!Number.isInteger(chatTabId)) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: chatTabId },
        func: generationStepCardInPage,
        args: [step, message, kind],
      });
    } catch {
      // The page is loading or reloading; the next step shows the card again.
    }
  }

  // ChatGPT sometimes stops at a browser check ("cloudflare_challenge", "We couldn't load your
  // account"); reloading the page clears it.
  const CHATGPT_BROWSER_CHECK_PATTERN = /cloudflare_challenge|couldn[’']t load your account|browser check couldn[’']t finish|verify you are human|checking your browser/i;
  // ChatGPT gets this long to load, and again this long to show its message box, before a reload.
  const CHATGPT_LOAD_TIMEOUT_MS = 30 * 1000;
  const CHATGPT_RELOADS = 2;

  // ChatGPT is ready when its page has loaded and its message box shows. A slow page or a browser
  // check gets a reload, up to two, then the job fails with the reason.
  async function ensureChatGptReady(chatTabId) {
    for (let reloads = 0; ; reloads += 1) {
      let state = 'slow';
      try {
        await waitForScannerChatGptTab(chatTabId, CHATGPT_LOAD_TIMEOUT_MS);
        await showGenerationChatGptStep(chatTabId, '1/6 · Opening ChatGPT', 'Waiting for the page to be ready...');
        await chrome.scripting.executeScript({ target: { tabId: chatTabId }, files: ['shared/chatgpt-composer-handoff.js'] });
        const [check] = await chrome.scripting.executeScript({
          target: { tabId: chatTabId },
          func: async (source, timeoutMs) => {
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
              if (new RegExp(source, 'i').test(document.body?.innerText || '')) return 'browser_check';
              if (globalThis.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.()) return 'ready';
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            return 'slow';
          },
          args: [CHATGPT_BROWSER_CHECK_PATTERN.source, CHATGPT_LOAD_TIMEOUT_MS],
        });
        state = check?.result || 'slow';
      } catch {
        // The page did not finish loading in time, or was replaced while being checked.
      }
      if (state === 'ready') return;
      if (reloads >= CHATGPT_RELOADS) {
        throw new Error(state === 'browser_check'
          ? "ChatGPT's browser check did not finish after reloading. Open ChatGPT, complete the check, then retry Generation."
          : 'ChatGPT did not load after two reloads. Check the pinned ChatGPT tab (sign-in, network), then retry Generation.');
      }
      await showGenerationChatGptStep(
        chatTabId,
        state === 'browser_check' ? '1/6 · ChatGPT browser check' : '1/6 · ChatGPT is slow to load',
        `${state === 'browser_check' ? 'Reloading ChatGPT to clear its browser check' : 'Reloading ChatGPT'} (${reloads + 1} of ${CHATGPT_RELOADS})...`,
        'warn',
      );
      await sleep(1000);
      await chrome.tabs.reload(chatTabId);
    }
  }

  // A new chat in the pinned ChatGPT tab for the next job.
  async function startNewChatGptChat(chatTabId) {
    await chrome.tabs.update(chatTabId, { url: 'https://chatgpt.com/' });
    // Let the navigation begin, so the readiness check does not see the previous page.
    await sleep(1500);
    await ensureChatGptReady(chatTabId);
  }

  async function sendGenerationPromptWithRecovery(chatTabId, prompt) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await chrome.tabs.reload(chatTabId);
      }
      try {
        await ensureChatGptReady(chatTabId);
        await chrome.scripting.executeScript({
          target: { tabId: chatTabId },
          files: ['shared/chatgpt-composer-handoff.js'],
        });
        const handoffResults = await chrome.scripting.executeScript({
          target: { tabId: chatTabId },
          func: async (message) => {
            const composer = globalThis.__qtsChatGptComposerHandoff;
            if (!composer?.runUnifiedComposerHandoffAsync) {
              return { ok: false, error: 'The ChatGPT composer helper is unavailable.' };
            }
            const startedAt = Date.now();
            while (Date.now() - startedAt < 45000) {
              const editor = composer.findUnifiedComposerEditor?.();
              if (!editor) {
                await new Promise((resolve) => setTimeout(resolve, 300));
                continue;
              }
              // Never type a prompt while ChatGPT is still writing an answer.
              if (composer.isGenerating?.()) {
                return { ok: false, error: 'ChatGPT is already generating. Wait for it to finish and retry.' };
              }
              const messages = composer.findAssistantMessages?.() || [];
              const baseline = {
                messageCount: messages.length,
                lastText: String(messages[messages.length - 1]?.innerText || '').trim(),
              };
              // The message box shows before ChatGPT's page code is running; typing then does not reach it.
              await new Promise((resolve) => setTimeout(resolve, 2000));
              // Up to three rounds while the prompt stays unsent in the box (so it is never sent twice):
              // ChatGPT may still be loading, so later rounds wait, retype the prompt and send again.
              let result = null;
              for (let round = 1; round <= 3; round += 1) {
                if (round > 1) {
                  window.__qtsSetGenerationStep?.('3/6 · Sending the prompt', `ChatGPT wasn't ready; trying again (${round} of 3)...`);
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  if (composer.isGenerating?.()) return { ok: true, sent: true, method: 'generating_after_retry_wait', baseline };
                  const start = message.replace(/\s+/g, ' ').trim().slice(0, 120);
                  const box = composer.findUnifiedComposerEditor?.(message);
                  if (!box || !composer.readEditorText(box).includes(start)) break;
                } else {
                  window.__qtsSetGenerationStep?.('2/6 · Typing the prompt', 'Putting the prompt into the ChatGPT message box...');
                }
                result = await composer.runUnifiedComposerHandoffAsync(message, {
                  retype: round > 1,
                  onSending: () => window.__qtsSetGenerationStep?.('3/6 · Sending the prompt', 'Clicking Send (Enter if needed)...'),
                });
                if (result.sent || !result.needsManualSend) break;
              }
              return { ...result, baseline };
            }
            return {
              ok: false,
              phase: 'no_editor',
              error: 'Timed out waiting for the ChatGPT message box. Sign in to ChatGPT and retry.',
            };
          },
          args: [prompt],
        });
        const handoff = handoffResults[0]?.result;
        if (handoff?.ok && handoff.sent) return handoff;
        lastError = new Error(
          handoff?.needsManualSend
            ? 'The prompt is ready in ChatGPT, but QTS could not confirm Send. Click Send once, then retry Generation if needed.'
            : handoff?.error || 'ChatGPT did not confirm that the prompt was sent.',
        );
        if (handoff?.needsManualSend || handoff?.phase !== 'no_editor') throw lastError;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('ChatGPT did not become ready.');
        if (attempt > 0 || /already generating|confirm Send/i.test(lastError.message)) throw lastError;
      }
    }
    throw lastError || new Error('ChatGPT did not become ready.');
  }

  function ensureGenerationIsActive(jobTabId, cancellationToken) {
    if (generationCancellationByTab.get(jobTabId) !== cancellationToken) {
      throw generationCancelledError();
    }
  }

  function generationCancelledError() {
    const error = new Error('Generation was cancelled by the manager.');
    error.name = 'GenerationCancelledError';
    return error;
  }

  function isGenerationCancelled(error) {
    return error?.name === 'GenerationCancelledError';
  }

  async function ensureQueuedGenerationIsActive(jobId) {
    const result = await workerApiRequest(
      'POST',
      '/api/extension/generation/heartbeat',
      { jobId },
    );
    if (result.success) {
      if (result.generationStatus !== 'processing') throw generationCancelledError();
      generationHeartbeatOkAt.set(jobId, Date.now());
      return;
    }
    // 409 means the job is no longer processing, for example after a cancel.
    if (result._httpStatus === 409) throw generationCancelledError();
    const transient = !result._sessionExpired && result.message !== 'Not logged in.';
    if (transient && Date.now() - (generationHeartbeatOkAt.get(jobId) || 0) < GENERATION_HEARTBEAT_GRACE_MS) {
      console.warn('[QTS Generation] Heartbeat failed; retrying on the next check:', result.message);
      return;
    }
    throw new Error(result.message || 'Could not check Generation status.');
  }

  async function readQueuedGenerationStatus(jobId) {
    const result = await workerApiRequest(
      'GET',
      `/api/extension/generation/status?jobId=${encodeURIComponent(jobId)}`,
    );
    return result.success && typeof result.generationStatus === 'string' ? result.generationStatus : '';
  }

  function chatGptPageError(message) {
    const error = new Error(`ChatGPT showed an error: ${message}`);
    error.name = 'ChatGptPageError';
    return error;
  }

  // Waits for ChatGPT to finish the answer to this task's latest prompt: the Stop button is gone and
  // the copy button shows (or, without it, the text stopped changing).
  async function waitForGenerationAnswer(chatTabId, generationId, active) {
    const startedAt = Date.now();
    let lastStatusCheck = startedAt;
    let lastText = '';
    let quietSince = 0;
    let lastShownSecond = -1;
    while (Date.now() - startedAt < GENERATION_ANSWER_MAX_WAIT_MS) {
      await sleep(750);
      active.local();
      if (Date.now() - lastStatusCheck >= 3000) {
        await active.server();
        lastStatusCheck = Date.now();
      }
      const snapshot = await scannerChatGptSnapshot(chatTabId, generationId);
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (seconds !== lastShownSecond && seconds % 3 === 0) {
        lastShownSecond = seconds;
        await showGenerationChatGptStep(
          chatTabId,
          '4/6 · ChatGPT is writing',
          `${snapshot?.generating || snapshot?.text ? 'Writing the résumé and cover letter' : 'Waiting for ChatGPT to start'}... ${seconds}s of ${GENERATION_ANSWER_MAX_WAIT_MS / 1000}s`,
        );
      }
      if (snapshot?.chatError && !snapshot.generating) throw chatGptPageError(snapshot.chatError);
      if (!snapshot?.isNew || !snapshot.text || snapshot.generating) {
        lastText = '';
        continue;
      }
      if (snapshot.finished) return snapshot.text;
      if (snapshot.text !== lastText) {
        lastText = snapshot.text;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= GENERATION_ANSWER_QUIET_MS) {
        return snapshot.text;
      }
    }
    throw new Error(`ChatGPT did not finish the answer within ${GENERATION_ANSWER_MAX_WAIT_MS / 60_000} minutes.`);
  }

  // Sends one prompt and returns ChatGPT's finished answer. If ChatGPT shows an error ("This response
  // couldn't load"), its tab is closed and the prompt sent once more in a fresh pinned tab; chatTab
  // is the queue's own record, so the queue goes on with (and later closes) the new tab.
  async function askGenerationChatGpt(chatTab, prompt, generationId, active) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await updateGenerationBrowserState({ phase: 'sending_prompt' });
        await sendGenerationPromptWithRecovery(chatTab.id, prompt);
        await updateGenerationBrowserState({ phase: 'waiting_for_response' });
        return await waitForGenerationAnswer(chatTab.id, generationId, active);
      } catch (error) {
        if (error?.name !== 'ChatGptPageError' || attempt > 0) throw error;
        await showGenerationChatGptStep(chatTab.id, '4/6 · ChatGPT showed an error', `${error.message} Opening a new ChatGPT tab and sending again...`, 'warn');
        await sleep(1500);
        active.local();
        await chrome.tabs.remove(chatTab.id).catch(() => {});
        chatTab.id = (await acquireGenerationChatGptTab()).id;
        await updateGenerationBrowserState({ chatTabId: chatTab.id, phase: 'opening_chatgpt' });
        await ensureChatGptReady(chatTab.id);
      }
    }
  }

  // pinnedChatTab is the queue's { id, jobs } record; a ChatGPT error can swap in a fresh tab id.
  async function runGenerationForTab(jobTabId, queuedJob = null, pinnedChatTab = null) {
    if (!queuedJob?.id) {
      throw new Error('Generation requires a saved candidate Job. Run Get JD and save candidates first.');
    }
    if (!Number.isInteger(pinnedChatTab?.id)) throw new Error('Generation needs the pinned ChatGPT tab.');
    const cancellationKey = jobTabId ?? queuedJob.id;
    if (generationInFlightTabs.has(cancellationKey)) {
      throw new Error('Generation is already running for this job.');
    }
    generationInFlightTabs.add(cancellationKey);
    const cancellationToken = (generationCancellationByTab.get(cancellationKey) || 0) + 1;
    generationCancellationByTab.set(cancellationKey, cancellationToken);
    let generationId = '';
    const jobDescription = String(queuedJob.description || '').trim();
    let chatTab = null;
    try {
      await updateGenerationBrowserState({
        phase: 'preparing_prompt',
        jobId: queuedJob.id,
        jobTabId,
        jobUrl: queuedJob.jobUrl,
      });
      await ensureQueuedGenerationIsActive(queuedJob.id);
      await showGenerationPageStatus(jobTabId, 'Preparing the prompt from the saved job and candidate profile...');
      if (
        !queuedJob.jobTitle?.trim() ||
        !queuedJob.company?.trim() ||
        !jobDescription ||
        !queuedJob.jobUrl?.trim()
      ) {
        throw new Error('The saved job is missing its URL, title, company, or description.');
      }
      ensureGenerationIsActive(cancellationKey, cancellationToken);
      await ensureQueuedGenerationIsActive(queuedJob.id);
      const started = await workerApiRequest(
        'POST',
        '/api/extension/generation/start',
        { jobId: queuedJob.id },
      );
      if (!started.success || !started.generationId || !started.prompt) {
        const error = new Error(started.message || 'QTS could not prepare the Generation prompt.');
        if (
          started.errorCode === 'generation_prompt_missing' ||
          started._httpStatus >= 500 ||
          started._sessionExpired ||
          started.message === 'Cannot connect to the server.'
        ) {
          error.name = 'GenerationSetupError';
        }
        throw error;
      }
      generationId = started.generationId;
      const generationPrompt = self.__qtsGenerationChatGpt?.buildTaskPrompt?.(
        started.prompt,
        generationId,
      );
      if (!generationPrompt) throw new Error('QTS could not create a task-specific Generation prompt.');
      ensureGenerationIsActive(cancellationKey, cancellationToken);
      await showGenerationPageStatus(jobTabId, 'Opening ChatGPT and sending the Generation prompt...');

      await updateGenerationBrowserState({
        phase: 'opening_chatgpt',
        generationId,
        chatTabId: pinnedChatTab.id,
      });
      // The queue opened the pinned ChatGPT tab (and a new chat in it) before the job page.
      chatTab = pinnedChatTab;
      ensureGenerationIsActive(cancellationKey, cancellationToken);
      const active = {
        local: () => ensureGenerationIsActive(cancellationKey, cancellationToken),
        server: () => ensureQueuedGenerationIsActive(queuedJob.id),
      };
      await showGenerationPageStatus(jobTabId, 'ChatGPT is generating the résumé and cover letter...');
      let responseText = await askGenerationChatGpt(chatTab, generationPrompt, generationId, active);

      // An answer QTS cannot use gets one follow-up in the same chat that says why.
      for (let followUps = 0; ; followUps += 1) {
        active.local();
        await active.server();
        await updateGenerationBrowserState({ phase: 'validating_response' });
        await showGenerationChatGptStep(chatTab.id, '5/6 · Checking the answer', 'Reading the JSON and saving it to QTS...');
        const responseJson = self.__qtsGenerationChatGpt?.extractJsonObject?.(responseText) || null;
        const saved = responseJson
          ? await workerApiRequest('POST', '/api/extension/generation/complete', {
            generationId,
            responseText,
            responseJson,
          })
          : { success: false, message: 'The reply was not one valid JSON object.', unusable: true };
        if (saved.success) break;
        const unusable = saved.unusable || saved._httpStatus === 400 || saved._httpStatus === 422;
        if (!unusable || followUps > 0) {
          throw new Error(unusable
            ? `ChatGPT's answer could not be used: ${saved.message}`
            : saved.message || 'QTS could not save the Generation result.');
        }
        await showGenerationPageStatus(jobTabId, 'Asking ChatGPT to correct its answer...');
        await showGenerationChatGptStep(
          chatTab.id,
          '5/6 · Asking ChatGPT to correct its answer',
          saved.message || 'The answer was not valid JSON.',
          'warn',
        );
        const followUp = self.__qtsGenerationChatGpt.buildTaskPrompt(
          `Your previous reply could not be used: ${saved.message || 'it was not valid JSON.'} `
          + 'Reply again with only the complete, valid JSON object in the required structure, with no other text before or after it.',
          generationId,
        );
        responseText = await askGenerationChatGpt(chatTab, followUp, generationId, active);
      }
      await updateGenerationBrowserState({ phase: 'response_saved' });
      await showGenerationChatGptStep(chatTab.id, '6/6 · Answer saved', 'Making the résumé and cover-letter PDFs and downloading them...', 'success');
      const message = 'Generation completed and saved with the JD.';
      await showGenerationPageStatus(jobTabId, message, 'success');
      return { ok: true, status: 'generation', message, generationId, parsed: true, chatTabId: chatTab.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed.';
      if (Number.isInteger(chatTab?.id)) {
        // Leave the reason on screen for a moment before the tab closes.
        await showGenerationChatGptStep(
          chatTab.id,
          isGenerationCancelled(error) ? 'Cancelled' : 'Stopped',
          message,
          isGenerationCancelled(error) ? 'info' : 'error',
        );
        await sleep(4000);
      }
      if (generationId && jobDescription && !isGenerationCancelled(error)) {
        try {
          const failed = await workerApiRequest('POST', '/api/extension/generation/complete', {
            generationId,
            failureReason: message,
          });
          if (!failed.success) {
            console.error('[QTS Generation] Could not record the failed run:', failed.message);
          }
        } catch (saveError) {
          console.error('[QTS Generation] Could not record the failed run:', saveError);
        }
      }
      await showGenerationPageStatus(
        jobTabId,
        message,
        isGenerationCancelled(error) ? 'info' : 'error',
      );
      throw error;
    } finally {
      // The pinned ChatGPT tab stays open for the next job; the queue closes or replaces it.
      generationInFlightTabs.delete(cancellationKey);
      try {
        const stored = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
        if (
          !queuedJob
          && (
            stored[EXTENSION_STATUS_KEY] === 'generation'
            || stored[EXTENSION_STATUS_KEY] === 'cancel'
          )
        ) {
          await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
        }
      } catch (error) {
        console.error('[QTS Generation] Could not reset the extension action status:', error);
      }
    }
  }

  function validateApplicationDownloadFiles(files) {
    if (!Array.isArray(files) || files.length < 1 || files.length > 3) {
      throw new Error('One to three application files are required.');
    }
    return files.map((file) => {
      const downloadPath = String(file?.downloadPath || '').replaceAll('\\', '/');
      const mimeType = String(file?.mimeType || '');
      const base64 = String(file?.base64 || '');
      if (
        !downloadPath.startsWith('QTS_Resume/')
        || downloadPath.startsWith('/')
        || downloadPath.split('/').some((part) => !part || part === '.' || part === '..')
        || downloadPath.length > 500
        || !['application/pdf', 'text/plain;charset=utf-8'].includes(mimeType)
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
        || base64.length > 20_000_000
      ) {
        throw new Error('An application download file is invalid.');
      }
      return { downloadPath, mimeType, base64 };
    });
  }

  async function startApplicationFileDownload(file) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: `data:${file.mimeType};base64,${file.base64}`,
        filename: file.downloadPath,
        saveAs: false,
        conflictAction: 'uniquify',
      }, (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error || typeof downloadId !== 'number') {
          reject(new Error(`Chrome could not start a file download: ${error?.message || 'unknown error'}`));
        } else {
          resolve(downloadId);
        }
      });
    });
  }

  async function downloadQueuedGenerationFiles(generationId, jobId, downloadIds) {
    await ensureQueuedGenerationIsActive(jobId);
    const artifactResult = await workerApiRequest(
      'GET',
      `/api/extension/generation/artifacts?generationId=${encodeURIComponent(generationId)}`,
    );
    if (
      artifactResult.success !== true
      || !Array.isArray(artifactResult.files)
      || artifactResult.files.length !== 3
    ) {
      throw new Error(artifactResult.message || 'QTS could not prepare the three download files.');
    }
    const files = validateApplicationDownloadFiles(artifactResult.files);
    for (const file of files) {
      await ensureQueuedGenerationIsActive(jobId);
      const downloadId = await startApplicationFileDownload(file);
      downloadIds.push(downloadId);
      await waitForQueuedDownload(downloadId, jobId);
    }
    await ensureQueuedGenerationIsActive(jobId);
  }

  function waitForQueuedDownload(downloadId, jobId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let statusPollId = null;
      const timeoutId = setTimeout(() => {
        finish(new Error('Timed out waiting for a local file download to finish.'));
      }, 180000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (statusPollId != null) clearInterval(statusPollId);
        chrome.downloads.onChanged.removeListener(onChanged);
        if (error) reject(error);
        else resolve();
      };
      const onChanged = (delta) => {
        if (delta.id !== downloadId || !delta.state?.current) return;
        if (delta.state.current === 'complete') finish();
        else if (delta.state.current === 'interrupted') {
          finish(new Error(`Chrome interrupted a file download: ${delta.error?.current || 'unknown error'}`));
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      statusPollId = setInterval(() => {
        ensureQueuedGenerationIsActive(jobId).catch(finish);
      }, 3000);
      chrome.downloads.search({ id: downloadId }, (items) => {
        const error = chrome.runtime.lastError;
        if (error) {
          finish(new Error(`Could not verify the local file download: ${error.message}`));
          return;
        }
        const item = items?.[0];
        if (item?.state === 'complete') finish();
        else if (item?.state === 'interrupted') {
          finish(new Error(`Chrome interrupted a file download: ${item.error || 'unknown error'}`));
        }
      });
    });
  }

  async function removeQueuedGenerationDownloads(downloadIds) {
    for (const downloadId of downloadIds) {
      await new Promise((resolve) => {
        chrome.downloads.cancel(downloadId, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
      const item = await new Promise((resolve) => {
        chrome.downloads.search({ id: downloadId }, (items) => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error('[QTS Generation] Could not inspect a cancelled download:', error.message);
            resolve(null);
            return;
          }
          resolve(items?.[0] || null);
        });
      });
      if (item?.state === 'complete') {
        const removed = await new Promise((resolve) => {
          chrome.downloads.removeFile(downloadId, () => {
            const error = chrome.runtime.lastError;
            if (error) {
              console.error('[QTS Generation] Could not remove a downloaded file:', error.message);
              resolve(false);
              return;
            }
            resolve(true);
          });
        });
        if (!removed) continue;
      }
      await new Promise((resolve) => {
        chrome.downloads.erase({ id: downloadId }, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            console.error('[QTS Generation] Could not clear a cancelled download record:', error.message);
          }
          resolve();
        });
      });
    }
  }

  async function reportQueuedGenerationDelivered(jobTabId) {
    await updateGenerationBrowserState({ phase: 'completed' });
    await showGenerationPageStatus(
      jobTabId,
      'Generation complete. Resume, cover letter, and JD text were downloaded.',
      'success',
    );
  }

  async function closeInterruptedGenerationTabs(browserState) {
    const sameOrigin = (url, expectedUrl) => {
      try {
        return new URL(url).origin === new URL(expectedUrl).origin;
      } catch {
        return false;
      }
    };
    const runTabs = [
      [browserState?.chatTabId, (tab) => tab.pinned && isChatGptHostUrl(tab.url || tab.pendingUrl || '')],
      [browserState?.jobTabId, (tab) => sameOrigin(tab.url || tab.pendingUrl || '', browserState?.jobUrl)],
    ];
    for (const [tabId, belongsToRun] of runTabs) {
      if (!Number.isInteger(tabId)) continue;
      try {
        // Tab IDs restart with the browser, so only close a tab that still looks like this run's tab.
        const tab = await chrome.tabs.get(tabId);
        if (belongsToRun(tab)) await chrome.tabs.remove(tabId);
      } catch {
        // The tab is already closed.
      }
    }
  }

  async function recoverInterruptedGeneration() {
    const stored = await chrome.storage.local.get([
      ACTIVE_GENERATION_JOB_KEY,
      GENERATION_BROWSER_STATE_KEY,
      EXTENSION_STATUS_KEY,
    ]);
    const jobId = stored[ACTIVE_GENERATION_JOB_KEY];
    if (typeof jobId !== 'string' || !jobId) return;
    // No run is in flight, so a previous service-worker instance stopped mid-job.
    const cancelRequested = stored[EXTENSION_STATUS_KEY] === 'cancel';
    const recovered = await workerApiRequest(
      'POST',
      cancelRequested ? '/api/extension/generation/cancel' : '/api/extension/generation/release',
      { jobId },
    );
    if (!recovered.success && !recovered._httpStatus && recovered.message !== 'Not logged in.') {
      return;
    }
    await closeInterruptedGenerationTabs(stored[GENERATION_BROWSER_STATE_KEY]);
    await chrome.storage.local.remove([ACTIVE_GENERATION_JOB_KEY, GENERATION_BROWSER_STATE_KEY]);
    if (cancelRequested) await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
  }

  async function processQueuedGenerationJobs() {
    if (generationQueueInFlight) return;
    generationQueueInFlight = true;
    try {
      await recoverInterruptedGeneration();
    } catch (error) {
      console.error('[QTS Generation] Could not recover an interrupted job:', error);
    }
    let runId = '';
    const excludedJobIds = new Set();
    const failuresThisRun = new Map();
    let chatTab = null;
    let completedCount = 0;
    let failedCount = 0;
    let shouldStop = false;
    try {
      const storedRun = await chrome.storage.local.get(GENERATION_QUEUE_RUN_KEY);
      const savedRun = storedRun[GENERATION_QUEUE_RUN_KEY];
      runId = typeof savedRun?.runId === 'string' && savedRun.runId
        ? savedRun.runId
        : crypto.randomUUID();
      for (const id of Array.isArray(savedRun?.excludedJobIds) ? savedRun.excludedJobIds : []) {
        if (typeof id === 'string') excludedJobIds.add(id);
      }
      await persistGenerationQueueRun(runId, excludedJobIds);
      const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
      if (!token) {
        const current = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
        if (current[EXTENSION_STATUS_KEY] === 'generation') {
          await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
        }
        await chrome.storage.local.remove(GENERATION_QUEUE_RUN_KEY);
        return;
      }
      for (;;) {
        const storedStatus = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
        if (storedStatus[EXTENSION_STATUS_KEY] !== 'generation') return;
        const claim = await workerApiRequest(
          'POST',
          '/api/extension/generation/claim',
          { excludedJobIds: [...excludedJobIds] },
        );
        if (claim.success !== true) {
          const current = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
          if (current[EXTENSION_STATUS_KEY] === 'generation') {
            await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
          }
          await chrome.storage.local.remove(GENERATION_QUEUE_RUN_KEY);
          if (!claim._sessionExpired) {
            console.error('[QTS Generation] Could not claim a queued job:', claim.message);
            await notifyGenerationManager(
              `Generation stopped because QTS could not claim the next job: ${claim.message || 'server error'}`,
            );
          }
          return;
        }
        if (!claim.job) {
          // Several Chromes share the queue, so Generation stays on and checks again on its
          // 30-second alarm instead of turning itself off; Cancel or Stop all turns it off.
          if (completedCount || failedCount) {
            await notifyGenerationManager(
              `Generation finished ${completedCount} job(s) and ${failedCount} failed job(s). It stays on and takes new jobs as they are saved. Each failed job was tried twice; use Reset Generation on the Jobs page to try it again.`,
            );
          } else {
            const idle = await chrome.storage.local.get(GENERATION_IDLE_NOTICE_KEY);
            if (!idle[GENERATION_IDLE_NOTICE_KEY]) {
              await chrome.storage.local.set({ [GENERATION_IDLE_NOTICE_KEY]: true });
              await notifyGenerationManager(
                'Generation is on and waiting: no job is ready yet. Jobs need a description, candidate JD-matching notes, and no saved resume path.',
              );
            }
          }
          return;
        }
        await chrome.storage.local.remove(GENERATION_IDLE_NOTICE_KEY);
        const queuedJob = claim.job;
        let jobTabId = null;
        let generationId = '';
        let finalizeAttempted = false;
        const downloadIds = [];
        generationHeartbeatOkAt.set(queuedJob.id, Date.now());
        try {
          if (
            typeof queuedJob.id !== 'string' ||
            typeof queuedJob.jobUrl !== 'string' ||
            !queuedJob.id
          ) {
            throw new Error('QTS returned an invalid queued job.');
          }
          await chrome.storage.local.set({ [ACTIVE_GENERATION_JOB_KEY]: queuedJob.id });
          const statusBeforePageOpen = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
          if (statusBeforePageOpen[EXTENSION_STATUS_KEY] !== 'generation') {
            throw generationCancelledError();
          }
          // ChatGPT first: one pinned tab serves up to ten jobs, each in a new chat, then a fresh tab.
          const tabStillOpen = chatTab && await chrome.tabs.get(chatTab.id).then(() => true, () => false);
          if (!tabStillOpen || chatTab.jobs >= GENERATION_JOBS_PER_CHATGPT_TAB) {
            if (tabStillOpen) await chrome.tabs.remove(chatTab.id).catch(() => {});
            const created = await acquireGenerationChatGptTab();
            chatTab = { id: created.id, jobs: 0 };
            await updateGenerationBrowserState({ jobId: queuedJob.id, chatTabId: chatTab.id, phase: 'opening_chatgpt' });
            await ensureChatGptReady(chatTab.id);
          } else {
            await updateGenerationBrowserState({ jobId: queuedJob.id, chatTabId: chatTab.id, phase: 'opening_chatgpt' });
            await startNewChatGptChat(chatTab.id);
          }
          chatTab.jobs += 1;
          // Then the job page, in the background. The prompt uses the saved job, so it is not waited for.
          try {
            const chatWindowId = (await getTab(chatTab.id))?.windowId;
            const jobTab = await chrome.tabs.create({
              url: queuedJob.jobUrl,
              active: false,
              ...(chatWindowId != null ? { windowId: chatWindowId } : {}),
            });
            if (jobTab?.id != null) {
              await tabOwnership.markTab(jobTab.id, 'generation');
              jobTabId = jobTab.id;
              await updateGenerationBrowserState({ jobTabId, jobUrl: queuedJob.jobUrl });
            }
          } catch (error) {
            console.warn('[QTS Generation] Could not open the job page; continuing with saved job data:', error);
          }
          const result = await runGenerationForTab(jobTabId, queuedJob, chatTab);
          generationId = result.generationId;
          await updateGenerationBrowserState({ phase: 'downloading' });
          await downloadQueuedGenerationFiles(result.generationId, queuedJob.id, downloadIds);
          finalizeAttempted = true;
          const finalized = await workerApiRequest(
            'POST',
            '/api/extension/generation/finalize',
            { jobId: queuedJob.id, generationId: result.generationId },
          );
          if (!finalized.success) {
            throw new Error(finalized.message || 'QTS could not finish the queued job.');
          }
          await reportQueuedGenerationDelivered(jobTabId);
          completedCount += 1;
        } catch (error) {
          let handledError = error;
          const serverStatus = await readQueuedGenerationStatus(queuedJob.id);
          if (serverStatus === 'completed') {
            // Finalize committed even though its response was lost; keep the delivered files.
            await reportQueuedGenerationDelivered(jobTabId);
            completedCount += 1;
            continue;
          }
          if (serverStatus && !['processing', 'failed'].includes(serverStatus)) {
            handledError = generationCancelledError();
          }
          const reason = handledError instanceof Error ? handledError.message : 'Generation failed.';
          // A failed job may have left ChatGPT stuck: the next job gets a fresh pinned tab.
          if (chatTab) {
            await chrome.tabs.remove(chatTab.id).catch(() => {});
            chatTab = null;
          }
          // Without a status answer, a sent finalize may have committed, so the files might be the delivery.
          const deliveryUnknown = finalizeAttempted && !serverStatus;
          if (downloadIds.length > 0 && !deliveryUnknown) {
            await removeQueuedGenerationDownloads(downloadIds);
          }
          if (deliveryUnknown) {
            await notifyGenerationManager(
              `QTS could not confirm whether ${queuedJob.jobTitle || 'a job'} was delivered. The downloaded files were kept; check the Jobs page.`,
            );
            shouldStop = true;
          } else if (handledError?.name === 'GenerationSetupError') {
            const released = await workerApiRequest(
              'POST',
              '/api/extension/generation/release',
              { jobId: queuedJob.id },
            );
            if (!released.success) {
              console.error('[QTS Generation] Could not release the job after shared setup failed:', released.message);
            }
            await notifyGenerationManager(`Generation stopped because setup is incomplete: ${reason}`);
            shouldStop = true;
          } else if (!isGenerationCancelled(handledError)) {
            // A failed job is tried once more in this run (the server allows two attempts), then left.
            const failures = (failuresThisRun.get(queuedJob.id) || 0) + 1;
            failuresThisRun.set(queuedJob.id, failures);
            const failed = await workerApiRequest(
              'POST',
              '/api/extension/generation/fail',
              { jobId: queuedJob.id, generationId, reason },
            );
            if (!failed.success) {
              console.error('[QTS Generation] Could not mark the queued job failed:', failed.message);
            }
            const retrying = failed.success === true && failed.canRetry === true && failures < 2;
            if (!retrying) {
              excludedJobIds.add(queuedJob.id);
              await persistGenerationQueueRun(runId, excludedJobIds);
              failedCount += 1;
            }
            console.error('[QTS Generation] Queued job failed:', queuedJob.id, reason);
            await notifyGenerationManager(retrying
              ? `Generation failed for ${queuedJob.jobTitle || 'a job'}: ${reason} Trying it once more.`
              : `Generation failed for ${queuedJob.jobTitle || 'a job'}: ${reason}`);
          } else {
            await workerApiRequest(
              'POST',
              '/api/extension/generation/fail',
              {
                jobId: queuedJob.id,
                generationId,
                reason,
                cancelled: true,
              },
            );
            excludedJobIds.add(queuedJob.id);
            await persistGenerationQueueRun(runId, excludedJobIds);
            await notifyGenerationManager('Generation was cancelled. Queue the job again from the Jobs page to retry it.');
          }
          if (jobTabId != null) {
            await showGenerationPageStatus(
              jobTabId,
              reason,
              isGenerationCancelled(handledError) ? 'info' : 'error',
            );
          }
        } finally {
          generationHeartbeatOkAt.delete(queuedJob.id);
          if (jobTabId != null) {
            try {
              await chrome.tabs.remove(jobTabId);
            } catch (error) {
              console.error('[QTS Generation] Could not close the temporary job page:', error);
            }
          }
          try {
            await clearGenerationBrowserState();
          } catch (error) {
            console.error('[QTS Generation] Could not clear its browser state:', error);
          }
          try {
            const activeGeneration = await chrome.storage.local.get([
              EXTENSION_STATUS_KEY,
              ACTIVE_GENERATION_JOB_KEY,
            ]);
            if (activeGeneration[ACTIVE_GENERATION_JOB_KEY] === queuedJob.id) {
              await chrome.storage.local.remove(ACTIVE_GENERATION_JOB_KEY);
              if (
                activeGeneration[EXTENSION_STATUS_KEY] === 'cancel'
              ) {
                await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
              }
            }
          } catch (storageError) {
            console.error('[QTS Generation] Could not clear the active queue status:', storageError);
          }
        }
        if (shouldStop) {
          const current = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
          if (current[EXTENSION_STATUS_KEY] === 'generation') {
            await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
          }
          return;
        }
      }
    } finally {
      generationQueueInFlight = false;
      if (chatTab) await chrome.tabs.remove(chatTab.id).catch(() => {});
      try {
        const current = await chrome.storage.local.get([
          EXTENSION_STATUS_KEY,
          ACTIVE_GENERATION_JOB_KEY,
        ]);
        if (
          current[EXTENSION_STATUS_KEY] === 'cancel' &&
          !current[ACTIVE_GENERATION_JOB_KEY]
        ) {
          await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
        }
        if (current[EXTENSION_STATUS_KEY] !== 'generation') {
          await chrome.storage.local.remove(GENERATION_QUEUE_RUN_KEY);
        }
      } catch (error) {
        console.error('[QTS Generation] Could not finalize queue-run state:', error);
      }
    }
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

  if (!isExtractablePageUrl(url) || isChatGptHostUrl(url)) return;
  if (await isPageBlockedForManager(url) || !(await isPageDetectedAsJobForManager(tabId))) return;

  const generation = (detectGenerationByTab.get(tabId) || 0) + 1;
  detectGenerationByTab.set(tabId, generation);

  await new Promise((resolve) => setTimeout(resolve, AUTO_DETECT_DELAY_MS));

  if (detectGenerationByTab.get(tabId) !== generation) return;

  const tab = await getTab(tabId);
  if (!tab?.id || tab.url !== url) return;

  const result = await extractJobFromTab(tabId);
  if (detectGenerationByTab.get(tabId) !== generation) return;

  const pageUrl = result.tab?.url || url;
  const entry = await buildManagerDetectedJobEntry(tabId, pageUrl, result.data);
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
  if (!isExtractablePageUrl(tab.url) || isChatGptHostUrl(tab.url)) {
    throw new Error('This tab is not a supported job page.');
  }
  if (await isPageBlockedForManager(tab.url) || !(await isPageDetectedAsJobForManager(tabId))) {
    throw new Error('This URL is not enabled as a job page for the signed-in Manager.');
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
    if (!url) return;
    if (await isPageBlockedForManager(url) || !(await isPageDetectedAsJobForManager(tabId))) return;
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
  if (!isExtractablePageUrl(tab.url) || isChatGptHostUrl(tab.url)) return;
  lastAutoDetectKeyByTab.delete(tabId);
  await autoDetectJob(tabId, tab.url).catch(() => {});
}

function maybeTrackAutoOpen(tabId, url) {
  if (!isJobPageCandidateUrl(url)) return;
  (async () => {
    if (await isWorkflowTab(tabId)) return;
    const autoKey = `${tabId}:${url}`;
    if (lastAutoDetectKeyByTab.get(tabId) === autoKey) return;
    lastAutoDetectKeyByTab.set(tabId, autoKey);
    const autoApplyArmed = await isAutoApplyArmed();
    if (autoApplyArmed) maybePrewarmCustomGptOnJobPage(tabId, url);
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

/**
 * Opens Windows Explorer at a folder under Downloads (a job's résumé folder), with the file this
 * Chrome downloaded there selected. { ok } or { ok: false, notHere } when this Chrome did not save it.
 */
async function openDownloadedFolder(folderPath) {
  const folder = String(folderPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!folder) return { ok: false, error: 'No folder was given.' };
  // Downloads keep the full Windows path; match the folder with either slash.
  const pattern = folder.split('/').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]');
  const found = await chrome.downloads.search({ filenameRegex: `${pattern}[\\\\/]`, orderBy: ['-startTime'] }).catch(() => []);
  const download = found.find((item) => item.exists !== false && item.state === 'complete');
  if (!download) return { ok: false, notHere: true, error: 'This Chrome did not download that folder.' };
  chrome.downloads.show(download.id);
  return { ok: true };
}

/** Whether a page belongs to the QTS site this extension signs in to. */
async function isQtsSite(pageUrl) {
  const server = await self.__qtsRuntimeConfig.getServerUrl();
  try {
    return new URL(pageUrl || '').origin === new URL(server).origin;
  } catch {
    return false;
  }
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
  if (msg.type === 'QTS_DOWNLOAD_APPLICATION_FILES') {
    (async () => {
      const serverUrl = await self.__qtsRuntimeConfig.getServerUrl();
      let trustedOrigin = '';
      let senderOrigin = '';
      try {
        const trustedUrl = new URL(serverUrl);
        const senderUrl = new URL(sender.tab?.url || '');
        trustedOrigin = trustedUrl.origin;
        senderOrigin = senderUrl.origin;
        const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
        if (
          loopbackHosts.has(trustedUrl.hostname)
          && loopbackHosts.has(senderUrl.hostname)
          && trustedUrl.protocol === senderUrl.protocol
          && trustedUrl.port === senderUrl.port
        ) {
          senderOrigin = trustedOrigin;
        }
      } catch {
        // Invalid origins are rejected below.
      }
      if (!trustedOrigin || senderOrigin !== trustedOrigin) {
        sendResponse({ ok: false, error: 'Downloads can only be started from the QTS server.' });
        return;
      }
      const files = validateApplicationDownloadFiles(msg.files);
      const downloadIds = [];
      for (const file of files) {
        downloadIds.push(await startApplicationFileDownload(file));
      }
      sendResponse({ ok: true, downloadIds });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not start the application downloads.',
    }));
    return true;
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
  if (msg.type === 'QTS_ENSURE_GET_JD_PANEL') {
    const tabId = sender.tab?.id;
    if (tabId == null || sender.frameId !== 0) {
      sendResponse({ ok: false, error: 'The QTS panel can only load on a web page.' });
      return false;
    }
    isWorkflowTab(tabId, sender.tab)
      .then((owned) => {
        if (owned) throw new Error('This tab belongs to Generation or Apply.');
        return ensureGetJdPanel(tabId);
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'The QTS panel could not load on this page.',
      }));
    return true;
  }

  // The launcher's Get JD countdown ran out: close the tab if it is still the finished page.
  if (msg.type === 'QTS_GET_JD_CLOSE_TAB') {
    const tabId = sender.tab?.id;
    if (tabId == null || sender.frameId !== 0) {
      sendResponse({ ok: false });
      return false;
    }
    (async () => {
      if (!(await isGetJdAutoCloseOn()) || !(await canAutoCloseGetJdTab(tabId, String(msg.pageUrl || '')))) {
        return { ok: false };
      }
      await chrome.tabs.remove(tabId);
      getJdFinishedPageByTab.delete(tabId);
      return { ok: true };
    })()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // Try again re-runs the job-page check; Send anyway (force) skips it and reads the page as it is.
  if (msg.type === 'QTS_GET_JD_RETRY') {
    const tabId = sender.tab?.id;
    if (tabId == null || sender.frameId !== 0) {
      sendResponse({ ok: false, error: 'Get JD can run only on a web page.' });
      return false;
    }
    (async () => {
      if (!(await isGetJdActive())) return { ok: false, error: 'Start Get JD first.' };
      const tab = await getTab(tabId);
      if (!tab?.url) return { ok: false, error: 'This page is no longer open.' };
      processGetJdPage(tabId, tab.url, `manual:${Date.now()}`, { force: msg.force === true }).catch((error) => {
        console.error('[QTS Get JD] Could not run Get JD again:', error);
      });
      return { ok: true };
    })()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: 'Could not run Get JD again.' }));
    return true;
  }

  if (msg.type === 'QTS_SET_GET_JD_AUTO_CLOSE') {
    chrome.storage.local.set({ [GET_JD_AUTO_CLOSE_KEY]: msg.enabled === true })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // The Bids page asks to open a résumé folder: Windows Explorer opens on the résumé this Chrome
  // downloaded there. Only the QTS site may ask; a folder saved by another Chrome is reported missing.
  if (msg.type === 'QTS_IS_QTS_SITE') {
    isQtsSite(sender.url).then((qtsSite) => sendResponse({ qtsSite }), () => sendResponse({ qtsSite: false }));
    return true;
  }
  if (msg.type === 'QTS_OPEN_RESUME_FOLDER') {
    (async () => {
      if (!(await isQtsSite(sender.url))) {
        sendResponse({ ok: false, error: 'Only the QTS site can open résumé folders.' });
        return;
      }
      sendResponse(await openDownloadedFolder(msg.folder));
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'The folder could not be opened.' }));
    return true;
  }

  if (msg.type === 'QTS_CLOSE_SIGN_IN_FRAME') {
    if (sender.url === chrome.runtime.getURL('signin/signin.html') && sender.tab?.id != null) {
      chrome.tabs.sendMessage(sender.tab.id, { type: 'QTS_HIDE_SIGN_IN_FRAME' }, { frameId: 0 })
        .catch(() => {});
    }
    return false;
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
        // Credentials are accepted only from the extension-origin sign-in frame, not page content scripts.
        if (sender.url !== chrome.runtime.getURL('signin/signin.html')) {
          sendResponse({ ok: false, error: 'Use the QTS Sign In form to sign in.' });
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
        let response;
        try {
          response = await fetch(`${serverUrl}/api/extension/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loginName, password }),
            signal: AbortSignal.timeout(20000),
          });
        } catch {
          sendResponse({ ok: false, error: 'Cannot connect to QTS. Check your connection and try again.' });
          return;
        }
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
        await Promise.allSettled([
          refreshManagerJobDetectionUrlRules(),
          fetchManagerPageExclusions(),
          getManagerExtensionFeatures(true),
        ]);
        sendResponse({ ok: true, signedIn: true });
        return;
      }
      if (action === 'sign_out') {
        const activeGeneration = await chrome.storage.local.get(ACTIVE_GENERATION_JOB_KEY);
        const activeJobId = activeGeneration[ACTIVE_GENERATION_JOB_KEY];
        if (typeof activeJobId === 'string' && activeJobId) {
          // Return the running job to the queue while the token can still authorize the request.
          const released = await workerApiRequest(
            'POST',
            '/api/extension/generation/release',
            { jobId: activeJobId },
          );
          if (!released.success) {
            console.warn('[QTS Generation] Could not release the running job before sign-out:', released.message);
          }
        }
        await self.__qtsAccountAuth?.clearAuth?.();
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null, [GET_JD_ON_KEY]: false });
        getJdInFlightTabs.clear();
        getJdLastPageByTab.clear();
        for (const [runningTabId, token] of generationCancellationByTab) {
          generationCancellationByTab.set(runningTabId, token + 1);
        }
        sendResponse({ ok: true, message: 'Signed out.' });
        return;
      }
      // Get JD's switch is separate from the work slot, so it has its own Cancel.
      if (action === 'cancel_get_jd') {
        await chrome.storage.local.set({ [GET_JD_ON_KEY]: false });
        getJdInFlightTabs.clear();
        getJdLastPageByTab.clear();
        if (tabId != null) {
          const result = await readGetJdResultForTab(tabId);
          if (result?.status === 'complete') await cancelGetJdReview(tabId);
        }
        sendResponse({ ok: true, status: 'get_jd_off', message: 'Get JD cancelled.' });
        return;
      }
      if (action === 'cancel_status') {
        const stored = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
        const cancelledStatus = stored[EXTENSION_STATUS_KEY];
        let serverCancelError = '';
        if (cancelledStatus === 'generation') {
          // Stop locally even if the server is unreachable; the run's cancel path retries server-side.
          const cancellation = await workerApiRequest(
            'POST',
            '/api/extension/generation/cancel-all',
            {},
          );
          if (!cancellation.success) {
            serverCancelError = cancellation.message || 'Could not reach QTS.';
          }
        }
        await stopWorkSlotLocally();
        const cancelledLabel = cancelledStatus === 'generation'
            ? 'Generation'
            : cancelledStatus === 'apply'
              ? 'Apply'
              : 'Current action';
        sendResponse({
          ok: true,
          status: 'cancel',
          cancelledStatus,
          warning: Boolean(serverCancelError),
          message: serverCancelError
            ? `${cancelledLabel} stopped in this browser. QTS was not updated yet: ${serverCancelError}`
            : `${cancelledLabel} cancelled.`,
        });
        return;
      }
      if (action === 'apply') {
        const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
        if (!token) {
          sendResponse({ ok: false, authRequired: true, error: 'Sign in before starting Apply.' });
          return;
        }
        const currentStatus = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
        if (currentStatus[EXTENSION_STATUS_KEY] === 'apply') {
          sendResponse({ ok: true, status: 'apply', message: 'Apply is already running.' });
          return;
        }
        if (currentStatus[EXTENSION_STATUS_KEY] === 'generation') {
          sendResponse({ ok: false, error: 'Generation is running in this Chrome. Stop it first, or run Apply in another Chrome.' });
          return;
        }
        const features = await workerApiRequest('GET', '/api/extension/features/me');
        if (features.success !== true || features.features?.canUseApply !== true) {
          sendResponse({ ok: false, error: features.message || 'Apply is not turned on for your account. Ask your Super Admin.' });
          return;
        }
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: 'apply' });
        const dryRun = (await chrome.storage.local.get(self.__qtsApplyRunner.APPLY_DRY_RUN_KEY))[self.__qtsApplyRunner.APPLY_DRY_RUN_KEY] === true;
        sendResponse({
          ok: true,
          status: 'apply',
          message: dryRun
            ? 'Apply started in test mode: it fills each form and stops before Submit.'
            : 'Apply started. It applies to Generation-completed jobs, oldest first.',
        });
        self.__qtsApplyRunner.processApplyQueue().catch((error) => {
          console.error('[QTS Apply] Queue worker failed:', error);
        });
        return;
      }
      if (action === 'generation') {
        const token = await self.__qtsAccountAuth?.getWorkerAuthToken?.();
        if (!token) {
          sendResponse({ ok: false, authRequired: true, error: 'Sign in before starting Generation.' });
          return;
        }
        const currentStatus = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
        if (currentStatus[EXTENSION_STATUS_KEY] === 'generation') {
          sendResponse({ ok: true, status: 'generation', message: 'Generation is already running.' });
          return;
        }
        if (currentStatus[EXTENSION_STATUS_KEY] === 'apply') {
          sendResponse({ ok: false, error: 'Apply is running in this Chrome. Stop it first, or run Generation in another Chrome.' });
          return;
        }
        await chrome.storage.local.remove([GENERATION_NOTICE_KEY, GENERATION_IDLE_NOTICE_KEY]);
        await chrome.storage.local.set({
          [GENERATION_QUEUE_RUN_KEY]: {
            runId: crypto.randomUUID(),
            excludedJobIds: [],
          },
        });
        await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: 'generation' });
        sendResponse({
          ok: true,
          status: 'generation',
          message: 'Generation started. Checking the oldest eligible saved job...',
        });
        processQueuedGenerationJobs().catch((error) => {
          console.error('[QTS Generation] Queue worker failed:', error);
        });
        return;
      }
      if (action === 'clear_applied_jobs') {
        const cleared = await workerApiRequest('POST', '/api/extension/get-jd/applied-cleanup', { action: 'clear' });
        sendResponse(cleared.success === true
          ? { ok: true, message: `Removed ${cleared.deleted} applied job row${cleared.deleted === 1 ? '' : 's'}. Their bids stay.` }
          : { ok: false, error: cleared.message || 'Could not clear the applied jobs.' });
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
      await chrome.storage.local.set({ [GET_JD_ON_KEY]: true });
      getJdLastPageByTab.clear();
      enableGetJdForTab(tabId).catch((error) => {
        console.error('[QTS Get JD] Could not start page monitoring:', error);
      });
      // After 4:00 PM Romania time the first Get JD start of the day (in any Chrome) asks to clear
      // applied job rows; the server answers whether to ask, once a day.
      const cleanup = await workerApiRequest('POST', '/api/extension/get-jd/applied-cleanup', { action: 'check' }).catch(() => null);
      sendResponse({
        ok: true,
        status: 'get_jd',
        message: 'Get JD is on. QTS checks each job page you open.',
        appliedCleanupCount: cleanup?.success === true && cleanup.ask === true ? Number(cleanup.appliedCount) || 0 : 0,
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
  if (msg.type === 'GET_MANAGER_CANDIDATE_PROFILES') {
    if (sender.tab?.id == null) {
      sendResponse({ ok: false, error: 'Candidate accounts must be loaded from a web page.' });
      return false;
    }
    workerApiRequest('GET', '/api/extension/get-jd/profiles')
      .then((response) => {
        if (response.success !== true || !Array.isArray(response.profiles)) {
          sendResponse({
            ok: false,
            error: response.message || 'Could not load candidate accounts.',
          });
          return;
        }
        sendResponse({
          ok: true,
          profiles: response.profiles.filter((profile) =>
            profile && typeof profile.id === 'string',
          ),
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not load candidate accounts.',
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
          await chrome.storage.local.set({ [GET_JD_ON_KEY]: false });
          sendResponse({
            ok: false,
            disabled: true,
            error: 'Gemini evaluation is paused. Use the in-page Get JD preview.',
          });
          return;
        }
        await chrome.storage.local.set({ [GET_JD_ON_KEY]: true });
        enableGetJdForTab(Number.isInteger(msg.tabId) ? msg.tabId : null)
          .catch((error) => {
            console.error('[QTS Get JD] Could not start current-page classification:', error);
          });
        if (Number.isInteger(msg.tabId)) {
          chrome.tabs.sendMessage(msg.tabId, { type: 'QTS_CLOSE_CAPTURE_PANEL' }).catch(() => {});
        }
      } else {
        await chrome.storage.local.set({ [GET_JD_ON_KEY]: false });
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
  if (msg.type === 'MANAGE_GLOBAL_TEXT_HIGHLIGHT') {
    (async () => {
      const actions = {
        create: { method: 'POST', path: '/api/extension/highlights' },
        update: { method: 'PUT', path: `/api/extension/highlights/${String(msg.ruleId || '')}` },
        delete: { method: 'DELETE', path: `/api/extension/highlights/${String(msg.ruleId || '')}` },
      };
      const action = Object.prototype.hasOwnProperty.call(actions, msg.action)
        ? actions[msg.action]
        : null;
      if (!action) {
        sendResponse({ success: false, message: 'Choose a valid highlight action.' });
        return;
      }
      if (msg.action !== 'create' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(msg.ruleId || ''))) {
        sendResponse({ success: false, message: 'Invalid highlight rule.' });
        return;
      }
      const result = await workerApiRequest(
        action.method,
        action.path,
        msg.action === 'delete' ? undefined : msg.rule,
      );
      if (!result.success || !Array.isArray(result.rules)) {
        sendResponse({
          success: false,
          message: result.message || 'Could not update shared text highlights.',
        });
        return;
      }
      const highlighting = self.__qtsTextHighlighting;
      if (!highlighting) {
        sendResponse({ success: false, message: 'Text highlight helper is unavailable.' });
        return;
      }
      const rules = highlighting.normalizeRules(result.rules);
      await chrome.storage.local.set({
        [highlighting.getGlobalStorageKey()]: rules,
        [highlighting.getGlobalStorageTimestampKey()]: Date.now(),
      });
      sendResponse({ success: true, rules });
    })().catch((error) => {
      console.error('[QTS text highlights] Could not update shared rules:', error);
      sendResponse({
        success: false,
        message: error instanceof Error ? error.message : 'Could not update shared text highlights.',
      });
    });
    return true;
  }
  if (msg.type === 'CHECK_EXTENSION_PAGE_ALLOWED') {
    if (sender.tab?.id == null || !sender.tab?.url) {
      sendResponse({ ok: false, error: 'The current page is unavailable.' });
      return false;
    }
    getCachedManagerJobDetectionUrlRules()
      .then(async (rules) => {
        const features = await getManagerExtensionFeatures();
        sendResponse({
          ok: true,
          excluded: isManagerBlockedUrl(sender.tab.url, rules),
          canManagePageExclusions: features.success === true
            && features.features?.canManagePageExclusions === true,
          canManageJobDetectionUrlRules: features.success === true
            && features.features?.canManageJobDetectionUrlRules === true,
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not verify blocked page URLs.',
      }));
    return true;
  }
  if (msg.type === 'GET_MANAGER_PAGE_EXCLUSIONS') {
    getManagerPageExclusions()
      .then((result) => sendResponse({
        ok: result.success === true,
        exclusions: result.exclusions || [],
        canManagePageExclusions: result.canManagePageExclusions === true,
        error: result.success === true
          ? undefined
          : result.message || 'Could not load job-page detection keywords.',
      }))
      .catch((error) => sendResponse({
        ok: false,
        exclusions: [],
        canManagePageExclusions: false,
        error: error instanceof Error ? error.message : 'Could not load job-page detection keywords.',
      }));
    return true;
  }
  if (msg.type === 'ADD_MANAGER_PAGE_EXCLUSION') {
    (async () => {
      const url = self.__qtsPageExclusions.normalizePageDetectionKeyword(msg.url);
      if (!url) {
        sendResponse({ ok: false, error: 'Enter a job-page keyword between 2 and 200 characters.' });
        return;
      }
      const result = await workerApiRequest('POST', '/api/extension/page-exclusions', { url });
      const saved = await savePageExclusionsResponse(result);
      if (saved.success === true) recheckLoadedPagesForManagerJobRules().catch(() => {});
      sendResponse({
        ok: saved.success === true,
        exclusions: saved.exclusions || [],
        error: saved.success === true ? undefined : saved.message || 'Could not save this job-page keyword.',
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save this job-page keyword.',
    }));
    return true;
  }
  if (msg.type === 'DELETE_MANAGER_PAGE_EXCLUSION') {
    (async () => {
      const exclusionId = String(msg.exclusionId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(exclusionId)) {
        sendResponse({ ok: false, error: 'Invalid job-page keyword ID.' });
        return;
      }
      const result = await workerApiRequest(
        'DELETE',
        `/api/extension/page-exclusions/${exclusionId}`,
      );
      const saved = await savePageExclusionsResponse(result);
      if (saved.success === true) recheckLoadedPagesForManagerJobRules().catch(() => {});
      sendResponse({
        ok: saved.success === true,
        exclusions: saved.exclusions || [],
        error: saved.success === true ? undefined : saved.message || 'Could not remove this job-page keyword.',
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not remove this job-page keyword.',
    }));
    return true;
  }
  if (msg.type === 'UPDATE_MANAGER_PAGE_EXCLUSION') {
    (async () => {
      const exclusionId = String(msg.exclusionId || '');
      const url = self.__qtsPageExclusions.normalizePageDetectionKeyword(msg.url);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(exclusionId)) {
        sendResponse({ ok: false, error: 'Invalid job-page keyword ID.' });
        return;
      }
      if (!url) {
        sendResponse({ ok: false, error: 'Enter a job-page keyword between 2 and 200 characters.' });
        return;
      }
      const result = await workerApiRequest(
        'PUT',
        `/api/extension/page-exclusions/${exclusionId}`,
        { url },
      );
      const saved = await savePageExclusionsResponse(result);
      if (saved.success === true) recheckLoadedPagesForManagerJobRules().catch(() => {});
      sendResponse({
        ok: saved.success === true,
        exclusions: saved.exclusions || [],
        error: saved.success === true ? undefined : saved.message || 'Could not update this job-page keyword.',
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not update this job-page keyword.',
    }));
    return true;
  }
  if (msg.type === 'GET_MANAGER_JOB_DETECTION_URL_RULES') {
    refreshManagerJobDetectionUrlRules()
      .then((result) => sendResponse({
        ok: result.success === true,
        rules: result.rules || [],
        canManageJobDetectionUrlRules: result.canManageJobDetectionUrlRules === true,
        error: result.success === true
          ? undefined
          : result.message || 'Could not load job-detection URL rules.',
      }))
      .catch((error) => sendResponse({
        ok: false,
        rules: [],
        canManageJobDetectionUrlRules: false,
        error: error instanceof Error ? error.message : 'Could not load job-detection URL rules.',
      }));
    return true;
  }
  if (msg.type === 'ADD_MANAGER_JOB_DETECTION_URL_RULE') {
    (async () => {
      const url = self.__qtsJobDetectionUrlRules.normalizeJobDetectionUrlRule(msg.url);
      if (!url) {
        sendResponse({ ok: false, error: 'Enter a URL fragment to block.' });
        return;
      }
      const result = await workerApiRequest('POST', '/api/extension/job-detection-url-rules', { url });
      const saved = await saveManagerJobDetectionUrlRulesResponse(result);
      sendResponse({
        ok: saved.success === true,
        rules: saved.rules || [],
        error: saved.success === true ? undefined : saved.message || 'Could not save this job-detection URL rule.',
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save this job-detection URL rule.',
    }));
    return true;
  }
  if (msg.type === 'UPDATE_MANAGER_JOB_DETECTION_URL_RULE') {
    (async () => {
      const ruleId = String(msg.ruleId || '');
      const url = self.__qtsJobDetectionUrlRules.normalizeJobDetectionUrlRule(msg.url);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ruleId)) {
        sendResponse({ ok: false, error: 'Invalid job-detection URL rule.' });
        return;
      }
      if (!url) {
        sendResponse({ ok: false, error: 'Enter a URL fragment to block.' });
        return;
      }
      const result = await workerApiRequest(
        'PUT',
        `/api/extension/job-detection-url-rules/${ruleId}`,
        { url },
      );
      const saved = await saveManagerJobDetectionUrlRulesResponse(result);
      sendResponse({
        ok: saved.success === true,
        rules: saved.rules || [],
        error: saved.success === true ? undefined : saved.message || 'Could not update this job-detection URL rule.',
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not update this job-detection URL rule.',
    }));
    return true;
  }
  if (msg.type === 'DELETE_MANAGER_JOB_DETECTION_URL_RULE') {
    (async () => {
      const ruleId = String(msg.ruleId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ruleId)) {
        sendResponse({ ok: false, error: 'Invalid job-detection URL rule.' });
        return;
      }
      const result = await workerApiRequest(
        'DELETE',
        `/api/extension/job-detection-url-rules/${ruleId}`,
      );
      const saved = await saveManagerJobDetectionUrlRulesResponse(result);
      sendResponse({
        ok: saved.success === true,
        rules: saved.rules || [],
        error: saved.success === true ? undefined : saved.message || 'Could not delete this job-detection URL rule.',
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not delete this job-detection URL rule.',
    }));
    return true;
  }
  if (msg.type === 'GET_MANAGER_EXTENSION_FEATURES') {
    getManagerExtensionFeatures(msg.refresh === true)
      .then((result) => sendResponse({
        ok: result.success === true,
        canManageTextHighlights: result.features?.canManageTextHighlights === true,
        canManagePageExclusions: result.features?.canManagePageExclusions === true,
        canManageJobDetectionUrlRules: result.features?.canManageJobDetectionUrlRules === true,
        tabId: sender.tab?.id ?? null,
        error: result.success === true
          ? undefined
          : result.message || 'Could not verify text highlight permissions.',
      }))
      .catch((error) => sendResponse({
        ok: false,
        canManageTextHighlights: false,
        canManagePageExclusions: false,
        canManageJobDetectionUrlRules: false,
        error: error instanceof Error ? error.message : 'Could not verify text highlight permissions.',
      }));
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
      const entry = await buildManagerDetectedJobEntry(tab.id, pageUrl, result.data);
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
    if (!tabId || !url || !isExtractablePageUrl(url)) return false;
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
  if (
    area === 'local'
    && (
      changes[JOB_DETECTION_URL_RULES_STORAGE_KEY]
      || changes[JOB_DETECTION_URL_RULES_MANAGER_ID_KEY]
    )
  ) {
    chrome.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (!tab.id || !/^https?:/i.test(tab.url || '')) continue;
        notifyPageUrlAccess(tab.id, tab.url).catch((error) => {
          console.warn('[QTS blocked URLs] Could not refresh an open page:', error);
        });
      }
    }).catch((error) => {
      console.warn('[QTS blocked URLs] Could not find open pages to refresh:', error);
    });
  }
  if (area === 'local' && changes.authExpiresAt) {
    if (!changes.authExpiresAt.newValue) {
      disarmJobPageActivity();
      chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null, [GET_JD_ON_KEY]: false }).catch(() => {});
      // Reviews contain the previous Manager's candidates and must not survive a session change.
      chrome.storage.local.remove(GET_JD_RESULTS_KEY).catch(() => {});
      getJdInFlightTabs.clear();
      getJdLastPageByTab.clear();
    }
    return;
  }
  if (area === 'local' && changes[AUTO_APPLY_ENABLED_KEY] && !changes[AUTO_APPLY_ENABLED_KEY].newValue) {
    disarmJobPageActivity();
  }
});

// The queue alarm restarts or recovers a run, so it only ticks while Generation is running or cancelling.
// Every 30 seconds, while signed in with a mode on, this Chrome tells QTS which modes it runs and
// learns whether "Stop all" was pressed on the Jobs page, which stops that mode here.
const BROWSER_HEARTBEAT_ALARM = 'qts-browser-heartbeat';
const STOP_VERSIONS_KEY = 'qtsStopVersions';

async function browserModes() {
  const stored = await chrome.storage.local.get([GET_JD_ON_KEY, EXTENSION_STATUS_KEY, 'authExpiresAt']);
  const status = stored[EXTENSION_STATUS_KEY];
  return {
    signedIn: (Number(stored.authExpiresAt) || 0) > Date.now(),
    getJdOn: stored[GET_JD_ON_KEY] === true,
    workMode: status === 'generation' || status === 'apply' ? status : 'off',
  };
}

async function syncBrowserHeartbeatAlarm() {
  const modes = await browserModes();
  if (modes.signedIn && (modes.getJdOn || modes.workMode !== 'off')) {
    if (!(await chrome.alarms.get(BROWSER_HEARTBEAT_ALARM))) {
      await chrome.alarms.create(BROWSER_HEARTBEAT_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    }
  } else {
    await chrome.alarms.clear(BROWSER_HEARTBEAT_ALARM);
  }
}

/** Stops the work slot in this Chrome only (Cancel, or "Stop all" seen on a heartbeat). */
async function stopWorkSlotLocally() {
  await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: 'cancel' });
  for (const [runningTabId, token] of generationCancellationByTab) {
    generationCancellationByTab.set(runningTabId, token + 1);
  }
}

async function sendBrowserHeartbeat() {
  const modes = await browserModes();
  if (!modes.signedIn) return;
  const response = await workerApiRequest('POST', '/api/extension/browsers/heartbeat', {
    getJdOn: modes.getJdOn,
    workMode: modes.workMode,
  });
  if (response.success !== true) return;
  const stored = await chrome.storage.local.get(STOP_VERSIONS_KEY);
  const previous = stored[STOP_VERSIONS_KEY];
  const current = {
    generation: Number(response.generationStopVersion) || 0,
    apply: Number(response.applyStopVersion) || 0,
  };
  await chrome.storage.local.set({ [STOP_VERSIONS_KEY]: current });
  if (!previous) return;
  const stopped = (modes.workMode === 'generation' && current.generation > previous.generation)
    || (modes.workMode === 'apply' && current.apply > previous.apply);
  if (stopped) {
    await stopWorkSlotLocally();
    const label = modes.workMode === 'generation' ? 'Generation' : 'Apply';
    await notifyWorkStopped(`${label} was stopped from the Jobs page ("Stop all").`);
  }
}

async function notifyWorkStopped(message) {
  await new Promise((resolve) => {
    chrome.notifications.create(
      { type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon128.png'), title: 'QTS', message },
      () => resolve(),
    );
  });
}

async function syncGenerationQueueAlarm() {
  const stored = await chrome.storage.local.get([EXTENSION_STATUS_KEY, ACTIVE_GENERATION_JOB_KEY]);
  const status = stored[EXTENSION_STATUS_KEY];
  if (status === 'generation' || status === 'cancel' || stored[ACTIVE_GENERATION_JOB_KEY]) {
    if (!(await chrome.alarms.get(GENERATION_QUEUE_ALARM))) {
      await chrome.alarms.create(GENERATION_QUEUE_ALARM, {
        delayInMinutes: 0.5,
        periodInMinutes: 0.5,
      });
    }
  } else {
    await chrome.alarms.clear(GENERATION_QUEUE_ALARM);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[EXTENSION_STATUS_KEY] || changes[GET_JD_ON_KEY] || changes.authExpiresAt) {
    syncBrowserHeartbeatAlarm().catch(() => {});
    self.__qtsApplyRunner?.syncApplyQueueAlarm().catch(() => {});
    // A mode change reaches QTS at once instead of on the next heartbeat.
    if (changes[EXTENSION_STATUS_KEY] || changes[GET_JD_ON_KEY]) sendBrowserHeartbeat().catch(() => {});
  }
  if (!(changes[EXTENSION_STATUS_KEY] || changes[ACTIVE_GENERATION_JOB_KEY])) return;
  syncGenerationQueueAlarm().catch((error) => {
    console.error('[QTS Generation] Could not update the queue alarm:', error);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  // After an update both switches start off, so a Chrome never resumes work under new rules by itself.
  if (details?.reason === 'update') {
    chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null, [GET_JD_ON_KEY]: false }).catch(() => {});
  }
  syncGenerationQueueAlarm().catch((error) => {
    console.error('[QTS Generation] Could not update the queue alarm:', error);
  });
  self.__qtsCustomGpt?.loadCustomGptConfigFromStorage?.().catch(() => {});
});

self.chrome?.runtime?.onStartup?.addListener(() => {
  syncBrowserHeartbeatAlarm().catch(() => {});
  self.__qtsApplyRunner?.syncApplyQueueAlarm().catch(() => {});
  syncGenerationQueueAlarm().catch((error) => {
    console.error('[QTS Generation] Could not update the queue alarm:', error);
  });
  processQueuedGenerationJobs().catch((error) => {
    console.error('[QTS Generation] Queue worker failed:', error);
  });
});

self.chrome?.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === self.__qtsApplyRunner?.APPLY_QUEUE_ALARM) {
    self.__qtsApplyRunner.processApplyQueue().catch((error) => console.error('[QTS Apply] Queue worker failed:', error));
    return;
  }
  if (alarm.name === BROWSER_HEARTBEAT_ALARM) {
    sendBrowserHeartbeat().catch((error) => console.warn('[QTS] Chrome heartbeat failed:', error));
    return;
  }
  if (alarm.name !== GENERATION_QUEUE_ALARM) return;
  processQueuedGenerationJobs().catch((error) => {
    console.error('[QTS Generation] Queue worker failed:', error);
  });
});

self.__qtsCustomGpt?.loadCustomGptConfigFromStorage?.().catch(() => {});

// The launcher's page scripts, added to a tab that has none: one opened before the extension was
// installed or reloaded, which Chrome leaves without the manifest's content scripts.
const TOOLBAR_LAUNCHER_FILES = ['content/page-toast.js', 'content/page-launcher.js'];

async function sendToolbarClick(tab) {
  const message = { type: 'QTS_TOOLBAR_ICON_CLICKED' };
  try {
    return await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  } catch (error) {
    if (!/^https?:/i.test(tab.url || '')) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: TOOLBAR_LAUNCHER_FILES });
    return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }
}

// The toolbar icon toggles the page Sign In form while signed out and the launcher actions after sign-in.
chrome.action.onClicked.addListener((tab) => {
  if (tab?.id == null) return;
  sendToolbarClick(tab)
    .then((response) => {
      if (response?.ok) return;
      chrome.notifications?.create?.(`qts-toolbar-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icon128.png'),
        title: 'QTS_Startup',
        message: response?.excluded
          ? 'QTS is turned off on this page.'
          : 'QTS could not open on this page.',
      });
    })
    .catch(() => {
      // A browser page, the web store, or a page that refused the injected scripts.
      chrome.notifications?.create?.(`qts-toolbar-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icon128.png'),
        title: 'QTS_Startup',
        message: /^https?:/i.test(tab.url || '')
          ? 'Reload this page to use QTS.'
          : 'QTS works on web pages. Open a website and click the icon again.',
      });
    });
});

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

// Get JD starts once the page HTML is ready instead of waiting for every image and ad;
// detection then waits for the content to settle.
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  if (details.frameId !== 0) return;
  if (details.documentLifecycle && details.documentLifecycle !== 'active') return;
  if (!isExtractablePageUrl(details.url)) return;
  processGetJdPage(details.tabId, details.url, details.documentId || `dom:${Date.now()}`).catch((error) => {
    console.error('[QTS Get JD] Could not process the loaded page:', error);
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isExtractablePageUrl(details.url)) return;
  if (isChatGptHostUrl(details.url)) return;
  injectedExtractorTabs.delete(details.tabId);
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
  if (!/^https?:/i.test(details.url || '')) return;
  notifyPageUrlAccess(details.tabId, details.url).catch((error) => {
    console.warn('[QTS extension] Could not apply URL exclusions after navigation:', error);
  });
  if (!isExtractablePageUrl(details.url)) return;
  processGetJdPage(details.tabId, details.url, details.documentId).catch((error) => {
    console.error('[QTS Get JD] Could not process the updated page:', error);
  });
  (async () => {
    if (await isAutoApplyArmed()) maybeDetectApplyMethodOnOpen(details.tabId, details.url);
    maybeTrackAutoOpen(details.tabId, details.url);
  })().catch(() => {});
});

// Where each tab's page was opened from, for the job's source site (Bids): the tab whose link
// opened it, or the page before it in the same tab. Redirect pages are skipped; typed, pasted and
// bookmarked addresses have none, and QTS's own tabs are left out. The server turns it into the
// site's main address (src/server/jobs/source-site.ts).
const TAB_SOURCES_KEY = 'qtsTabSources';
const REDIRECT_HOSTS = /^(?:lnkd\.in|t\.co|bit\.ly|l\.facebook\.com|lm\.facebook\.com|out\.reddit\.com)$/i;
let tabSourcesWrite = Promise.resolve();

function updateTabSource(tabId, change) {
  tabSourcesWrite = tabSourcesWrite.then(async () => {
    const stored = (await chrome.storage.session.get(TAB_SOURCES_KEY))[TAB_SOURCES_KEY] || {};
    const next = change(stored[tabId] || { source: null, last: null });
    if (next) stored[tabId] = next;
    else delete stored[tabId];
    await chrome.storage.session.set({ [TAB_SOURCES_KEY]: stored });
  }).catch(() => {});
  return tabSourcesWrite;
}

function isRedirectPage(url) {
  try {
    const page = new URL(url);
    return REDIRECT_HOSTS.test(page.hostname)
      || (/\/(?:redir|redirect|url|out)\b/i.test(page.pathname) && /[?&](?:url|u|q|target|dest)=/i.test(page.search));
  } catch {
    return true;
  }
}

/** The page a tab's job was opened from, or null when it is not known (typed, pasted, QTS's own). */
async function tabOpenedFrom(tabId) {
  await tabSourcesWrite;
  const entry = ((await chrome.storage.session.get(TAB_SOURCES_KEY))[TAB_SOURCES_KEY] || {})[tabId];
  const source = entry?.source || null;
  if (!source || await isQtsSite(source)) return null;
  return source;
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || !/^https?:/i.test(details.url || '')) return;
  const redirected = (details.transitionQualifiers || []).some((qualifier) => qualifier === 'server_redirect' || qualifier === 'client_redirect');
  updateTabSource(details.tabId, (entry) => {
    let source = entry.source;
    if (!redirected) {
      if (details.transitionType === 'link' || details.transitionType === 'form_submit') {
        // A link in the same tab: the page before it (unless that was a redirect page).
        if (entry.last && !isRedirectPage(entry.last)) source = entry.last;
      } else if (details.transitionType !== 'reload') {
        // Typed, pasted, a bookmark, history, the start page: nothing opened it.
        source = null;
      }
    }
    return { source, last: details.url };
  });
});

// Ownership passes to tabs opened from a workflow's tab or in a workflow's window.
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  tabOwnership.inherit(details.tabId, { sourceTabId: details.sourceTabId }).catch(() => {});
  // A link that opened a new tab: the source is the page it was clicked on.
  (async () => {
    if (await tabOwnership.ownerOf(details.sourceTabId)) return;
    const opener = await getTab(details.sourceTabId);
    if (!/^https?:/i.test(opener?.url || '')) return;
    await updateTabSource(details.tabId, () => ({ source: opener.url, last: null }));
  })().catch(() => {});
});
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id == null) return;
  tabOwnership.inherit(tab.id, { sourceTabId: tab.openerTabId ?? null, windowId: tab.windowId }).catch(() => {});
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  tabOwnership.replaceTab(addedTabId, removedTabId).catch(() => {});
});
chrome.windows.onRemoved.addListener((windowId) => {
  tabOwnership.releaseWindow(windowId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabOwnership.releaseTab(tabId).catch(() => {});
  updateTabSource(tabId, () => null);
  lastAutoDetectKeyByTab.delete(tabId);
  capturePanelOpenPromisesByTab.delete(tabId);
  lastAutoPipelineKeyByTab.delete(tabId);
  lastApplyMethodDetectKeyByTab.delete(tabId);
  autoPipelineInFlight.delete(tabId);
  injectedExtractorTabs.delete(tabId);
  extractorInjectInFlight.delete(tabId);
  detectGenerationByTab.delete(tabId);
  getJdFinishedPageByTab.delete(tabId);
  removeDetectedJobForTab(tabId).catch(() => {});
  removeApplyTemplateForTab(tabId).catch(() => {});
  removeDiscoveryCheckpointForTab(tabId).catch(() => {});
  chrome.storage.local.get([GPT_TAB_STORAGE_KEY], (stored) => {
    if (stored[GPT_TAB_STORAGE_KEY] === tabId) {
      chrome.storage.local.remove(GPT_TAB_STORAGE_KEY);
    }
  });
});

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
