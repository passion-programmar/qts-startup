// Generic extractor — tries JSON-LD, meta tags, headings, common selectors

function extractJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent);
      if (data['@graph']) data = data['@graph'];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item['@type'] === 'JobPosting') return parseJobPosting(item);
        }
      } else if (data['@type'] === 'JobPosting') {
        return parseJobPosting(data);
      }
    } catch { /* invalid JSON-LD */ }
  }
  return null;
}

function parseJobPosting(jp) {
  return {
    title: jp.title || jp.name || '',
    company: (jp.hiringOrganization && jp.hiringOrganization.name) || '',
    description: stripHtml(jp.description || ''),
    url: jp.url || document.location.href,
  };
}

function trySelectors(selectors, root) {
  const scope = root || document;
  for (const sel of selectors) {
    try {
      const el = scope.querySelector(sel);
      if (el) {
        const text = el.innerText?.trim() || el.textContent?.trim();
        if (text) return text;
      }
    } catch { /* bad selector */ }
  }
  return '';
}

function stripHtml(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('script,style,nav,footer').forEach(e => e.remove());
  return d.innerText?.replace(/\n{3,}/g, '\n\n').trim() || '';
}

function getMetaContent(name) {
  const el = document.querySelector(`meta[name="${name}"],meta[property="${name}"]`);
  return el?.getAttribute('content') || '';
}

function findJobDetailRoot() {
  const roots = [
    '[class*="job-details"]',
    '[class*="JobDetails"]',
    '[class*="job-detail"]',
    '[class*="jobDetail"]',
    '[class*="position-details"]',
    '[class*="posting-details"]',
    '[class*="vacancy-details"]',
    '[data-testid*="job-details"]',
    '[role="main"] [class*="detail"]',
    'aside [class*="job"]',
  ];

  for (const sel of roots) {
    try {
      const el = document.querySelector(sel);
      const text = el?.innerText?.trim() || '';
      if (text.length >= 80) return el;
    } catch { /* skip */ }
  }
  return null;
}

function findDescriptionElement(root) {
  const scope = root || document;
  const descSelectors = [
    '[data-testid*="description"]',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[class*="description-content"]',
    '[class*="posting-description"]',
    '#jobDescriptionText',
    '.jobs-description-content__text',
  ];

  for (const sel of descSelectors) {
    try {
      const el = scope.querySelector(sel);
      const text = stripHtml(el?.innerHTML || '');
      if (text.length >= 80) return el;
    } catch { /* skip */ }
  }

  if (root) {
    const headings = root.querySelectorAll('h1, h2, h3');
    for (const heading of headings) {
      let sibling = heading.nextElementSibling;
      while (sibling) {
        const text = stripHtml(sibling.innerHTML || '');
        if (text.length >= 80) return sibling;
        sibling = sibling.nextElementSibling;
      }
    }
  }

  return null;
}

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

function genericExtract() {
  const ld = extractJsonLd();
  if (ld && ld.title) {
    ld.url = normalizeJobUrl(ld.url || document.location.href);
    return ld;
  }

  const detailRoot = findJobDetailRoot();
  const scope = detailRoot || document;

  const titleSelectors = [
    'h1[data-testid*="job-title"]',
    '[data-testid*="job-title"]',
    '[class*="jobTitle"] h1',
    '[class*="job-title"] h1',
    '[class*="job-title"]',
    '[class*="jobTitle"]',
    '[id*="job-title"]',
    'h1',
  ];
  const companySelectors = [
    '[data-testid*="company"]',
    '[class*="company-name"]',
    '[class*="companyName"]',
    '[id*="company"]',
    '[class*="employer"]',
    '[data-company]',
  ];

  const title = trySelectors(titleSelectors, scope)
    || getMetaContent('og:title')
    || document.title;
  const company = trySelectors(companySelectors, scope)
    || getMetaContent('og:site_name')
    || '';

  const descEl = findDescriptionElement(scope);
  const description = descEl
    ? stripHtml(descEl.innerHTML)
    : (getMetaContent('description') || getMetaContent('og:description') || '');

  const url = normalizeJobUrl(getMetaContent('og:url') || document.location.href);

  return {
    title: title.split('|')[0].split('-')[0].trim(),
    company,
    description,
    url,
  };
}

window.__genericExtract = genericExtract;
window.__extractJsonLd = extractJsonLd;
window.__stripHtml = stripHtml;
window.__normalizeJobUrl = normalizeJobUrl;
