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
  });
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

test('Manager Scanner document fetch is available on the popup API client', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return successfulDocumentResponse('generated-resume.pdf', 'resume-pdf');
  });

  const result = await api.fetchManagerGptTaskDocument('task_example', 'resume');

  assert.equal(result.success, true);
  assert.equal(result.fileName, 'generated-resume.pdf');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(Buffer.from(result.base64, 'base64').toString(), 'resume-pdf');
  assert.equal(
    requests[0].url,
    'https://qts-job-system.vercel.app/api/v2/gpt-application-tasks/task_example/documents/resume'
  );
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
});

test('application-session document fetch remains available', async () => {
  const requests = [];
  const api = loadApiClient(async (url, options) => {
    requests.push({ url, options });
    return successfulDocumentResponse('resume.pdf', 'legacy-pdf');
  });

  const result = await api.fetchApplicationDocument('42', 'resume');

  assert.equal(result.success, true);
  assert.equal(result.fileName, 'resume.pdf');
  assert.equal(Buffer.from(result.base64, 'base64').toString(), 'legacy-pdf');
  assert.equal(
    requests[0].url,
    'https://qts-job-system.vercel.app/api/application-sessions/42/documents/resume'
  );
});

test('Manager Scanner download paths are saved and retrievable per task', async () => {
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

  assert.equal(saved.success, true);
  assert.equal(retrieved.success, true);
  assert.equal(requests[0].url, 'https://qts-job-system.vercel.app/api/v2/gpt-application-tasks/task_example/downloads');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { documents });
  assert.equal(requests[1].options.method, 'GET');
});
