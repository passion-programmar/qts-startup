// Glassdoor job extractor

function glassdoorExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'glassdoor' };

  const title = tryText([
    '[data-test="job-title"]',
    '.JobDetails_jobTitle__Rw_gn',
    '[class*="jobTitle"]',
    'h1[class*="job"]',
    'h1',
  ]);

  const company = tryText([
    '[data-test="employer-name"]',
    '.JobDetails_companyName__t9Kcu',
    '[class*="companyName"]',
    '[class*="EmployerProfile"] h2',
    '[data-test="employerName"]',
  ]);

  const descEl = document.querySelector([
    '[class*="JobDetails_jobDescription"]',
    '[data-test="jobDescriptionContent"]',
    '[class*="desc"]',
    '.jobDescriptionContent',
  ].join(','));
  const description = descEl ? window.__stripHtml(descEl.innerHTML) : '';

  return { title, company, description, url: document.location.href, source: 'glassdoor' };
}

function tryText(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) { const t = el.innerText?.trim(); if (t) return t; }
    } catch { /* skip */ }
  }
  return '';
}

window.__glassdoorExtract = glassdoorExtract;
