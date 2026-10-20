// Shared API prefetch helpers (service worker + popup via importScripts / script tag)

const PREFETCH_CANDIDATE_CACHE_KEY = 'qtsCandidateCache';
const PREFETCH_SESSION_USER_KEY = 'qtsSessionUser';
const PREFETCH_CUSTOM_GPT_CONFIG_KEY = 'qtsCustomGptConfig';
const PREFETCH_SAVED_JOB_CACHE_KEY = 'qtsSavedJobCache';
const PREFETCH_WORKSPACE_TTL_MS = 5 * 60 * 1000;
const PREFETCH_SAVED_JOB_TTL_MS = 3 * 60 * 1000;
const PREFETCH_TAB_CONTEXT_TTL_MS = 8 * 1000;
const PREFETCH_SAVED_JOB_CONCURRENCY = 4;

let workspaceFetchPromise = null;
const tabContextPrefetchAt = new Map();

async function prefetchReadAuthToken() {
  const auth = (typeof self !== 'undefined' ? self : globalThis).__qtsAccountAuth;
  if (auth?.getWorkerAuthToken) {
    return auth.getWorkerAuthToken();
  }
  const stored = await chrome.storage.local.get(['authToken', 'authExpiresAt']);
  if (stored.authExpiresAt && Date.now() >= Number(stored.authExpiresAt)) {
    return '';
  }
  return stored.authToken || '';
}

async function prefetchApiRequest(path) {
  const runtimeConfig = (typeof self !== 'undefined' ? self : globalThis).__qtsRuntimeConfig;
  const features = runtimeConfig?.features || {};
  if (features.scanner !== true && features.applicationAutomation !== true) {
    return { success: false, disabled: true };
  }
  const token = await prefetchReadAuthToken();
  if (!token) return { success: false, _noToken: true };

  const serverUrl = await runtimeConfig.getServerUrl();
  const url = serverUrl.replace(/\/$/, '') + path;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    let data;
    try {
      data = await response.json();
    } catch {
      return { success: false, message: 'Invalid server response.', _httpStatus: response.status };
    }
    if (!response.ok && data.success !== false) data.success = false;
    data._httpStatus = response.status;
    return data;
  } catch {
    return { success: false, message: 'Cannot connect to the server.', _httpStatus: 0 };
  }
}

async function prefetchReadCandidateCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PREFETCH_CANDIDATE_CACHE_KEY], (result) => {
      const cache = result[PREFETCH_CANDIDATE_CACHE_KEY];
      if (!cache?.savedAt) {
        resolve(null);
        return;
      }
      if (Date.now() - cache.savedAt > PREFETCH_WORKSPACE_TTL_MS) {
        resolve(null);
        return;
      }
      resolve(cache);
    });
  });
}

async function prefetchWriteCandidateCache(candidates, stacks, user) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [PREFETCH_CANDIDATE_CACHE_KEY]: {
        savedAt: Date.now(),
        user: user || null,
        candidates: candidates || [],
        stacks: stacks || [],
      },
    }, resolve);
  });
}

async function prefetchWriteSessionUser(user) {
  if (!user) return;
  const snapshot = {
    id: user.id,
    username: user.username,
    role: user.role,
    accountId: user.accountId != null ? Number(user.accountId) : null,
    accountName: user.accountName ?? null,
  };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PREFETCH_SESSION_USER_KEY]: snapshot }, resolve);
  });
}

async function prefetchWriteCustomGptConfig(customGpt, user) {
  if (!customGpt?.url) {
    const root = typeof globalThis !== 'undefined' ? globalThis : self;
    root.__qtsCustomGpt?.applyCustomGptConfig?.(null);
    await new Promise((resolve) => {
      chrome.storage.local.remove([PREFETCH_CUSTOM_GPT_CONFIG_KEY, 'qtsCustomGptTabId'], resolve);
    });
    return;
  }
  const payload = {
    url: customGpt.url,
    id: customGpt.id || null,
    source: customGpt.source || 'account',
    accountId: user?.accountId ?? null,
    savedAt: Date.now(),
  };
  const root = typeof globalThis !== 'undefined' ? globalThis : self;
  if (typeof root.__qtsCustomGpt?.persistCustomGptConfig === 'function') {
    await root.__qtsCustomGpt.persistCustomGptConfig(payload);
    return;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PREFETCH_CUSTOM_GPT_CONFIG_KEY]: payload }, resolve);
  });
}

