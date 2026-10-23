// Shared job detection helpers (popup + service worker via importScripts)

const DETECTED_JOBS_STORAGE_KEY = 'detectedJobs';
const DETECT_SUCCESS_MESSAGE = 'Successfully detect!';
const DETECT_FAIL_MESSAGE = 'Not detected';
const MIN_JOB_DESCRIPTION_LENGTH = 80;

const GENERIC_JOB_TITLES = new Set([
  'jobs',
  'job',
  'job search',
  'search jobs',
  'search results',
  'careers',
  'career',
  'job openings',
  'open jobs',
  'all jobs',
  'find jobs',
  'browse jobs',
  'linkedin',
  'indeed',
  'glassdoor',
  'workday',
  'greenhouse',
]);

function normalizeJobUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\s+/g, '-').replace(/-+/g, '-'))
      .join('/');
    return parsed.href;
  } catch {
    return trimmed.replace(/\s+/g, '-');
  }
}

function normalizeDetectedJobData(data, pageUrl) {
  const rawUrl = String(data?.url || pageUrl || '').trim();
  return {
    title: String(data?.title || '').trim(),
    company: String(data?.company || '').trim(),
    description: String(data?.description || '').trim(),
    location: String(data?.location || '').trim(),
    country: String(data?.country || '').trim(),
    employmentType: String(data?.employmentType || '').trim(),
    workplaceType: String(data?.workplaceType || '').trim(),
    salary: String(data?.salary || '').trim(),
    url: normalizeJobUrl(rawUrl),
    source: String(data?.source || '').trim(),
  };
}

function mergeMissingJobDetails(current, detected) {
  const merged = { ...current };
  for (const key of [
    'title',
    'company',
    'description',
    'location',
    'country',
    'employmentType',
    'workplaceType',
    'salary',
    'url',
    'source',
  ]) {
    const currentValue = String(current?.[key] || '').trim();
    const detectedValue = String(detected?.[key] || '').trim();
    merged[key] = currentValue ? current[key] : detectedValue;
  }
  return merged;
}

function mergeJobExtractionSamples(previous, next, pageUrl) {
  const current = normalizeDetectedJobData(previous, pageUrl);
  const candidate = normalizeDetectedJobData(next, pageUrl);
  const preferSpecificText = (oldValue, newValue) => {
    if (!oldValue || (isGenericJobTitle(oldValue) && newValue && !isGenericJobTitle(newValue))) {
      return newValue || oldValue;
    }
    return oldValue;
  };
  return {
    title: preferSpecificText(current.title, candidate.title),
    company: preferSpecificText(current.company, candidate.company),
    description: candidate.description.length > current.description.length
      ? candidate.description
      : current.description,
    location: current.location || candidate.location,
    country: current.country || candidate.country,
    employmentType: current.employmentType || candidate.employmentType,
    workplaceType: current.workplaceType || candidate.workplaceType,
    salary: current.salary || candidate.salary,
    url: normalizeJobUrl(pageUrl || current.url || candidate.url),
    source: current.source || candidate.source,
  };
}

function usablePartialJobDetails(data, pageUrl) {
  const normalized = normalizeDetectedJobData(data, pageUrl);
  const partial = {
    ...normalized,
    title: isGenericJobTitle(normalized.title) ? '' : normalized.title,
    company: isGenericJobTitle(normalized.company) ? '' : normalized.company,
  };
  return {
    data: partial,
    hasDetails: Boolean(
      partial.title || partial.company || partial.description.trim() || partial.location,
    ),
  };
}

function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isGenericJobTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  if (!value || value.length < 3) return true;
  if (GENERIC_JOB_TITLES.has(value)) return true;
  if (/^(jobs?|search|careers?|opportunities|openings)\b/i.test(value)) return true;
  if (/^\d[\d,]*\+?\s+jobs?\b/i.test(value)) return true;
  if (/^jobs?\s+(in|near|at)\b/i.test(value)) return true;
  if (/^find\s+jobs?\b/i.test(value)) return true;
  return false;
}

function classifyJobPageUrl(pageUrl, configuredDetailUrl = false) {
  if (!isValidHttpUrl(String(pageUrl || ''))) return 'unknown';
  return configuredDetailUrl === true ? 'detail' : 'unknown';
}

function hasSubstantialJobContent(data, pageUrl) {
  const normalized = normalizeDetectedJobData(data, pageUrl);
  return Boolean(
    (normalized.title && !isGenericJobTitle(normalized.title)) ||
    normalized.description.length >= 40
  );
}

function isValidDetectedJob(data, pageUrl) {
  const normalized = normalizeDetectedJobData(data, pageUrl);
  if (!normalized.title || !normalized.description || !isValidHttpUrl(normalized.url)) return false;
  if (isGenericJobTitle(normalized.title)) return false;
  if (normalized.description.length < MIN_JOB_DESCRIPTION_LENGTH) return false;
  return true;
}

function isValidGetJdCheckJob(data, pageUrl) {
  const normalized = normalizeDetectedJobData(data, pageUrl);
  return isValidDetectedJob(normalized, pageUrl)
    && normalized.title.length <= 500
    && normalized.company.length > 0
    && normalized.company.length <= 500
    && normalized.url.length <= 2048;
}

function resolveDetectMode(pageType, pageUrl, data, valid) {
  if (!valid) return 'none';
  if (pageType === 'detail') return 'detail';
  if (hasSubstantialJobContent(data, pageUrl)) return 'split-view';
  return 'content';
}

function buildDetectedJobEntry(tabId, pageUrl, data, pageType = 'unknown') {
  const normalized = normalizeDetectedJobData(data, pageUrl);
  const valid = isValidDetectedJob(data, pageUrl);
  return {
    tabId,
    url: normalizeJobUrl(pageUrl),
    pageType,
    detectMode: resolveDetectMode(pageType, pageUrl, data, valid),
    detectedAt: Date.now(),
    valid,
    data: valid ? normalized : null,
  };
}

function getDetectedJobsMap(storageResult) {
  return storageResult?.[DETECTED_JOBS_STORAGE_KEY] || {};
}

async function getDetectedJobForTab(tabId) {
  const key = String(tabId);
  const result = await chrome.storage.local.get([DETECTED_JOBS_STORAGE_KEY]);
  return getDetectedJobsMap(result)[key] || null;
}

async function setDetectedJobForTab(entry) {
  const key = String(entry.tabId);
  const result = await chrome.storage.local.get([DETECTED_JOBS_STORAGE_KEY]);
  const jobs = getDetectedJobsMap(result);
  jobs[key] = entry;
  await chrome.storage.local.set({ [DETECTED_JOBS_STORAGE_KEY]: jobs });
}

async function removeDetectedJobForTab(tabId) {
  const key = String(tabId);
  const result = await chrome.storage.local.get([DETECTED_JOBS_STORAGE_KEY]);
  const jobs = getDetectedJobsMap(result);
  if (!jobs[key]) return;
  delete jobs[key];
  await chrome.storage.local.set({ [DETECTED_JOBS_STORAGE_KEY]: jobs });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    classifyJobPageUrl,
    isValidGetJdCheckJob,
    mergeJobExtractionSamples,
    mergeMissingJobDetails,
    usablePartialJobDetails,
  };
}
