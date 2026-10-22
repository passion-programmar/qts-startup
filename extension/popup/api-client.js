// API client for the extension popup

const runtimeConfig = window.__qtsRuntimeConfig;
if (!runtimeConfig) {
  throw new Error('QTS runtime configuration must load before the API client.');
}
const DEFAULT_SERVER_URL = runtimeConfig.DEFAULT_SERVER_URL;

let cachedAuthToken = null;

function experimentalApisEnabled() {
  const features = runtimeConfig.features;
  return features.scanner === true
    || features.applicationAutomation === true;
}

function isSupportedApiPath(path) {
  return path.startsWith('/api/extension/auth/')
    || path === '/api/extension/get-jd/save'
    || path === '/api/extension/features/me'
    || path === '/api/extension/highlights'
    || /^\/api\/extension\/highlights\/[0-9a-f-]+$/i.test(path);
}

function unavailableApiResponse() {
  return {
    success: false,
    disabled: true,
    message: 'This extension workflow is not enabled in the current QTS release.',
  };
}

async function getServerUrl() {
  return runtimeConfig.getServerUrl();
}

async function ensureServerUrl() {
  return getServerUrl();
}

async function getToken() {
  const auth = window.__qtsAccountAuth;
  if (auth?.getPopupAuthToken) {
    const token = await auth.getPopupAuthToken();
    cachedAuthToken = token || null;
    return token;
  }
  if (cachedAuthToken) return cachedAuthToken;
  return '';
}

function setCachedToken(token) {
  cachedAuthToken = token || '';
}

function clearCachedToken() {
  cachedAuthToken = null;
}

function formatApiMessage(data, fallback) {
  const base = data?.message || fallback;
  if (!Array.isArray(data?.errors) || !data.errors.length) return base;
  const detail = data.errors
    .slice(0, 3)
    .map((entry) => `${entry.field}: ${entry.message}`)
    .join('; ');
  return `${base} (${detail})`;
}

async function apiRequest(method, path, body) {
  if (!isSupportedApiPath(path) && !experimentalApisEnabled()) {
    return unavailableApiResponse();
  }
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  const url = serverUrl.replace(/\/$/, '') + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let response;
  try {
    response = await fetch(url, opts);
  } catch {
    return { success: false, message: 'Cannot connect to the server. Check that it is running.', _httpStatus: 0 };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return {
      success: false,
      message: `Server returned an invalid response (${response.status}).`,
    };
  }

  if (!response.ok && data.success !== false) {
    data.success = false;
  }

  if (!data.success && !data.message) {
    if (response.status === 404) {
      data.message = `API route not found (404): ${path}. Check that the QTS server is up to date.`;
    } else {
      data.message = `Request failed (${response.status}).`;
    }
  }

  if (
    !data.success
    && Array.isArray(data.errors)
    && data.errors.some((e) => String(e.message || '').includes('document_upload'))
  ) {
    data.message = `${data.message || 'Validation error.'} Server is outdated — run stop-server.bat then start-server.bat to load document upload support.`;
  }

  data._httpStatus = response.status;

  if (response.status === 401 && window.__qtsAccountAuth?.handleAuthExpired) {
    await window.__qtsAccountAuth.handleAuthExpired();
    clearCachedToken();
    data.message = data.message || 'Session expired. Please log in again.';
    data._sessionExpired = true;
  }

  return data;
}

async function fetchApplicationDocument(applicationId, docType) {
  if (!experimentalApisEnabled()) return unavailableApiResponse();
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  const url = `${serverUrl.replace(/\/$/, '')}/api/application-sessions/${applicationId}/documents/${encodeURIComponent(docType)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { success: false, message: 'Cannot download document from server.' };
  }

  if (!response.ok) {
    let message = `Document download failed (${response.status}).`;
    try {
      const err = await response.json();
      if (err.message) message = err.message;
    } catch {
      // ignore
    }
    return { success: false, message };
  }

  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  let fileName = docType === 'cover-letter' ? 'cover-letter.pdf' : 'resume.pdf';
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match?.[1]) fileName = match[1];

  return {
    success: true,
    fileName,
    mimeType: blob.type || 'application/pdf',
    base64,
  };
}

async function fetchManagerGptTaskDocument(taskId, documentType) {
  if (!experimentalApisEnabled()) return unavailableApiResponse();
  const [serverUrl, token] = await Promise.all([getServerUrl(), getToken()]);
  const url = `${serverUrl.replace(/\/$/, '')}/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/documents/${encodeURIComponent(documentType)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
  } catch {
    return { success: false, message: 'Cannot download the generated document from server.' };
  }

  if (!response.ok) {
    let message = `Generated document download failed (${response.status}).`;
    try {
      const err = await response.json();
      if (err.message) message = err.message;
    } catch {
      // ignore
    }
    return { success: false, message };
  }

  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return {
    success: true,
    fileName: match?.[1] || (documentType === 'cover_letter' ? 'cover-letter.pdf' : 'resume.pdf'),
    mimeType: blob.type || 'application/pdf',
    base64: btoa(binary),
  };
}

