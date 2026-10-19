// Indeed job extractor

function indeedExtract() {
  const ld = window.__extractJsonLd && window.__extractJsonLd();
  if (ld && ld.title) return { ...ld, source: 'indeed' };

  const title = tryText([
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    '.jobsearch-JobInfoHeader-title',
    'h1.jobsearch-JobInfoHeader-title',
    'h1[class*="JobTitle"]',
    'h1',
  ]);

  const company = tryText([
    '[data-testid="inlineHeader-companyName"] a',
    '[data-testid="inlineHeader-companyName"]',
    '.jobsearch-InlineCompanyRating a',
    '.jobsearch-CompanyInfoContainer a',
    '[class*="companyName"]',
  ]);

  const descEl = document.querySelector([
    '#jobDescriptionText',
    '[data-testid="jobDescriptionText"]',
    '.jobsearch-jobDescriptionText',
    '[class*="jobDescription"]',
  ].join(','));
  const description = descEl ? window.__stripHtml(descEl.innerHTML) : '';

  // Try to get canonical job URL
  let url = document.location.href;
  const jk = new URL(url).searchParams.get('jk');
  if (jk) url = `https://www.indeed.com/viewjob?jk=${jk}`;

  return { title, company, description, url, source: 'indeed' };
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

window.__indeedExtract = indeedExtract;
