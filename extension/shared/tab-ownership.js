// Tabs and windows that Generation or Apply opened. Get JD never checks, reads, badges, or closes
// them. Kept in chrome.storage.session so a service-worker restart keeps the marks, and passed on
// to tabs opened from an owned tab (a job page opening its application form, a verification link).

(function initTabOwnership(global) {
  const STORAGE_KEY = 'qtsOwnedTabs';
  const OWNERS = new Set(['generation', 'apply']);

  function createTabOwnership(storageArea) {
    let state = { tabs: {}, windows: {} };
    let loaded = null;

    function load() {
      if (!loaded) {
        loaded = Promise.resolve(storageArea?.get?.([STORAGE_KEY]))
          .then((stored) => {
            const saved = stored?.[STORAGE_KEY];
            if (saved && typeof saved === 'object') {
              state = { tabs: { ...(saved.tabs || {}) }, windows: { ...(saved.windows || {}) } };
            }
          })
          .catch(() => {});
      }
      return loaded;
    }

    async function save() {
      await storageArea?.set?.({ [STORAGE_KEY]: state });
    }

    async function markTab(tabId, owner) {
      if (!Number.isInteger(tabId) || !OWNERS.has(owner)) return;
      await load();
      state.tabs[tabId] = owner;
      await save();
    }

    async function markWindow(windowId, owner) {
      if (!Number.isInteger(windowId) || !OWNERS.has(owner)) return;
      await load();
      state.windows[windowId] = owner;
      await save();
    }

    /** A tab opened from an owned tab, or in an owned window, belongs to the same workflow. */
    async function inherit(newTabId, { sourceTabId = null, windowId = null } = {}) {
      if (!Number.isInteger(newTabId)) return null;
      await load();
      const owner = (sourceTabId != null && state.tabs[sourceTabId]) || (windowId != null && state.windows[windowId]) || null;
      if (owner && state.tabs[newTabId] !== owner) {
        state.tabs[newTabId] = owner;
        await save();
      }
      return owner;
    }

    async function releaseTab(tabId) {
      await load();
      if (!(tabId in state.tabs)) return;
      delete state.tabs[tabId];
      await save();
    }

    async function releaseWindow(windowId) {
      await load();
      if (!(windowId in state.windows)) return;
      delete state.windows[windowId];
      await save();
    }

    async function replaceTab(addedTabId, removedTabId) {
      await load();
      const owner = state.tabs[removedTabId];
      if (!owner) return;
      delete state.tabs[removedTabId];
      state.tabs[addedTabId] = owner;
      await save();
    }

    /** 'generation', 'apply', or null for a tab the Manager opened. */
    async function ownerOf(tabId, windowId = null) {
      await load();
      return state.tabs[tabId] || (windowId != null ? state.windows[windowId] : null) || null;
    }

    return { markTab, markWindow, inherit, releaseTab, releaseWindow, replaceTab, ownerOf };
  }

  global.__qtsTabOwnership = Object.freeze({ createTabOwnership });
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsTabOwnership;
})(typeof self !== 'undefined' ? self : globalThis);
