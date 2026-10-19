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
    url: normalizeJobUrl(rawUrl),
    source: String(data?.source || '').trim(),
  };
}

function mergeMissingJobDetails(current, detected) {
  const merged = { ...current };
  for (const key of ['title', 'company', 'description', 'url', 'source']) {
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
    hasDetails: Boolean(partial.title || partial.company || partial.description.trim()),
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

function parsePageUrl(pageUrl) {
  try {
    return new URL(pageUrl);
  } catch {
    return null;
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

function isLinkedInJobDetailUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  if (/\/jobs\/view\/\d+/i.test(path)) return true;
  if (parsed.searchParams.get('currentJobId')) return true;
  return false;
}

function isLinkedInJobListUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  if (isLinkedInJobDetailUrl(parsed)) return false;
  if (path.includes('/jobs/search')) return true;
  if (path.includes('/jobs/collections')) return true;
  if (path === '/jobs' || path === '/jobs/') return true;
  if (path.startsWith('/jobs/')) return true;
  return false;
}

function isIndeedJobDetailUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  if (parsed.searchParams.get('jk')) return true;
  if (path.includes('/viewjob')) return true;
  if (path.includes('/rc/clk')) return true;
  return false;
}

function isIndeedJobListUrl(parsed) {
  if (isIndeedJobDetailUrl(parsed)) return false;
  const path = parsed.pathname.toLowerCase();
  if (path === '/jobs' || path === '/jobs/') return true;
  if (path.startsWith('/q-')) return true;
  if (path.startsWith('/cmp/')) return true;
  if (parsed.searchParams.has('q')) return true;
  return false;
}

function isGlassdoorJobDetailUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  return /\/job\/[^/]+-jv_/i.test(path);
}

function isGlassdoorJobListUrl(parsed) {
  if (isGlassdoorJobDetailUrl(parsed)) return false;
  const path = parsed.pathname.toLowerCase();
  if (path.includes('/job/')) return true;
  if (path.includes('/jobs/')) return true;
  return false;
}

function isGreenhouseJobDetailUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  return /\/jobs\/[^/?#]+/i.test(path) && !/\/jobs\/?$/.test(path);
}

function isLeverJobDetailUrl(parsed) {
  const parts = parsed.pathname.split('/').filter(Boolean);
  return parts.length >= 2;
}

function isGenericJobListUrl(parsed) {
  const path = parsed.pathname.toLowerCase();
  if (/\/(search|results|listings?|browse)\b/i.test(path)) return true;
  if (/\/jobs\/?$/.test(path)) return true;
  if (/\/careers\/?$/.test(path)) return true;
  if (parsed.searchParams.has('q') || parsed.searchParams.has('query') || parsed.searchParams.has('keywords')) {
    return true;
  }
  return false;
}

function getLastPathSegment(pageUrl) {
  const parsed = parsePageUrl(pageUrl);
  if (!parsed) return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return '';
  try {
    return decodeURIComponent(last).trim();
  } catch {
    return last.trim();
  }
}

function lastSegmentLooksLikeJobSlug(segment) {
  const value = String(segment || '').trim().toLowerCase();
  if (!value || value.length < 8) return false;
  if (!value.includes('-')) return false;
  if (['search-results', 'job-search', 'all-jobs', 'remote-jobs'].includes(value)) return false;
  return value.split('-').filter(Boolean).length >= 2;
}

function isStructureListPath(path) {
  return /\/category\/|\/categories\/|\/tag\/|\/tags\/|\/topics?\//i.test(path);
}

function isStructureDetailPath(path) {
  return /\/remote-job\/|\/job-posting\/|\/position\/|\/positions\/|\/jobs\/view\//i.test(path);
}

function classifyJobPageUrl(pageUrl) {
  const parsed = parsePageUrl(pageUrl);
  if (!parsed) return 'unknown';

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();

  if (host.includes('linkedin.com')) {
    if (isLinkedInJobDetailUrl(parsed)) return 'detail';
    if (isLinkedInJobListUrl(parsed)) return 'list';
    // Slug-style collection pages, e.g. /devops-remote-past-developer
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 1 && segments[0].includes('-')) return 'list';
    return 'unknown';
  }

  if (host.includes('indeed.com')) {
    if (isIndeedJobDetailUrl(parsed)) return 'detail';
    if (isIndeedJobListUrl(parsed)) return 'list';
    return 'unknown';
  }

  if (host.includes('glassdoor.com')) {
    if (isGlassdoorJobDetailUrl(parsed)) return 'detail';
    if (isGlassdoorJobListUrl(parsed)) return 'list';
    return 'unknown';
  }

  if (host.includes('dynamitejobs.com')) {
    if (path.includes('/category/')) return 'list';
    if (path.includes('/remote-job/')) return 'detail';
  }

  if (host.includes('greenhouse.io') || host.includes('greenhouse.com')) {
    if (isGreenhouseJobDetailUrl(parsed)) return 'detail';
    if (path.includes('/jobs')) return 'list';
  }

  if (host.includes('lever.co')) {
    if (isLeverJobDetailUrl(parsed)) return 'detail';
    return 'list';
  }

  if (host.includes('workable.com')) {
    if (/\/j\/[^/?#]+/i.test(path)) return 'detail';
    if (path.includes('/jobs')) return 'list';
  }

  if (host.includes('smartrecruiters.com')) {
    if (/\/[^/]+\/[^/]+$/i.test(path) && !path.endsWith('/jobs')) return 'detail';
    if (path.includes('/jobs')) return 'list';
  }

  if (host.includes('ashbyhq.com')) {
    if (/\/[^/]+\/[^/]+/i.test(path)) return 'detail';
    if (path.includes('/jobs')) return 'list';
  }

  if (isGenericJobListUrl(parsed)) return 'list';
  if (isStructureListPath(path)) return 'list';
  if (isStructureDetailPath(path)) return 'detail';

  const last = getLastPathSegment(pageUrl);
  if (lastSegmentLooksLikeJobSlug(last)) return 'detail';
  if (last && !last.includes('-')) return 'list';

  return 'unknown';
}

function isLikelyJobListUrl(pageUrl) {
  return classifyJobPageUrl(pageUrl) === 'list';
}

function isLikelyJobDetailUrl(pageUrl) {
  return classifyJobPageUrl(pageUrl) === 'detail';
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

function resolveDetectMode(pageType, pageUrl, data, valid) {
  if (!valid) return 'none';
  if (pageType === 'detail') return 'detail';
  if (pageType === 'list') return 'split-view';
  // URL unchanged sidebar sites (LinkedIn collections, etc.)
  if (hasSubstantialJobContent(data, pageUrl)) return 'split-view';
  return 'content';
}

function buildDetectedJobEntry(tabId, pageUrl, data) {
  const pageType = classifyJobPageUrl(pageUrl);
  const normalized = normalizeDetectedJobData(data, pageUrl);
  const valid = isValidDetectedJob(data, pageUrl);
  const lastSegment = getLastPathSegment(pageUrl);
  return {
    tabId,
    url: normalizeJobUrl(pageUrl),
    pageType,
    urlHint: {
      lastSegment,
      slugLike: lastSegmentLooksLikeJobSlug(lastSegment),
      hasHyphenInLastSegment: lastSegment.includes('-'),
    },
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
    mergeJobExtractionSamples,
    mergeMissingJobDetails,
    usablePartialJobDetails,
  };
}
