const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, 'account-auth-storage.js'),
  'utf8',
);

function createStorageArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get(keys, callback) {
      callback(Object.fromEntries(keys.map((key) => [key, data[key]])));
    },
    set(values, callback) {
      Object.assign(data, values);
      callback();
    },
    remove(keys, callback) {
      for (const key of keys) delete data[key];
      callback();
    },
  };
}

function createTokenStore(initialToken = '') {
  const store = {
    token: initialToken,
    async read() {
      return store.token;
    },
    async write(token) {
      store.token = String(token || '');
    },
    async clear() {
      store.token = '';
    },
  };
  return store;
}

function loadAuthStorage(storage, now = Date.now(), tokenStore = createTokenStore()) {
  class TestDate extends Date {
    static now() {
      return now;
    }
  }

  const context = vm.createContext({
    chrome: {
      runtime: {},
      storage: { local: storage },
    },
    Date: TestDate,
    __qtsAuthTokenStore: tokenStore,
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
  });
  vm.runInContext(source, context, { filename: 'account-auth-storage.js' });
  return context.__qtsAccountAuth;
}

function createToken(expiresAtSeconds) {
  const payload = Buffer.from(
    JSON.stringify({ exp: expiresAtSeconds }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

test('extension login persists and restores the 24-hour session after popup reload', async () => {
  const now = Date.now();
  const expiresAtSeconds = Math.floor(now / 1000) + 24 * 60 * 60;
  const token = createToken(expiresAtSeconds);
  const storage = createStorageArea();
  const tokenStore = createTokenStore();
  const manager = { id: 'manager-id', username: 'manager', role: 'manager' };

  await loadAuthStorage(storage, now, tokenStore).storePopupAuth(
    token,
    manager,
    expiresAtSeconds * 1000,
  );

  assert.equal(tokenStore.token, token);
  assert.equal(storage.data.authToken, undefined);
  assert.equal(storage.data.authExpiresAt, expiresAtSeconds * 1000);

  const reloadedAuth = loadAuthStorage(storage, now, tokenStore);
  assert.equal(await reloadedAuth.hydratePopupAuth(), true);
  assert.equal(await reloadedAuth.getPopupAuthToken(), token);
  assert.equal(
    JSON.stringify(await reloadedAuth.readPopupSessionUser()),
    JSON.stringify(manager),
  );
});

test('a token left in local storage by an older version moves to the extension-only store', async () => {
  const now = Date.now();
  const expiresAtSeconds = Math.floor(now / 1000) + 24 * 60 * 60;
  const token = createToken(expiresAtSeconds);
  const storage = createStorageArea({
    authToken: token,
    qtsSessionUser: { id: 'manager-id', username: 'manager', role: 'manager' },
  });

  const tokenStore = createTokenStore();

  const auth = loadAuthStorage(storage, now, tokenStore);
  assert.equal(await auth.hydratePopupAuth(), true);
  assert.equal(storage.data.authExpiresAt, expiresAtSeconds * 1000);
  assert.equal(storage.data.authToken, undefined);
  assert.equal(tokenStore.token, token);
  assert.equal(await auth.getPopupAuthToken(), token);
});

test('expired token is removed from local extension storage', async () => {
  const now = Date.now();
  const storage = createStorageArea({
    authExpiresAt: now - 1000,
    qtsSessionUser: { id: 'manager-id', username: 'manager', role: 'manager' },
  });
  const tokenStore = createTokenStore(createToken(Math.floor(now / 1000) - 1));

  assert.equal(await loadAuthStorage(storage, now, tokenStore).hydratePopupAuth(), false);
  assert.deepEqual(storage.data, { qtsExtensionStatus: null, qtsGetJdOn: false });
  assert.equal(tokenStore.token, '');
});

test('clearing an extension session resets the active extension status', async () => {
  const storage = createStorageArea({
    authExpiresAt: Date.now() + 60_000,
    qtsSessionUser: { id: 'manager-id', username: 'manager', role: 'manager' },
    qtsExtensionStatus: 'generation',
  });
  const tokenStore = createTokenStore(createToken(Math.floor(Date.now() / 1000) + 60));

  await loadAuthStorage(storage, Date.now(), tokenStore).clearAuth();

  assert.equal(tokenStore.token, '');
  assert.equal(storage.data.authExpiresAt, undefined);
  assert.equal(storage.data.qtsSessionUser, undefined);
  assert.equal(storage.data.qtsExtensionStatus, null);
});
