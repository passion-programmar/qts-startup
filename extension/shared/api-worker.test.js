const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApiWorker(fetchImpl) {
  const runtime = {
    __qtsRuntimeConfig: {
      features: {
        scanner: false,
        applicationAutomation: false,
      },
      getServerUrl: async () => 'https://qts.example.test',
    },
    __qtsAccountAuth: {
      getWorkerAuthToken: async () => 'worker-token',
    },
  };
  const context = vm.createContext({
    ...runtime,
    fetch: fetchImpl,
    chrome: {
      runtime: { sendMessage: async () => ({}) },
      storage: { local: { get: async () => ({}) } },
    },
    URL,
    URLSearchParams,
    Uint8Array,
    Blob,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  });
  context.self = context;
  const source = fs.readFileSync(path.join(__dirname, 'api-worker.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'api-worker.js' });
  return context.__qtsApiWorker;
}

test('worker permits the supported Get JD save endpoint', async () => {
  const requests = [];
  const worker = loadApiWorker(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, savedCount: 1 }),
    };
  });

  const result = await worker.workerApiRequest(
    'POST',
    '/api/extension/get-jd/save',
    { profileIds: ['candidate-id'] },
  );

  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://qts.example.test/api/extension/get-jd/save');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer worker-token');
});

test('worker permits the authenticated Get JD duplicate check', async () => {
  const requests = [];
  const worker = loadApiWorker(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, exists: false }),
    };
  });

  const result = await worker.workerApiRequest(
    'POST',
    '/api/extension/get-jd/check',
    { job: { jobUrl: 'https://example.test/job', jobTitle: 'Engineer', company: 'Example' } },
  );

  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://qts.example.test/api/extension/get-jd/check');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer worker-token');
});

test('worker permits loading the signed-in manager candidate accounts', async () => {
  const requests = [];
  const worker = loadApiWorker(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, profiles: [] }),
    };
  });

  const result = await worker.workerApiRequest('GET', '/api/extension/get-jd/profiles');

  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://qts.example.test/api/extension/get-jd/profiles');
  assert.ok(requests[0].options.headers.Authorization);
});

test('worker permits authenticated Generation endpoints', async () => {
  const requests = [];
  const worker = loadApiWorker(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, generationId: 'generation-id' }),
    };
  });

  const result = await worker.workerApiRequest(
    'POST',
    '/api/extension/generation/start',
    { job: { jobDescription: 'JD' } },
  );

  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://qts.example.test/api/extension/generation/start');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer worker-token');
});

test('worker blocks unfinished API paths before making a request', async () => {
  const requests = [];
  const worker = loadApiWorker(async (...args) => {
    requests.push(args);
  });

  const result = await worker.workerApiRequest('GET', '/api/jobs/by-url');

  assert.equal(result.success, false);
  assert.equal(result.disabled, true);
  assert.equal(requests.length, 0);
});

test('worker explains when the deployed Get JD endpoint is missing', async () => {
  const worker = loadApiWorker(async () => ({
    ok: false,
    status: 404,
    json: async () => { throw new SyntaxError('HTML response'); },
  }));

  const result = await worker.workerApiRequest('POST', '/api/extension/get-jd/check', {
    job: { jobUrl: 'https://example.com/job', jobTitle: 'Engineer', company: 'Example' },
  });

  assert.equal(result.success, false);
  assert.equal(result._httpStatus, 404);
  assert.match(result.message, /does not have the Get JD check endpoint/i);
});
