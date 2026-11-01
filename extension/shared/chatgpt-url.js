(function initQtsChatGptUrl(global) {
  const DEFAULT_URL = 'https://chatgpt.com/';
  const ALLOWED_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);

  function normalize(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  global.__qtsChatGptUrl = Object.freeze({ DEFAULT_URL, normalize });
})(typeof globalThis !== 'undefined' ? globalThis : self);
