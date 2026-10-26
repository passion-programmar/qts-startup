// Minimal API helpers for the service worker (GPT poll + document download).

const qtsRoot = typeof globalThis !== 'undefined' ? globalThis : self;

function workerExperimentalApisEnabled() {
  const features = qtsRoot.__qtsRuntimeConfig?.features || {};
  return features.scanner === true
    || features.applicationAutomation === true;
}

function workerUnavailableResponse() {
  return {
    success: false,
    disabled: true,
    message: 'This extension workflow is not enabled in the current QTS release.',
  };
}

function workerSupportedApiPath(path) {
  return path === '/api/extension/get-jd/check'
    || path === '/api/extension/get-jd'
    || path === '/api/extension/get-jd/mode'
    || path === '/api/extension/get-jd/profiles'
    || path === '/api/extension/get-jd/save'
    || /^\/api\/extension\/get-jd\/auto-saved-jobs\/[0-9a-f-]+$/i.test(path)
    || /^\/api\/extension\/get-jd\/job-accounts\/[0-9a-f-]+$/i.test(path)
    || path === '/api/extension/features/me'
    || path === '/api/extension/highlights'
    || path === '/api/extension/page-exclusions'
    || path === '/api/extension/job-detection-url-rules'
    || /^\/api\/extension\/highlights\/[0-9a-f-]+$/i.test(path)
    || /^\/api\/extension\/page-exclusions\/[0-9a-f-]+$/i.test(path)
    || /^\/api\/extension\/job-detection-url-rules\/[0-9a-f-]+$/i.test(path)
    || path.startsWith('/api/extension/generation/')
    || path.startsWith('/api/extension/apply/')
    || path === '/api/extension/browsers/heartbeat'
    || path.startsWith('/api/extension/auth/');
}

async function workerReadAuth() {
  const auth = qtsRoot.__qtsAccountAuth;
  const token = auth?.getWorkerAuthToken ? await auth.getWorkerAuthToken() : '';
  return {
    token,
    serverUrl: await qtsRoot.__qtsRuntimeConfig.getServerUrl(),
  };
}

// This Chrome's identity, sent with every request so the server can tell Chromes apart: a random
// key kept in this Chrome's storage, the extension version, and the name the Manager gave it.
const BROWSER_KEY_STORAGE_KEY = 'qtsBrowserKey';
const BROWSER_NAME_STORAGE_KEY = 'qtsBrowserName';
let browserKeyPromise = null;

function createBrowserKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function workerBrowserKey() {
  if (!browserKeyPromise) {
    browserKeyPromise = chrome.storage.local.get([BROWSER_KEY_STORAGE_KEY]).then(async (stored) => {
      const existing = stored[BROWSER_KEY_STORAGE_KEY];
      if (typeof existing === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
      const key = createBrowserKey();
      await chrome.storage.local.set({ [BROWSER_KEY_STORAGE_KEY]: key });
      return key;
    }).catch((error) => {
      browserKeyPromise = null;
      throw error;
    });
  }
  return browserKeyPromise;
}

async function workerBrowserHeaders() {
  try {
    const [key, stored] = await Promise.all([
      workerBrowserKey(),
      chrome.storage.local.get([BROWSER_NAME_STORAGE_KEY]),
    ]);
    // Encoded, because a header value cannot carry every character a name may have.
    const name = String(stored[BROWSER_NAME_STORAGE_KEY] || '').trim().slice(0, 60);
    return {
      'X-QTS-Browser-Key': key,
      'X-QTS-Extension-Version': chrome.runtime.getManifest().version,
      ...(name ? { 'X-QTS-Browser-Name': encodeURIComponent(name) } : {}),
    };
  } catch {
    return {};
  }
}

async function workerApiRequest(method, path, body) {
  if (!workerSupportedApiPath(path) && !workerExperimentalApisEnabled()) {
    return workerUnavailableResponse();
  }
  const { token, serverUrl } = await workerReadAuth();
  if (!token) return { success: false, message: 'Not logged in.' };

  const url = `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...await workerBrowserHeaders(),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        message: response.status === 404
          ? 'This QTS server does not have the Get JD check endpoint yet. Deploy the latest server version.'
          : `QTS server returned a non-JSON response (HTTP ${response.status}).`,
        _httpStatus: response.status,
      };
    }
    if (!response.ok && data.success !== false) data.success = false;
    data._httpStatus = response.status;
    if (response.status === 401) {
      const auth = qtsRoot.__qtsAccountAuth;
      await auth?.handleAuthExpired?.();
      chrome.runtime.sendMessage({ type: 'AUTH_SESSION_EXPIRED' }).catch(() => {});
      data.message = data.message || 'Session expired. Please log in again.';
      data._sessionExpired = true;
    }
    return data;
  } catch {
    return { success: false, message: 'Cannot connect to the server.' };
  }
}

async function workerFetchDocumentBase64(applicationId, docType) {
  if (!workerExperimentalApisEnabled()) return workerUnavailableResponse();
  const { token, serverUrl } = await workerReadAuth();
  if (!token) return { success: false, message: 'Not logged in.' };

  const url = `${serverUrl}/api/application-sessions/${applicationId}/documents/${encodeURIComponent(docType)}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
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

    let fileName = docType === 'cover-letter' ? 'cover-letter.pdf' : 'resume.pdf';
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match?.[1]) fileName = match[1];

    return {
      success: true,
      fileName,
      mimeType: blob.type || 'application/pdf',
      base64: btoa(binary),
    };
  } catch {
    return { success: false, message: 'Cannot download document from server.' };
  }
}

