// Readers for more job systems, plus the company name taken from job-site URLs.
// Each reader prefers structured JobPosting data, then the site's own page
// elements; the extractor manager fills anything still empty from the generic
// reader and replaces a missing or platform-name company with the URL company.

(function initJobSiteExtractors() {
  if (window.__jobSiteExtractorFor) return;

  // Names of job platforms and generic page labels, which are never the hiring company.
  const PLATFORM_NAME = /^(?:greenhouse|lever|workday|myworkdayjobs|ashby|ashbyhq|icims|jobvite|teamtailor|recruitee|bamboo ?hr|breezy(?: ?hr)?|jazz ?hr|personio|rippling|wellfound|angel ?list|workable|smart ?recruiters|taleo|oracle(?: cloud)?|(?:sap )?success ?factors|linkedin|indeed|glassdoor|careers?|jobs?|job board|job openings|open positions|careers? (?:site|page|portal|center)|apply|home)$/i;

  function isJobPlatformName(value) {
    const name = String(value || '').replace(/\s+/g, ' ').trim().replace(/\s*[-|–—]\s*(?:careers?|jobs?)$/i, '');
    return !name || PLATFORM_NAME.test(name);
  }

  function humanizeSlug(slug) {
    let text = String(slug || '');
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the raw slug.
    }
    text = text.replace(/[-_+.]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^\d+$/.test(text)) return '';
    // Slugs are usually lowercase; keep any capitals the site already used.
    return text === text.toLowerCase()
      ? text.replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase())
      : text;
  }

  const GENERIC_SLUG = /^(?:www|jobs?|careers?|apply|boards?|job-boards|app|ats|embed|en|us|uk|eu|external|portal|hire)$/i;

  /** Company named in a job-site URL, for example jobs.lever.co/acme or acme.wd5.myworkdayjobs.com. */
  function companyFromJobSiteUrl(value) {
    let url;
    try {
      url = new URL(String(value || ''));
    } catch {
      return '';
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const segments = url.pathname.split('/').filter(Boolean);
    const first = segments[0] || '';
    const subdomain = host.split('.')[0];
    let slug = '';
    if (/(?:^|\.)greenhouse\.io$/.test(host)) slug = url.searchParams.get('for') || (first === 'embed' ? '' : first);
    else if (/(?:^|\.)lever\.co$/.test(host)) slug = first;
    else if (host === 'jobs.ashbyhq.com') slug = first;
    else if (/(?:^|\.)myworkday(?:jobs|site)\.com$/.test(host)) slug = subdomain;
    else if (/(?:^|\.)icims\.com$/.test(host)) slug = subdomain.replace(/^(?:careers|jobs|uscareers|external)-/, '');
    else if (host === 'jobs.jobvite.com') slug = first;
    else if (/\.(?:teamtailor|recruitee|bamboohr|applytojob)\.com$|\.breezy\.hr$/.test(host)) slug = subdomain;
    else if (/\.jobs\.personio\.(?:de|com)$/.test(host)) slug = subdomain;
    else if (host === 'ats.rippling.com') slug = first;
    else if (host === 'wellfound.com' && first === 'company') slug = segments[1] || '';
    else if (host === 'apply.workable.com') slug = first;
    else if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') slug = first;
    else if (/\.taleo\.net$/.test(host)) slug = subdomain;
    else if (/successfactors\.(?:com|eu)$/.test(host)) slug = url.searchParams.get('company') || '';
    if (!slug || GENERIC_SLUG.test(slug)) return '';
    return humanizeSlug(slug);
  }

  function readText(element) {
    return String(element?.innerText || element?.textContent || element?.getAttribute?.('content') || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstText(selectors) {
    for (const selector of selectors || []) {
      try {
        const text = readText(document.querySelector(selector));
        if (text) return text;
      } catch {
        // Skip selectors the page does not support.
      }
    }
    return '';
  }

  function firstDescription(selectors) {
    const strip = window.__stripHtml || ((html) => String(html || '').replace(/<[^>]*>/g, ' '));
    for (const selector of selectors || []) {
      try {
        const element = document.querySelector(selector);
        const text = element ? strip(element.innerHTML).trim() : '';
        if (text.length >= 80) return text;
      } catch {
        // Skip selectors the page does not support.
      }
    }
    return '';
  }

  function siteExtractor(source, selectors) {
    return function extractJobSite() {
      const ld = (window.__extractJsonLd && window.__extractJsonLd()) || {};
      return {
        ...ld,
        title: ld.title || firstText(selectors.title),
        company: (!isJobPlatformName(ld.company) && ld.company) || firstText(selectors.company),
        description: ld.description || firstDescription(selectors.description),
        location: ld.location || firstText(selectors.location),
        url: ld.url || document.location.href,
        source,
      };
    };
  }

  // Best-effort page elements per system; structured data and the generic reader cover the rest.
  const SITES = [
    {
      source: 'workday',
      host: /(?:^|\.)myworkday(?:jobs|site)\.com$/,
      title: ['[data-automation-id="jobPostingHeader"]'],
      description: ['[data-automation-id="jobPostingDescription"]'],
      location: ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]'],
    },
    {
      source: 'icims',
      host: /(?:^|\.)icims\.com$/,
      title: ['.iCIMS_Header h1', 'h1.iCIMS_Header', '.iCIMS_JobHeaderTag h1', 'h1'],
      description: ['.iCIMS_JobContent', '.iCIMS_InfoMsg_Job', '#iCIMS_Content'],
    },
    {
      source: 'jobvite',
      host: /(?:^|\.)jobvite\.com$/,
      title: ['.jv-header', 'h2.jv-header', 'h1'],
      description: ['.jv-job-detail-description'],
      location: ['.jv-job-detail-meta'],
    },
    {
      source: 'teamtailor',
      host: /\.teamtailor\.com$/,
      title: ['[data-controller*="job"] h1', 'h1'],
      description: ['[data-controller*="job-ad"] .prose', '.prose', '[class*="job-ad"]'],
    },
    {
      source: 'recruitee',
      host: /\.recruitee\.com$/,
      title: ['h1'],
      description: ['[data-testid*="description" i]', '[class*="description"]', '.description'],
    },
    {
      source: 'bamboohr',
      host: /\.bamboohr\.com$/,
      title: ['[class*="jobTitle"]', 'h1', 'h2'],
      description: ['[class*="jobDescription"]', '.BambooRich', '[class*="description"]'],
    },
    {
      source: 'breezy',
      host: /\.breezy\.hr$/,
      title: ['.position-header h1', '.position h1', 'h1'],
      description: ['.description', '[class*="description"]'],
      location: ['.position-header .location', '.location'],
    },
    {
      source: 'jazzhr',
      host: /\.applytojob\.com$/,
      title: ['#job-title', '.job-header h1', 'h1'],
      description: ['#job-description', '.job-description', '[class*="description"]'],
    },
    {
      source: 'personio',
      host: /\.jobs\.personio\.(?:de|com)$/,
      title: ['h1'],
      description: ['[class*="job-description"]', '.job-description', '[class*="description"]'],
    },
    {
      source: 'rippling',
      host: /^ats\.rippling\.com$/,
      title: ['h1'],
      description: ['[class*="description"]', 'main'],
    },
    {
      source: 'wellfound',
      host: /(?:^|\.)wellfound\.com$/,
      title: ['h1'],
      description: ['[class*="description"]', '[class*="job-listing"]'],
    },
    {
      source: 'taleo',
      host: /\.taleo\.net$/,
      title: ['.titlepage', '[id*="reqTitle"]', 'h1'],
      description: ['.jobdescription', '[id*="requisitionDescription"]', '[id*="Description"]'],
    },
    {
      source: 'successfactors',
      host: /successfactors\.(?:com|eu)$/,
      title: ['[data-careersite-propertyid="title"]', '#job-title', 'h1'],
      description: ['[data-careersite-propertyid="description"]', '.jobdescription', '.job'],
      location: ['[data-careersite-propertyid="city"]', '[data-careersite-propertyid="location"]'],
    },
  ].map((site) => ({ ...site, extract: siteExtractor(site.source, site) }));

  function siteFor(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return SITES.find((site) => site.host.test(host)) || null;
  }

  window.__jobSiteExtractorFor = (hostname) => siteFor(hostname)?.extract || null;
  window.__jobSiteSourceFor = (hostname) => siteFor(hostname)?.source || '';
  window.__companyFromJobSiteUrl = companyFromJobSiteUrl;
  window.__isJobPlatformName = isJobPlatformName;
})();
