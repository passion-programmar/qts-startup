// Keeps the Manager bearer token in the extension origin's IndexedDB. Unlike
// chrome.storage.local, content scripts running on web pages cannot read it.

(function initAuthTokenStore(global) {
  if (global.__qtsAuthTokenStore) return;

  const DB_NAME = 'qts-auth';
  const STORE_NAME = 'secrets';
  const TOKEN_KEY = 'authToken';

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open extension token storage.'));
    });
  }

  async function runRequest(mode, createRequest) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = createRequest(transaction.objectStore(STORE_NAME));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error || new Error('Extension token storage failed.'));
        transaction.onabort = () => reject(transaction.error || new Error('Extension token storage was aborted.'));
      });
    } finally {
      database.close();
    }
  }

  global.__qtsAuthTokenStore = {
    async read() {
      const token = await runRequest('readonly', (store) => store.get(TOKEN_KEY));
      return typeof token === 'string' ? token : '';
    },
    async write(token) {
      await runRequest('readwrite', (store) => store.put(String(token || ''), TOKEN_KEY));
    },
    async clear() {
      await runRequest('readwrite', (store) => store.delete(TOKEN_KEY));
    },
  };
})(typeof self !== 'undefined' ? self : globalThis);
