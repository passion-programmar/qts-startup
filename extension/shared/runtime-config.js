(function initRuntimeConfig(global) {
  if (global.__qtsRuntimeConfig) return;

  const DEFAULT_SERVER_URL = 'https://qts-job-system.vercel.app';
  const SERVER_URL_STORAGE_KEY = 'qtsServerUrl';
  const features = Object.freeze({
    getJd: true,
    geminiEvaluation: false,
    scanner: false,
    applicationAutomation: false,
    textHighlights: true,
    pageExclusions: true,
  });

  function normalizeServerUrl(value) {
    let normalized = String(value || '').trim().replace(/\/+$/, '');
    if (!normalized) return DEFAULT_SERVER_URL;
    normalized = normalized.replace(/\/api\/health\/?$/i, '');
    normalized = normalized.replace(/\/api\/?$/i, '');
    normalized = normalized.replace(/\/+$/, '');
    try {
      const url = new URL(normalized);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return DEFAULT_SERVER_URL;
      }
      url.username = '';
      url.password = '';
      return url.href.replace(/\/+$/, '');
    } catch {
      return DEFAULT_SERVER_URL;
    }
  }

  async function getServerUrl() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return DEFAULT_SERVER_URL;
    }
    const stored = await chrome.storage.local.get([SERVER_URL_STORAGE_KEY]);
    return normalizeServerUrl(stored[SERVER_URL_STORAGE_KEY]);
  }

  function isFeatureEnabled(feature) {
    return features[feature] === true;
  }

  global.__qtsRuntimeConfig = Object.freeze({
    DEFAULT_SERVER_URL,
    SERVER_URL_STORAGE_KEY,
    features,
    normalizeServerUrl,
    getServerUrl,
    isFeatureEnabled,
  });
})(typeof self !== 'undefined' ? self : globalThis);