async function saveApplicationTemplateDraft(payload) {
  return apiRequest('POST', '/api/application-templates/from-discovery', payload);
}

async function getReusableApplicationTemplate(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return apiRequest('GET', `/api/application-templates/reuse${qs ? `?${qs}` : ''}`);
}

async function getApplicationLearningQueue(applicationId) {
  return apiRequest('GET', `/api/application-sessions/${encodeURIComponent(String(applicationId))}/learning-queue`);
}

async function confirmApplicationLearning(applicationId, payload) {
  return apiRequest('POST', `/api/application-sessions/${encodeURIComponent(String(applicationId))}/learning-confirmation`, payload);
}

window.api = {
  DEFAULT_SERVER: DEFAULT_SERVER_URL,
  formatApiMessage,
  getServerUrl,
  ensureServerUrl,
  setCachedToken,
  clearCachedToken,
  login: (username, password) =>
    apiRequest('POST', '/api/extension/auth/login', { loginName: username, password }),
  logout: async () => ({ success: true }),
  me: () => apiRequest('GET', '/api/extension/auth/me'),
  saveGetJdJobs: (job, profileIds) =>
    apiRequest('POST', '/api/extension/get-jd/save', { job, profileIds }),
  extensionBootstrap: (accountId) => apiRequest(
    'GET',
    `/api/auth/extension-bootstrap${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`
  ),
  getAssignedCustomGpt: () => apiRequest('GET', '/api/v2/auth/custom-gpt-assignment'),
  getManagerExtensionFeatures: () => apiRequest('GET', '/api/extension/features/me'),
  startAccountMailboxGoogleConnect: (accountUserId) =>
    apiRequest('POST', '/api/v2/account-mailboxes/google/connect', { accountUserId }),
  getAccountMailboxStatus: (accountUserId) =>
    apiRequest('GET', `/api/v2/account-mailboxes/accounts/${encodeURIComponent(String(accountUserId))}/status`),
  disconnectAccountMailbox: (accountUserId) =>
    apiRequest('POST', `/api/v2/account-mailboxes/accounts/${encodeURIComponent(String(accountUserId))}/disconnect`, {}),
  findAccountApplicationConfirmation: (accountUserId, { submittedAt, company, title }) => {
    const params = new URLSearchParams({
      submittedAt: String(submittedAt),
      company: String(company || ''),
      title: String(title || ''),
    });
    return apiRequest(
      'GET',
      `/api/v2/account-mailboxes/accounts/${encodeURIComponent(String(accountUserId))}/confirmation?${params}`
    );
  },
  getGlobalTextHighlights: () => apiRequest('GET', '/api/extension/highlights'),
  createGlobalTextHighlight: (rule) => apiRequest('POST', '/api/extension/highlights', rule),
  updateGlobalTextHighlight: (ruleId, rule) =>
    apiRequest('PUT', `/api/extension/highlights/${encodeURIComponent(ruleId)}`, rule),
  deleteGlobalTextHighlight: (ruleId) =>
    apiRequest('DELETE', `/api/extension/highlights/${encodeURIComponent(ruleId)}`),
  getManagerApplicationProfile: () => apiRequest('GET', '/api/v2/manager-application-profile'),
  getManagerScannerRules: (templateId) =>
    apiRequest('GET', `/api/v2/manager-application-profile/scanner-rules/${encodeURIComponent(String(templateId))}`),
  saveManagerScannerRule: (rule) =>
    apiRequest('POST', '/api/v2/manager-application-profile/scanner-rules', rule),
  updateManagerScannerRuleEvidence: (evidence) =>
    apiRequest('POST', '/api/v2/manager-application-profile/scanner-rules/evidence', evidence),
  extensionStatus: () => apiRequest('GET', '/api/auth/extension-status'),
  health: () => apiRequest('GET', '/api/extension/auth/health'),
  getCandidates: () => apiRequest('GET', '/api/candidates?active=true'),
  getCandidateStacks: () => apiRequest('GET', '/api/settings/candidate-stacks'),
  getManagerAccounts: () => apiRequest('GET', '/api/v2/users/accounts'),
  getJobCategories: () => apiRequest('GET', '/api/v2/categories'),
  getJobs: (filters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters || {})) {
      if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
    }
    const query = params.toString();
    return apiRequest('GET', `/api/v2/jobs${query ? `?${query}` : ''}`);
  },
  claimScannerJob: (data) => apiRequest('POST', '/api/v2/jobs/claim-next', data),
  updateJobApplicationStatus: (id, data) =>
    apiRequest('PATCH', `/api/v2/jobs/${encodeURIComponent(String(id))}/status`, data),
  checkJobByUrl: (url) =>
    apiRequest('GET', `/api/v2/jobs/check-url?url=${encodeURIComponent(url)}`),
  createJob: (data) => apiRequest('POST', '/api/v2/jobs', data),
  updateJob: (id, data) => apiRequest('PUT', `/api/v2/jobs/${encodeURIComponent(id)}`, data),
  getJob: (id) => apiRequest('GET', `/api/jobs/${id}`),
  getJobByUrl: (url) => apiRequest('GET', `/api/jobs/by-url?url=${encodeURIComponent(url)}`),
  upsertJob: (data) => apiRequest('POST', '/api/jobs/upsert', data),
  getCandidate: (id) => apiRequest('GET', `/api/candidates/${id}`),
  createApplicationSession: (data) => apiRequest('POST', '/api/application-sessions', data),
  patchApplicationSessionFields: (applicationId, data) =>
    apiRequest('PATCH', `/api/application-sessions/${applicationId}/fields`, data),
  getApplicationSession: (applicationId) =>
    apiRequest('GET', `/api/application-sessions/${applicationId}`),
  getPendingApplicationFields: (applicationId) =>
    apiRequest('GET', `/api/application-sessions/${applicationId}/pending-fields`),
  submitApplicationAnswers: (applicationId, data) =>
    apiRequest('POST', `/api/application-sessions/${applicationId}/answers`, data),
  getApplicationResult: (applicationId) =>
    apiRequest('GET', `/api/application-sessions/${applicationId}/result`),
  dispatchApplicationTask: (taskId) =>
    apiRequest('POST', `/api/application-tasks/${encodeURIComponent(taskId)}/dispatch`),
  getApplicationTaskStatus: (taskId) =>
    apiRequest('GET', `/api/application-tasks/${encodeURIComponent(taskId)}/status`),
  getApplicationTaskContext: (taskId) =>
    apiRequest('GET', `/api/application-tasks/${encodeURIComponent(taskId)}/context`),
  createManagerGptTaskForJob: (jobId, data) =>
    apiRequest('POST', `/api/v2/gpt-application-tasks/jobs/${encodeURIComponent(jobId)}`, data),
  setManagerGptTaskPage: (taskId, data) =>
    apiRequest('PUT', `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/page`, data),
  acknowledgeManagerGptTaskPage: (taskId) =>
    apiRequest('POST', `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/scanner-acknowledge`, {}),
  getManagerGptTaskStatus: (taskId) =>
    apiRequest('GET', `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/extension-status`),
  recordManagerGptTaskDownloads: (taskId, documents) =>
    apiRequest('POST', `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/downloads`, { documents }),
  getManagerGptTaskDownloads: (taskId) =>
    apiRequest('GET', `/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/downloads`),
  fetchManagerGptTaskDocument: (taskId, documentType) =>
    fetchManagerGptTaskDocument(taskId, documentType),
  fetchApplicationDocument: (applicationId, docType) =>
    fetchApplicationDocument(applicationId, docType),
  saveApplicationTemplateDraft: (payload) => saveApplicationTemplateDraft(payload),
  getReusableApplicationTemplate: (query) => getReusableApplicationTemplate(query),
  getApplicationLearningQueue: (applicationId) => getApplicationLearningQueue(applicationId),
  confirmApplicationLearning: (applicationId, payload) => confirmApplicationLearning(applicationId, payload),
};