async function workerFetchAccountResumeBase64(accountId) {
  if (!workerExperimentalApisEnabled()) return workerUnavailableResponse();
  const { token, serverUrl } = await workerReadAuth();
  if (!token) return { success: false, message: 'Not logged in.' };

  try {
    const response = await fetch(`${serverUrl}/api/v2/users/${accountId}/resume`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 401) {
        const auth = qtsRoot.__qtsAccountAuth;
        await auth?.handleAuthExpired?.();
        chrome.runtime.sendMessage({ type: 'AUTH_SESSION_EXPIRED' }).catch(() => {});
        return { success: false, message: 'Session expired. Please log in again.' };
      }
      let message = `Resume download failed (${response.status}).`;
      try {
        const error = await response.json();
        if (error.message) message = error.message;
      } catch {
        // Non-JSON response; preserve the HTTP status message.
      }
      return { success: false, message };
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const match = disposition.match(/filename="?([^";]+)"?/i);
    let fileName = match?.[1] || 'resume.pdf';
    if (utf8Match?.[1]) {
      try {
        fileName = decodeURIComponent(utf8Match[1]);
      } catch {
        return { success: false, message: 'The saved resume filename is invalid.' };
      }
    }
    return {
      success: true,
      fileName,
      base64: btoa(binary),
    };
  } catch {
    return { success: false, message: 'Cannot download the Account resume from the server.' };
  }
}

async function workerFetchGptTaskDocumentBase64(taskId, documentType) {
  if (!workerExperimentalApisEnabled()) return workerUnavailableResponse();
  const { token, serverUrl } = await workerReadAuth();
  if (!token) return { success: false, message: 'Not logged in.' };
  if (!['resume', 'cover_letter'].includes(documentType)) {
    return { success: false, message: 'Unsupported generated document type.' };
  }

  try {
    const response = await fetch(
      `${serverUrl}/api/v2/gpt-application-tasks/${encodeURIComponent(taskId)}/documents/${documentType}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      let message = `Generated document download failed (${response.status}).`;
      try {
        const error = await response.json();
        if (error.message) message = error.message;
      } catch {
        // Preserve the HTTP status message for non-JSON failures.
      }
      return { success: false, message };
    }

    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return {
      success: true,
      fileName: match?.[1] || `${documentType}.pdf`,
      mimeType: blob.type || 'application/pdf',
      base64: btoa(binary),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error
        ? `Cannot download generated document: ${error.message}`
        : 'Cannot download generated document from server.',
    };
  }
}

function workerParseApplicationId(taskId) {
  const match = String(taskId || '').match(/^task_(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function workerInferFileDocumentType(field) {
  const slot = String(field.generatedAnswer || field.documentSlot || field.fillValue || '').toLowerCase();
  if (slot.includes('cover')) return 'cover-letter';
  const text = `${field.label || ''} ${field.nameAttr || ''} ${field.placeholder || ''}`.toLowerCase();
  if (/cover|message|letter/.test(text)) return 'cover-letter';
  return 'resume';
}

async function workerCheckDefaultCandidateApplied(jobUrl, candidateId) {
  const id = Number(candidateId);
  if (!Number.isFinite(id) || id <= 0) {
    return { applied: false, jobSaved: false, candidateId: null };
  }

  const url = String(jobUrl || '').trim();
  if (!url) {
    return { applied: false, jobSaved: false, candidateId: id };
  }

  const res = await workerApiRequest(
    'GET',
    `/api/jobs/by-url?url=${encodeURIComponent(url)}`
  );

  if (!res.success) {
    if (res._httpStatus === 404) {
      return { applied: false, jobSaved: false, candidateId: id };
    }
    return {
      applied: false,
      jobSaved: false,
      candidateId: id,
      error: res.message || 'Could not check applied status.',
    };
  }

  const job = res.job || {};
  const statuses = job.candidateStatuses || job.candidate_statuses || [];
  const row = statuses.find((entry) => {
    const entryId = Number(entry.candidate_id ?? entry.candidateId);
    return entryId === id;
  });

  return {
    applied: row?.status === 'applied',
    jobSaved: true,
    jobId: job.id ?? null,
    candidateId: id,
    candidateName: row?.name || null,
    appliedAt: row?.applied_at ?? row?.appliedAt ?? null,
  };
}

async function workerBuildFileUploadFields(applicationId, fields) {
  const fileFields = (fields || []).filter((field) => field.fieldType === 'file');
  const uploads = [];
  for (const field of fileFields) {
    const docType = workerInferFileDocumentType(field);
    const doc = await workerFetchDocumentBase64(applicationId, docType);
    if (!doc.success) {
      throw new Error(doc.message || `Could not load ${docType} PDF from server.`);
    }
    uploads.push({
      ...field,
      category: 'document_upload',
      fillStatus: 'filled',
      fillValue: doc.fileName,
      upload: {
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        base64: doc.base64,
      },
    });
  }
  return uploads;
}

if (typeof self !== 'undefined') {
  self.__qtsApiWorker = {
    workerApiRequest,
    workerBrowserKey,
    workerFetchDocumentBase64,
    workerFetchAccountResumeBase64,
    workerFetchGptTaskDocumentBase64,
    workerParseApplicationId,
    workerInferFileDocumentType,
    workerCheckDefaultCandidateApplied,
    workerBuildFileUploadFields,
  };
}
