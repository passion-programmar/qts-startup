(function initScannerDocumentStore(global) {
  if (global.__qtsScannerDocumentStore) return;

  const DATABASE_NAME = 'qts-scanner-documents';
  const STORE_NAME = 'documents';
  const SETTINGS_STORE_NAME = 'settings';
  let databasePromise;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 2);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: ['taskId', 'documentType'] });
          }
          if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
            database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open local Scanner document storage.'));
      });
    }
    return databasePromise;
  }

  async function requestStore(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error || new Error('Could not access local Scanner document storage.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Local Scanner document storage transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local Scanner document storage transaction was aborted.'));
    });
  }

  async function requestSetting(mode, operation) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(SETTINGS_STORE_NAME, mode);
      const request = operation(transaction.objectStore(SETTINGS_STORE_NAME));
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error || new Error('Could not access local Scanner settings.'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Local Scanner settings transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Local Scanner settings transaction was aborted.'));
    });
  }

  global.__qtsScannerDocumentStore = {
    get(taskId, documentType) {
      return requestStore('readonly', (store) => store.get([taskId, documentType]));
    },
    put(document) {
      return requestStore('readwrite', (store) => store.put(document));
    },
    getSetting(key) {
      return requestSetting('readonly', (store) => store.get(key));
    },
    putSetting(key, value) {
      return requestSetting('readwrite', (store) => store.put({ key, value }));
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
