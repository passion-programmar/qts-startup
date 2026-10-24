// Account login persists in chrome.storage.local for up to 24 hours (JWT exp).
// Popup memory is a cache; reopening the popup hydrates from local storage.

(function initAccountAuthStorage(global) {
  if (global.__qtsAccountAuth) return;

  const AUTH_TOKEN_KEY = 'authToken';
  const SESSION_USER_KEY = 'qtsSessionUser';
  const AUTH_EXPIRES_KEY = 'authExpiresAt';
  const AUTH_KEYS = [AUTH_TOKEN_KEY, SESSION_USER_KEY, AUTH_EXPIRES_KEY];
  const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

  let popupToken = null;
  let popupUser = null;
  let popupExpiresAt = null;
  let hydrated = false;

  function readLocalArea(keys) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return Promise.reject(new Error('Extension local storage is unavailable.'));
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || 'Could not read extension storage.'));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function writeLocalArea(payload) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return Promise.reject(new Error('Extension local storage is unavailable.'));
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || 'Could not save extension storage.'));
          return;
        }
        resolve();
      });
    });
  }

  function removeLocalKeys(keys) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return Promise.reject(new Error('Extension local storage is unavailable.'));
    }
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || 'Could not clear extension storage.'));
          return;
        }
        resolve();
      });
    });
  }

  function parseTokenExpiryMs(token, fallbackExpiresAt) {
    if (token) {
      try {
        const segment = String(token).split('.')[1];
        if (segment) {
          const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(normalized));
          if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
            return payload.exp * 1000;
          }
        }
      } catch {
        // Fall back to the expiry stored when the token was issued.
      }
    }
    if (
      fallbackExpiresAt != null &&
      Number.isFinite(Number(fallbackExpiresAt)) &&
      Number(fallbackExpiresAt) > 0
    ) {
      return Number(fallbackExpiresAt);
    }
    return null;
  }

  function isExpired(expiresAt) {
    if (expiresAt == null) return true;
    return Date.now() >= Number(expiresAt);
  }

  function resetPopupLoginState() {
    popupToken = null;
    popupUser = null;
    popupExpiresAt = null;
    hydrated = false;
  }

  async function readPersistedAuth() {
    return readLocalArea(AUTH_KEYS);
  }

  async function writePersistedAuth(token, user, expiresAt) {
    await writeLocalArea({
      [AUTH_TOKEN_KEY]: token || '',
      [AUTH_EXPIRES_KEY]: expiresAt,
      ...(user ? { [SESSION_USER_KEY]: user } : {}),
    });
  }

  async function clearPersistedAuth() {
    await removeLocalKeys(AUTH_KEYS);
    await writeLocalArea({ qtsExtensionStatus: null });
  }

  function applyAuthToMemory(token, user, expiresAt) {
    popupToken = token || null;
    popupUser = user ? { ...user } : null;
    popupExpiresAt = expiresAt != null ? Number(expiresAt) : null;
    hydrated = Boolean(popupToken && !isExpired(popupExpiresAt));
    return hydrated;
  }

  async function hydratePopupAuth() {
    if (hydrated && popupToken && !isExpired(popupExpiresAt)) {
      return true;
    }

    const stored = await readPersistedAuth();
    const token = stored[AUTH_TOKEN_KEY] || '';
    const expiresAt = parseTokenExpiryMs(token, stored[AUTH_EXPIRES_KEY]);
    const user = stored[SESSION_USER_KEY] || null;

    if (!token || isExpired(expiresAt)) {
      resetPopupLoginState();
      if (token || user || expiresAt != null) {
        await clearPersistedAuth();
      }
      return false;
    }

    const valid = applyAuthToMemory(token, user, expiresAt);
    if (valid && stored[AUTH_EXPIRES_KEY] !== expiresAt) {
      await writePersistedAuth(token, user, expiresAt);
    }
    return valid;
  }

  async function storePopupAuth(token, user, expiresAt) {
    const nextExpiresAt = token ? parseTokenExpiryMs(token, expiresAt) : null;
    applyAuthToMemory(token, user, nextExpiresAt);
    if (popupToken && !isExpired(popupExpiresAt)) {
      await writePersistedAuth(popupToken, popupUser, popupExpiresAt);
    } else {
      await clearPersistedAuth();
    }
  }

  async function storeAuth(token, user, expiresAt) {
    return storePopupAuth(token, user, expiresAt);
  }

  async function armWorkerAuth() {
    const ok = await hydratePopupAuth();
    return ok && Boolean(popupToken) && !isExpired(popupExpiresAt);
  }

  async function disarmWorkerAuth() {
    // Auto-apply off does not log the account out.
    return true;
  }

  async function setPopupAuthToken(token) {
    const user = popupUser;
    const expiresAt = token ? parseTokenExpiryMs(token) : null;
    await storePopupAuth(token, user, expiresAt);
  }

  function setPopupCachedToken(token) {
    popupToken = token || null;
    popupExpiresAt = token ? parseTokenExpiryMs(token) : null;
  }

  function clearPopupCachedToken() {
    popupToken = null;
    popupExpiresAt = null;
    hydrated = false;
  }

  async function storeSessionUser(user) {
    popupUser = user ? { ...user } : null;
    if (popupToken && !isExpired(popupExpiresAt)) {
      await writePersistedAuth(popupToken, popupUser, popupExpiresAt);
    }
  }

  async function getPopupAuthToken() {
    if (!hydrated || !popupToken) {
      const ok = await hydratePopupAuth();
      if (!ok) return '';
    }
    if (isExpired(popupExpiresAt)) {
      await clearAuth();
      return '';
    }
    return popupToken;
  }

  async function getWorkerAuthToken() {
    if (popupToken && !isExpired(popupExpiresAt)) {
      return popupToken;
    }
    const stored = await readPersistedAuth();
    const token = stored[AUTH_TOKEN_KEY] || '';
    const expiresAt = stored[AUTH_EXPIRES_KEY];
    if (!token || isExpired(expiresAt)) {
      if (token || stored[SESSION_USER_KEY] || expiresAt != null) {
        await clearPersistedAuth();
      }
      resetPopupLoginState();
      return '';
    }
    applyAuthToMemory(token, stored[SESSION_USER_KEY] || null, expiresAt);
    return token;
  }

  function getPopupExpiresAt() {
    return popupExpiresAt;
  }

  async function readPopupSessionUser() {
    if (!hydrated) {
      await hydratePopupAuth();
    }
    if (!popupUser || isExpired(popupExpiresAt)) return null;
    return { ...popupUser };
  }

  async function readWorkerSessionUser() {
    await getWorkerAuthToken();
    if (!popupUser || isExpired(popupExpiresAt)) return null;
    return { ...popupUser };
  }

  async function clearAuth() {
    resetPopupLoginState();
    await clearPersistedAuth();
  }

  async function handleAuthExpired() {
    await clearAuth();
    return true;
  }

  global.__qtsAccountAuth = {
    AUTH_TOKEN_KEY,
    SESSION_USER_KEY,
    AUTH_EXPIRES_KEY,
    SESSION_TTL_MS,
    resetPopupLoginState,
    hydratePopupAuth,
    setPopupCachedToken,
    clearPopupCachedToken,
    setPopupAuthToken,
    storePopupAuth,
    storeAuth,
    armWorkerAuth,
    disarmWorkerAuth,
    storeSessionUser,
    getPopupAuthToken,
    getWorkerAuthToken,
    getPopupExpiresAt,
    parseTokenExpiryMs,
    isExpired,
    readPopupSessionUser,
    readWorkerSessionUser,
    clearAuth,
    handleAuthExpired,
  };
})(typeof self !== 'undefined' ? self : globalThis);
