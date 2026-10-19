// Lightweight apply-session store (no Redux).
// - Extension: chrome.storage.session + in-memory cache (survives service worker sleep)
// - Server counterpart: server/src/services/application-session-store.ts (in-memory, for GPT API)

(function initApplySessionStore(global) {
  if (global.__qtsApplySessionStore) return;

  const STORAGE_KEY = 'qtsApplySession';

  /** @type {{ active: Record<string, unknown> | null }} */
  let state = { active: null };
  const listeners = new Set();
  let hydrated = false;

  function notify() {
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  function readStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      chrome.storage.session.get([STORAGE_KEY], (stored) => {
        resolve(stored[STORAGE_KEY] || null);
      });
    });
  }

  function writeStorage(payload) {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      chrome.storage.session.set({ [STORAGE_KEY]: payload }, resolve);
    });
  }

  function getState() {
    return {
      active: state.active ? { ...state.active } : null,
    };
  }

  function getActive() {
    return state.active ? { ...state.active } : null;
  }

  async function hydrate() {
    if (hydrated) return getState();
    const stored = await readStorage();
    if (stored && typeof stored === 'object' && stored.active) {
      state.active = { ...stored.active };
    }
    hydrated = true;
    return getState();
  }

  async function setActive(patch) {
    if (!patch || typeof patch !== 'object') {
      await clearActive();
      return null;
    }
    state.active = {
      ...(state.active || {}),
      ...patch,
      updatedAt: Date.now(),
    };
    hydrated = true;
    await writeStorage(getState());
    notify();
    return getActive();
  }

  async function patchActive(patch) {
    return setActive(patch);
  }

  async function clearActive() {
    state.active = null;
    hydrated = true;
    await writeStorage(getState());
    notify();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  global.__qtsApplySessionStore = {
    STORAGE_KEY,
    hydrate,
    getState,
    getActive,
    setActive,
    patchActive,
    clearActive,
    subscribe,
  };
})(typeof self !== 'undefined' ? self : window);
