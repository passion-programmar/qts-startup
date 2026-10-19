// Custom GPT handoff — pinned tab reuse + PROCESS_TASK protocol.
(function (global) {
  const DEFAULT_CUSTOM_GPT_URL =
    'https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking';
  const DEFAULT_CUSTOM_GPT_ID = 'g-6a3dc5525fac819198dccf1c216e3fc0';
  const TASK_PREFIX = 'PROCESS_TASK:';
  const STORAGE_KEY = 'qtsCustomGptConfig';
  const PINNED_TAB_STORAGE_KEY = 'qtsCustomGptTabId';

  let _runtime = {
    url: DEFAULT_CUSTOM_GPT_URL,
    id: DEFAULT_CUSTOM_GPT_ID,
    source: 'default',
    accountId: null,
  };

  function parseGptIdFromUrl(url) {
    const match = String(url || '').match(/\/g\/(g-[a-f0-9]+)/i);
    return match ? match[1] : null;
  }

  function applyCustomGptConfig(config) {
    const nextUrl = config?.url
      ? String(config.url).trim().replace(/\/+$/, '')
      : DEFAULT_CUSTOM_GPT_URL;
    const nextId = config?.id || parseGptIdFromUrl(nextUrl) || DEFAULT_CUSTOM_GPT_ID;
    const changed = _runtime.url !== nextUrl || _runtime.id !== nextId;
    _runtime = {
      url: nextUrl,
      id: nextId,
      source: config?.source || (config?.url ? 'account' : 'default'),
      accountId: config?.accountId ?? null,
    };
    return { changed, url: nextUrl, id: nextId };
  }

  function getCustomGptUrl() {
    return _runtime.url;
  }

  function getCustomGptId() {
    return _runtime.id;
  }

  function getCanonicalGptUrl() {
    return _runtime.url.replace(/\/+$/, '');
  }

  function getGptPathname() {
    try {
      return new URL(getCanonicalGptUrl()).pathname.replace(/\/+$/, '');
    } catch {
      return `/g/${getCustomGptId()}-qts-job-tracking`;
    }
  }

  function buildTaskId(applicationId) {
    const id = Number(applicationId);
    if (!Number.isFinite(id) || id < 1) {
      throw new Error('Valid application session ID required');
    }
    return `task_${id}`;
  }

  function buildPrompt(taskId) {
    const id = String(taskId || '').trim();
    if (!id) throw new Error('Task ID required');
    return `${TASK_PREFIX} ${id}`;
  }

  function openForSession(applicationId) {
    const taskId = buildTaskId(applicationId);
    return {
      url: getCanonicalGptUrl(),
      taskId,
      prompt: buildPrompt(taskId),
    };
  }

  function isCustomGptBaseUrl(url) {
    if (!url) return false;
    try {
      const base = new URL(getCanonicalGptUrl());
      const current = new URL(url);
      if (current.origin !== base.origin) return false;
      const norm = (path) => path.replace(/\/+$/, '');
      return norm(current.pathname) === norm(base.pathname);
    } catch {
      return false;
    }
  }

  /** True when tab is on Custom GPT but inside an existing /c/ conversation (needs fresh chat). */
  function needsFreshGptConversation(url) {
    if (!url || !url.includes(getCustomGptId())) return true;
    return !isCustomGptBaseUrl(url);
  }

  function persistCustomGptConfig(config) {
    const applied = applyCustomGptConfig(config);
    const payload = {
      url: applied.url,
      id: applied.id,
      source: config?.source || _runtime.source,
      accountId: config?.accountId ?? _runtime.accountId ?? null,
      savedAt: Date.now(),
    };

    const finalize = () => payload;
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return Promise.resolve(finalize());
    }

    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (stored) => {
        const previous = stored[STORAGE_KEY];
        const tasks = [];
        tasks.push(new Promise((res) => {
          chrome.storage.local.set({ [STORAGE_KEY]: payload }, res);
        }));
        if (applied.changed || previous?.url !== payload.url) {
          tasks.push(new Promise((res) => {
            chrome.storage.local.remove(PINNED_TAB_STORAGE_KEY, res);
          }));
        }
        Promise.all(tasks).then(() => resolve(finalize()));
      });
    });
  }

  function loadCustomGptConfigFromStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (stored) => {
        const config = stored[STORAGE_KEY];
        if (config?.url) {
          applyCustomGptConfig(config);
          resolve(config);
          return;
        }
        resolve(null);
      });
    });
  }

  global.__qtsCustomGpt = {
    DEFAULT_CUSTOM_GPT_URL,
    DEFAULT_CUSTOM_GPT_ID,
    STORAGE_KEY,
    TASK_PREFIX,
    get CUSTOM_GPT_URL() { return getCanonicalGptUrl(); },
    get CUSTOM_GPT_ID() { return getCustomGptId(); },
    getCanonicalGptUrl,
    getGptPathname,
    getCustomGptUrl,
    getCustomGptId,
    applyCustomGptConfig,
    persistCustomGptConfig,
    loadCustomGptConfigFromStorage,
  ACTION_STEPS: [
      { id: 'dispatch', label: 'PROCESS_TASK → pinned GPT tab', actor: 'extension' },
      { id: 'getTaskContext', label: 'getTaskContext', actor: 'gpt' },
      { id: 'submitTaskPackage', label: 'submitTaskPackage', actor: 'gpt' },
      { id: 'getTaskStatus', label: 'getTaskStatus (ready)', actor: 'gpt' },
      { id: 'apply', label: 'Apply answers on job form', actor: 'extension' },
    ],
    buildTaskId,
    buildPrompt,
    openForSession,
    isCustomGptBaseUrl,
    needsFreshGptConversation,
  };
})(typeof window !== 'undefined' ? window : self);
