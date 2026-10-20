const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApiClient(fetchImpl) {
  const window = {
    __qtsAccountAuth: {
      getPopupAuthToken: async () => 'test-token',
    },
  };
  const context = vm.createContext({
    window,
    fetch: fetchImpl,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    Blob,
    Uint8Array,
    URL,
    chrome: {
      storage: {
        local: { get: async () => ({}) },
      },
    },
  });
  context.self = window;
  const runtimeSource = fs.readFileSync(
    path.join(__dirname, '..', 'shared', 'runtime-config.js'),
    'utf8',
  );
  vm.runInContext(runtimeSource, context, { filename: 'runtime-config.js' });
  const source = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'api-client.js' });
  return window.api;
}

function successfulDocumentResponse(fileName, content) {
  return {
    ok: true,
    headers: { get: () => `attachment; filename="${fileName}"` },
    blob: async () => new Blob([content], { type: 'application/pdf' }),
  };
}

test('extension login uses the QTS Manager authentication endpoint', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        token: 'signed-token',
        expiresAt: 1_800_000_000_000,
        id: 'manager-id',
        username: 'manager',
        name: 'Manager',
        role: 'manager',
      }),
    };
  });

  const result = await api.login('manager', 'password');

  assert.equal(result.success, true);
  assert.equal(requests[0].url, 'https://qts-job-system.vercel.app/api/extension/auth/login');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    loginName: 'manager',
    password: 'password',
  });
});

test('Get JD selected profiles are saved through the authenticated QTS endpoint', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, savedCount: 1, results: [] }),
    };
  });
  const job = {
    jobUrl: 'https://jobs.example.com/role',
    title: 'Engineer',
    company: 'Example',
    location: 'Remote',
  };
  const profileIds = ['00000000-0000-4000-8000-000000000001'];

  const result = await api.saveGetJdJobs(job, profileIds);

  assert.equal(result.success, true);
  assert.equal(requests[0].url, 'https://qts-job-system.vercel.app/api/extension/get-jd/save');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { job, profileIds });
});

test('Manager Scanner document fetch is disabled without its server contract', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return successfulDocumentResponse('generated-resume.pdf', 'resume-pdf');
  });

  const result = await api.fetchManagerGptTaskDocument('task_example', 'resume');

  assert.equal(result.success, false);
  assert.equal(result.disabled, true);
  assert.equal(requests.length, 0);
});

test('application-session document fetch is disabled without its server contract', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return successfulDocumentResponse('resume.pdf', 'legacy-pdf');
  });

  const result = await api.fetchApplicationDocument('42', 'resume');

  assert.equal(result.success, false);
  assert.equal(result.disabled, true);
  assert.equal(requests.length, 0);
});

test('Manager Scanner download APIs do not call missing server routes', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, taskId: 'task_example', downloads: [] }),
    };
  });
  const documents = [
    { documentType: 'resume', fileName: 'resume.pdf', localPath: 'C:\\Downloads\\resume.pdf' },
    { documentType: 'cover_letter', fileName: 'cover.pdf', localPath: 'C:\\Downloads\\cover.pdf' },
  ];

  const saved = await api.recordManagerGptTaskDownloads('task_example', documents);
  const retrieved = await api.getManagerGptTaskDownloads('task_example');

  assert.equal(saved.success, false);
  assert.equal(saved.disabled, true);
  assert.equal(retrieved.success, false);
  assert.equal(retrieved.disabled, true);
  assert.equal(requests.length, 0);
});
