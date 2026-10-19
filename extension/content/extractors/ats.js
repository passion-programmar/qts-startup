// Greenhouse extractor
function greenhouseExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'greenhouse' };
  return {
    title: tryText(['h1.app-title', '#header h1', '.job__title', 'h1']),
    company: tryText(['.company-name', '#header .company', 'h1 + p']),
    description: (() => {
      const el = document.querySelector('#content, .job__description, [class*="content"]');
      return el ? window.__stripHtml(el.innerHTML) : '';
    })(),
    url: document.location.href, source: 'greenhouse',
  };
}

// Lever extractor
function leverExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'lever' };
  return {
    title: tryText(['.posting-headline h2', 'h2[data-qa="posting-name"]', 'h2']),
    company: (() => {
      const m = document.title.match(/at (.+)$/);
      return tryText(['.main-header-logo img[alt]']) || (m ? m[1] : '') || '';
    })(),
    description: (() => {
      const el = document.querySelector('.section-wrapper, [class*="description"], .posting-categories + div');
      return el ? window.__stripHtml(el.innerHTML) : '';
    })(),
    url: document.location.href, source: 'lever',
  };
}

// Workable extractor
function workableExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'workable' };
  return {
    title: tryText(['h1[data-ui="job-title"]', '.job-title h1', 'h1']),
    company: tryText(['[data-ui="company-name"]', '.company-name']),
    description: (() => {
      const el = document.querySelector('[data-ui="job-description"],.job-description,[class*="description"]');
      return el ? window.__stripHtml(el.innerHTML) : '';
    })(),
    url: document.location.href, source: 'workable',
  };
}

// SmartRecruiters extractor
function smartrecruitersExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'smartrecruiters' };
  return {
    title: tryText(['.job-title', 'h1[class*="title"]', 'h1']),
    company: tryText(['.company-name', '[class*="company"]']),
    description: (() => {
      const el = document.querySelector('.job-description,[class*="description"]');
      return el ? window.__stripHtml(el.innerHTML) : '';
    })(),
    url: document.location.href, source: 'smartrecruiters',
  };
}

// Ashby extractor
function ashbyExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'ashby' };
  return {
    title: tryText(['h1[class*="title"]', '[class*="JobPosting"] h1', 'h1']),
    company: tryText(['[class*="company"]', '[class*="organization"]']),
    description: (() => {
      const el = document.querySelector('[class*="description"],[class*="content"]');
      return el ? window.__stripHtml(el.innerHTML) : '';
    })(),
    url: document.location.href, source: 'ashby',
  };
}

function tryText(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.getAttribute('alt') || el.innerText || el.textContent || '').trim();
        if (t) return t;
      }
    } catch { /* skip */ }
  }
  return '';
}

window.__greenhouseExtract = greenhouseExtract;
window.__leverExtract = leverExtract;
window.__workableExtract = workableExtract;
window.__smartrecruitersExtract = smartrecruitersExtract;
window.__ashbyExtract = ashbyExtract;
