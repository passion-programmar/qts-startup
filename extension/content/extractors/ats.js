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
  const main = document.querySelector('main, [role="main"]') || document;
  const structured = ld || {};
  const title = structured.title
    || tryText(['.job-title', 'h1[class*="title"]', 'h1'], main);
  const company = structured.company
    || tryText(['.company-name', '[class*="company"]'], main)
    || smartRecruitersCompanyName();
  const description = structured.description
    || smartRecruitersDescription(main);
  return {
    title,
    company,
    description,
    url: structured.url || document.location.href,
    source: 'smartrecruiters',
  };
}

function smartRecruitersCompanyName() {
  const logoAlt = tryText([
    'header img[alt]',
    '[role="banner"] img[alt]',
    'img[alt*="logo" i]',
  ]);
  if (logoAlt) return logoAlt.replace(/\s+logo$/i, '').trim();
  return tryText(['meta[property="og:site_name"]']);
}

function smartRecruitersDescription(root) {
  const strip = window.__stripHtml || ((html) => html || '');
  const selectors = [
    '#st-jobDescription .wysiwyg',
    '#st-jobDescription',
    '[id*="jobDescription"] .wysiwyg',
    '[id*="jobDescription"]',
    '.job-description',
    '[class~="job-description"]',
  ];
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text = element ? strip(element.innerHTML).trim() : '';
    if (text.length >= 80) return text;
  }

  for (const heading of root.querySelectorAll('h1, h2, h3, h4')) {
    const label = (heading.innerText || heading.textContent || '').trim();
    if (!/^(job description|role description|about the role)$/i.test(label)) continue;
    const section = heading.closest('section, article, [class*="section"]')
      || heading.parentElement;
    if (!section) continue;
    const content = section.querySelector('.wysiwyg, [class*="description"], [class*="content"]');
    const text = strip(content?.innerHTML || section.innerHTML).trim();
    if (text.length >= 80) return text;
  }

  const fallbackSelectors = [
    '.job-sections .wysiwyg',
    '[class*="job-description"]',
    '[class*="description-content"]',
  ];
  for (const selector of fallbackSelectors) {
    const element = root.querySelector(selector);
    const text = element ? strip(element.innerHTML).trim() : '';
    if (text.length >= 80) return text;
  }
  return '';
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

function tryText(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
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