async function prefetchWorkspace(force = false) {
  if (!force) {
    const cached = await prefetchReadCandidateCache();
    if (cached?.user && Array.isArray(cached.candidates) && cached.candidates.length > 0) {
      const assignedGpt = await prefetchApiRequest('/api/v2/auth/custom-gpt-assignment');
      await prefetchWriteCustomGptConfig(
        assignedGpt.success ? assignedGpt.customGpt : null,
        cached.user
      );
      return { success: true, fromCache: true, user: cached.user, candidates: cached.candidates, stacks: cached.stacks || [] };
    }
  }

  if (workspaceFetchPromise) {
    return workspaceFetchPromise;
  }

  workspaceFetchPromise = (async () => {
    const boot = await prefetchApiRequest('/api/auth/extension-bootstrap');
    if (!boot.success || !boot.user) return boot;

    const candidates = boot.candidates || [];
    const stacks = boot.stacks || [];
    const assignedGpt = await prefetchApiRequest('/api/v2/auth/custom-gpt-assignment');
    await prefetchWriteSessionUser(boot.user);
    await prefetchWriteCustomGptConfig(
      assignedGpt.success ? assignedGpt.customGpt : null,
      boot.user
    );
    if (candidates.length) {
      await prefetchWriteCandidateCache(candidates, stacks, boot.user);
    }
    return { success: true, user: boot.user, candidates, stacks, customGpt: boot.customGpt || null };
  })();

  try {
    return await workspaceFetchPromise;
  } finally {
    workspaceFetchPromise = null;
  }
}

async function prefetchWorkspaceIfStale() {
  return prefetchWorkspace(false);
}

function prefetchSavedJobKey(url) {
  return typeof normalizeJobUrl === 'function' ? normalizeJobUrl(url) : String(url || '').trim();
}

async function prefetchReadSavedJobsMap() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PREFETCH_SAVED_JOB_CACHE_KEY], (result) => {
      resolve(result[PREFETCH_SAVED_JOB_CACHE_KEY] || {});
    });
  });
}

async function readSavedJobFromCache(url) {
  const key = prefetchSavedJobKey(url);
  if (!key) return null;
  const map = await prefetchReadSavedJobsMap();
  const entry = map[key];
  if (!entry?.savedAt) return null;
  if (Date.now() - entry.savedAt > PREFETCH_SAVED_JOB_TTL_MS) return null;
  return entry.job || null;
}

async function writeSavedJobToCache(url, job) {
  const key = prefetchSavedJobKey(url);
  if (!key) return;
  const map = await prefetchReadSavedJobsMap();
  map[key] = { savedAt: Date.now(), job: job || null };
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PREFETCH_SAVED_JOB_CACHE_KEY]: map }, resolve);
  });
}

async function prefetchSavedJobByUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed || !trimmed.startsWith('http')) return null;

  const cached = await readSavedJobFromCache(trimmed);
  if (cached) return cached;

  const key = prefetchSavedJobKey(trimmed);
  const map = await prefetchReadSavedJobsMap();
  const entry = map[key];
  if (entry && entry.job === null && entry.savedAt && Date.now() - entry.savedAt < PREFETCH_SAVED_JOB_TTL_MS) {
    return null;
  }

  const stored = await chrome.storage.local.get([PREFETCH_SESSION_USER_KEY]);
  const isManager = stored[PREFETCH_SESSION_USER_KEY]?.role === 'manager';
  const path = isManager
    ? `/api/v2/jobs/check-url?url=${encodeURIComponent(trimmed)}`
    : `/api/jobs/by-url?url=${encodeURIComponent(trimmed)}`;
  const r = await prefetchApiRequest(path);
  if (r.success && r.job) {
    await writeSavedJobToCache(trimmed, r.job);
    return r.job;
  }
  if (r._httpStatus === 404 || r.success === false) {
    await writeSavedJobToCache(trimmed, null);
  }
  return null;
}

async function prefetchSavedJobsForUrls(urls) {
  const seen = new Set();
  const queue = [];
  for (const raw of urls || []) {
    const url = String(raw || '').trim();
    if (!url || !url.startsWith('http')) continue;
    const key = prefetchSavedJobKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queue.push(url);
  }

  let index = 0;
  async function worker() {
    while (index < queue.length) {
      const current = queue[index++];
      await prefetchSavedJobByUrl(current);
    }
  }

  const workers = Math.min(PREFETCH_SAVED_JOB_CONCURRENCY, queue.length);
  if (!workers) return;
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

async function prefetchTabContext(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return;

  const now = Date.now();
  const lastPrefetch = tabContextPrefetchAt.get(id) || 0;
  if (now - lastPrefetch < PREFETCH_TAB_CONTEXT_TTL_MS) return;
  tabContextPrefetchAt.set(id, now);

  const token = await prefetchReadAuthToken();
  if (!token) return;

  await prefetchWorkspaceIfStale();

  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  if (!tab?.url) return;

  const urls = [tab.url];
  if (typeof getDetectedJobForTab === 'function') {
    const detected = await getDetectedJobForTab(tabId);
    if (detected?.data?.url) urls.push(detected.data.url);
    if (detected?.url) urls.push(detected.url);
  }

  await prefetchSavedJobsForUrls(urls);
}
