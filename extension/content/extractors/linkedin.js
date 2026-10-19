// LinkedIn job extractor — supports full job pages and split-view search (list left, JD right)

(function initLinkedInExtractor() {
  if (window.__linkedInExtract) return;

const LINKEDIN_DETAIL_ROOT_SELECTORS = [
  '.jobs-search__job-details',
  '.jobs-details',
  '.jobs-details__main-content',
  '.scaffold-layout__detail',
  '[data-test-job-details]',
  'div[class*="job-details-jobs-unified"]',
  'div[class*="jobs-details"]',
];

const LINKEDIN_TITLE_SELECTORS = [
  '.job-details-jobs-unified-top-card__job-title h1',
  '.jobs-unified-top-card__job-title h1',
  '.jobs-unified-top-card__job-title',
  '.topcard__title',
  '[data-test-id="job-details-header"] h1',
  'h1.t-24',
  'h1',
];

const LINKEDIN_COMPANY_SELECTORS = [
  '.job-details-jobs-unified-top-card__company-name',
  '.jobs-unified-top-card__company-name a',
  '.jobs-unified-top-card__company-name',
  '.topcard__org-name-link',
  '.jobs-unified-top-card__subtitle-primary-grouping a',
];

const LINKEDIN_DESC_SELECTORS = [
  '.jobs-description-content__text',
  '.jobs-description__content',
  '#job-details',
  '.description__text',
  '[class*="jobs-description"]',
];

const LINKEDIN_ACTIVE_CARD_SELECTORS = [
  '.jobs-search-results__list-item--active',
  'li.jobs-search-results__list-item[aria-current="true"]',
  '.job-card-container--active',
  '[data-job-id].jobs-search-results__list-item--active',
  '.jobs-search-results__list-item:focus',
];

function tryText(selectors, root) {
  const scope = root || document;
  for (const sel of selectors) {
    try {
      const el = scope.querySelector(sel);
      if (el) {
        const t = el.innerText?.trim();
        if (t) return t;
      }
    } catch { /* skip */ }
  }
  return '';
}

function parseJobIdFromUrn(value) {
  const match = String(value || '').match(/jobPosting:(\d+)/i);
  return match ? match[1] : '';
}

function parseJobIdFromHref(href) {
  if (!href) return '';
  const match = String(href).match(/\/jobs\/view\/(?:[^/?#]+-)?(\d+)/i);
  return match ? match[1] : '';
}

function findLinkedInDetailRoot() {
  for (const sel of LINKEDIN_DETAIL_ROOT_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      const text = el?.innerText?.trim() || '';
      if (text.length >= 80) return el;
    } catch { /* skip */ }
  }
  return null;
}

function findLinkedInActiveCard() {
  for (const sel of LINKEDIN_ACTIVE_CARD_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* skip */ }
  }

  const selected = document.querySelector('[data-job-id][aria-current="true"], [data-job-id].jobs-search-results__list-item--active');
  return selected || null;
}

function extractLinkedInJobId() {
  try {
    const pageUrl = new URL(window.location.href);
    const fromQuery = pageUrl.searchParams.get('currentJobId');
    if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;

    const fromPath = pageUrl.pathname.match(/\/jobs\/view\/(?:[^/?#]+-)?(\d+)/i)?.[1];
    if (fromPath) return fromPath;
  } catch { /* skip */ }

  const detailRoot = findLinkedInDetailRoot();
  const scopes = [detailRoot, findLinkedInActiveCard(), document].filter(Boolean);

  for (const scope of scopes) {
    const dataJobId = scope.getAttribute?.('data-job-id')
      || scope.querySelector?.('[data-job-id]')?.getAttribute('data-job-id');
    if (dataJobId && /^\d+$/.test(dataJobId)) return dataJobId;

    const urn = scope.getAttribute?.('data-entity-urn')
      || scope.querySelector?.('[data-entity-urn*="jobPosting"]')?.getAttribute('data-entity-urn');
    const fromUrn = parseJobIdFromUrn(urn);
    if (fromUrn) return fromUrn;
  }

  const linkScopes = [detailRoot, findLinkedInActiveCard(), document].filter(Boolean);
  for (const scope of linkScopes) {
    const links = scope.querySelectorAll?.('a[href*="/jobs/view/"]') || [];
    for (const link of links) {
      const fromHref = parseJobIdFromHref(link.getAttribute('href') || link.href);
      if (fromHref) return fromHref;
    }
  }

  const ogUrl = document.querySelector('meta[property="og:url"], meta[name="og:url"]')?.getAttribute('content');
  const fromOg = parseJobIdFromHref(ogUrl);
  if (fromOg) return fromOg;

  return '';
}

function buildLinkedInCanonicalUrl(jobId) {
  if (!jobId) return window.location.href;

  const detailRoot = findLinkedInDetailRoot();
  const activeCard = findLinkedInActiveCard();
  const candidates = [];

  for (const scope of [detailRoot, activeCard]) {
    if (!scope) continue;
    const links = scope.querySelectorAll('a[href*="/jobs/view/"]');
    for (const link of links) {
      const href = link.getAttribute('href') || link.href;
      if (href) candidates.push(href);
    }
  }

  for (const href of candidates) {
    try {
      const parsed = new URL(href, window.location.origin);
      const pathMatch = parsed.pathname.match(/\/jobs\/view\/([^/?#]+)/i);
      if (!pathMatch) continue;
      const slug = pathMatch[1];
      if (slug.endsWith(`-${jobId}`) || slug === jobId) {
        return `https://www.linkedin.com/jobs/view/${slug}/`;
      }
    } catch { /* skip */ }
  }

  return `https://www.linkedin.com/jobs/view/${jobId}/`;
}

function linkedInExtract() {
  const detailRoot = findLinkedInDetailRoot();
  const scope = detailRoot || document;

  const ld = window.__extractJsonLd && window.__extractJsonLd();
  const jobId = extractLinkedInJobId();
  const canonicalUrl = buildLinkedInCanonicalUrl(jobId);

  if (ld && ld.title) {
    return {
      ...ld,
      url: canonicalUrl,
      source: 'linkedin',
      linkedinJobId: jobId || undefined,
    };
  }

  const title = tryText(LINKEDIN_TITLE_SELECTORS, scope);
  const company = tryText(LINKEDIN_COMPANY_SELECTORS, scope);

  let descEl = null;
  for (const sel of LINKEDIN_DESC_SELECTORS) {
    try {
      const el = scope.querySelector(sel);
      const text = el ? window.__stripHtml(el.innerHTML) : '';
      if (text.length >= 40) {
        descEl = el;
        break;
      }
    } catch { /* skip */ }
  }
  const description = descEl ? window.__stripHtml(descEl.innerHTML) : '';

  return {
    title,
    company,
    description,
    url: canonicalUrl,
    source: 'linkedin',
    linkedinJobId: jobId || undefined,
  };
}

window.__linkedInExtract = linkedInExtract;
window.__linkedInExtractJobId = extractLinkedInJobId;
window.__linkedInBuildCanonicalUrl = buildLinkedInCanonicalUrl;
})();
