// Decides whether a loaded page is a single job posting, from a snapshot the
// service worker collects in the page (see collectJobPageSnapshotInPage).
// Detection vocabulary is versioned with the extension. No Manager keyword downloads.

(function initJobPageDetection(global) {
  if (global.__qtsJobPageDetection) return;

  const PASS_SCORE = 3;
  const MAX_KEYWORD_POINTS = 3;
  const SIGNAL_POINTS = 2;
  const JOB_LIST_PENALTY = 3;
  const JOB_LIST_MIN_LINKS = 8;
  // Shipped with the extension. These are independent evidence groups, not a keyword quota.
  const KEYWORDS = Object.freeze({
    responsibilities: ['responsibilities', 'key responsibilities', 'your responsibilities', "what you'll do", 'what you will do', 'your mission', 'key duties', 'your duties', 'day to day', 'what you will work on', 'your impact', 'what you will build'],
    requirements: ['requirements', 'job requirements', 'what you bring', "what you'll need", "what we're looking for", 'must have', 'what we expect', 'essential skills', 'required skills', 'who you are', 'your background', 'what makes you a fit'],
    qualifications: ['qualifications', 'minimum qualifications', 'basic qualifications', 'required qualifications', 'preferred qualifications', 'experience required', 'relevant experience', 'professional experience', 'nice to have', 'ideal candidate'],
    role: ['job description', 'about the role', 'about this role', 'the opportunity', 'position overview', 'your role', 'role overview', 'about the position', 'about the job', 'we are hiring', 'join our team', 'we are looking for', 'we seek', 'the position'],
    application: ['apply now', 'apply for this job', 'apply for this position', 'apply to this role', 'submit application', "i'm interested", 'start application', 'apply here', 'send your cv', 'send your resume', 'submit your resume', 'application deadline'],
    employment: ['full-time', 'full time', 'part-time', 'part time', 'contract', 'permanent', 'remote', 'hybrid', 'on-site', 'onsite', 'employment type', 'work arrangement', 'salary range', 'compensation', 'working hours', 'benefits'],
    identifiers: ['job id', 'requisition id', 'vacancy id', 'position id', 'reference number', 'job reference', 'posting date', 'date posted'],
    unavailable: ['job expired', 'position closed', 'position filled', 'no longer accepting applications', 'job no longer available', 'this job has expired', 'vacancy closed', 'this position has been filled'],
  });
  const normalizeText = (text) => String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim();
  function keywordGroups(text) {
    const normalized = ` ${normalizeText(text)} `;
    return Object.fromEntries(Object.entries(KEYWORDS).map(([group, phrases]) => [group,
      phrases.some((phrase) => normalized.includes(` ${normalizeText(phrase)} `))]));
  }

  function normalizeIdentityUrl(value) {
    try {
      const url = new URL(value);
      url.hash = '';
      for (const name of [...url.searchParams.keys()]) {
        if (/^(utm_.+|gclid|fbclid|msclkid|ref|refid|ref_id|source|src|trk|trackingid|gh_src|lever-source)$/i.test(name)) url.searchParams.delete(name);
      }
      url.searchParams.sort();
      return url.toString().replace(/\/+(\?|$)/, '$1');
    } catch { return value; }
  }

  // Lightweight metadata/content sampling only. Full JD extraction is a separate, later stage.
  function inspectJobPage() {
    const root = ['.jobs-search__job-details', '.jobsearch-JobComponent', '[data-testid="jobsearch-ViewjobPaneWrapper"]', 'main', '[role="main"]', 'article']
      .map((selector) => document.querySelector(selector)).find(Boolean) || document.body;
    const heading = String(root?.querySelector('h1, [role="heading"][aria-level="1"]')?.textContent || document.querySelector('h1')?.textContent || '').trim();
    const records = [];
    const add = (value) => {
      if (Array.isArray(value)) return value.forEach(add);
      if (!value || typeof value !== 'object') return;
      if ([].concat(value['@type'] || []).some((type) => /JobPosting$/i.test(type))) records.push(value);
      if (value['@graph']) add(value['@graph']);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { add(JSON.parse(script.textContent)); } catch { /* malformed metadata is not evidence */ }
    }
    const textOf = (value) => normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const posting = records.find((job) => textOf(job.title) && textOf(job.title) === textOf(heading))
      || records.find((job) => job.url && normalizeIdentityUrl(job.url) === normalizeIdentityUrl(location.href))
      || (records.length === 1 ? records[0] : null);
    const sample = String(root?.innerText || root?.textContent || '').slice(0, 16000);
    let title = String(posting?.title || heading).trim();
    const companyElement = document.querySelector('[data-testid="company-name"], [data-company-name], .company-name, .jobs-unified-top-card__company-name, .jobsearch-InlineCompanyRating-companyHeader');
    const company = String(posting?.hiringOrganization?.name || companyElement?.textContent
      || /\bat\s+(.+?)(?:\s*[|–—]\s*.*)?$/i.exec(document.title)?.[1] || '').trim();
    const controls = [...(root || document).querySelectorAll('a, button, [role="button"], input[type="submit"]')];
    const hasApplyControl = controls.some((el) => /^(apply(?: now| here| for .+)?|submit application|i['’]m interested|start application)$/i.test(String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
    const jobLinkCount = new Set([...(root || document).querySelectorAll('a[href]')].map((a) => a.href).filter((url) => /\/(jobs?|careers?|positions?|vacancies)\/[^/?#]+|[?&](jobid|currentjobid|jk)=/i.test(url))).size;
    const selected = Boolean(document.querySelector('.jobs-search__job-details, .jobsearch-JobComponent, [data-testid="jobsearch-ViewjobPaneWrapper"]'));
    const specificUrl = /[?&](?:gh_jid|job_?id|currentJobId|jk|vjk|requisitionId)=|\/(?:jobs?|positions?|vacancies|careers)\/[^/?#]+|\/[0-9a-f-]{32,}(?:[/?#]|$)/i.test(location.href);
    const currentPosting = posting && (selected || textOf(posting.title) === textOf(heading)
      || (records.length === 1 && specificUrl)
      || (records.length === 1 && !heading && normalizeText(sample).includes(normalizeText(posting.title)))
      || (posting.url && normalizeIdentityUrl(posting.url) === normalizeIdentityUrl(location.href)));
    if (!currentPosting) title = heading;
    return { url: location.href, text: sample, visibleText: sample, title, company,
      identity: { jobUrl: location.href, jobTitle: title, company, platformJobId: String(posting?.identifier?.value || posting?.identifier || '') },
      hasJobPostingData: Boolean(currentPosting && posting.title && (posting.description || hasApplyControl)),
      postingExpired: Boolean(currentPosting && posting.validThrough && Number.isFinite(Date.parse(posting.validThrough)) && Date.parse(posting.validThrough) < Date.now()),
      structuredCount: records.length, hasApplyControl, jobLinkCount, hasJobDetailPane: selected, specificUrl,
      articlePage: document.querySelector('meta[property="og:type"]')?.content === 'article' || /\/(blog|news|articles|guides)\//i.test(location.pathname),
      headingMatches: [...(root || document).querySelectorAll('h2, h3, h4')].filter((el) => /responsibilit|requirement|qualification|about the role|what you/i.test(el.textContent)).length,
      blocked: /just a moment|verify you are human|checking your browser/i.test(document.title + ' ' + sample.slice(0, 500)),
      hasJobBoardFrame: [...document.querySelectorAll('iframe[src]')].some((el) => /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com/i.test(el.src)),
    };
  }

  const CLOSED_PATTERNS = [
    /\bno longer accepting applications\b/i,
    /\bthis (?:job|position|posting|vacancy|role) (?:has expired|is no longer (?:available|open|active)|has been (?:filled|closed))\b/i,
    /\b(?:position|role|vacancy) has been filled\b/i,
    /\bjob (?:posting )?(?:has )?expired\b/i,
    /\bapplications? (?:are |is )?(?:now )?closed\b/i,
    /\b(?:job|position|posting|vacancy) (?:you requested )?(?:was )?not found\b/i,
    /\b(?:job|position|posting|vacancy|role|opening|offer)\b[^.!?\n]{0,40}\bno longer (?:available|open|active)\b/i,
    /\b(?:couldn['’]t|could not|can['’]t|cannot) find (?:this|that|the) (?:job|position|posting|vacancy|page)\b/i,
    /\bpage (?:was )?not found\b|\bseite nicht (?:finden|gefunden)\b/i,
  ];
  // A closed notice rejects the page only when the page looks like a job and has no description.
  const DESCRIPTION_HEADINGS = 2;

  // Apply-form pages whose job description lives at a known address on the same site.
  const APPLY_PAGES = [
    // Lever: /company/id/apply → /company/id
    { host: /(?:^|\.)lever\.co$/i, path: /^(\/[^/]+\/[0-9a-f-]{36})\/apply\/?$/i },
    // Workable: /company/j/CODE/apply/ → /company/j/CODE/
    { host: /^apply\.workable\.com$/i, path: /^(\/[^/]+\/j\/[0-9A-F]+)\/apply\/?$/i },
    // PeopleForce: /careers/v/id-title/a/new → /careers/v/id-title
    { host: /\.peopleforce\.io$/i, path: /^(\/careers\/v\/[^/]+)\/a\/new\/?$/i },
  ];

  const JOB_SITE_HOST = /(?:^|\.)(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|ashbyhq\.com|smartrecruiters\.com|icims\.com|jobvite\.com|teamtailor\.com|recruitee\.com|bamboohr\.com|breezy\.hr|applytojob\.com|jazzhr\.com|personio\.(?:de|com)|rippling\.com|wellfound\.com|workable\.com|taleo\.net|successfactors\.(?:com|eu)|oraclecloud\.com|justjoin\.it)$/i;
  const JOB_PATH = /\/(?:jobs?|careers?|positions?|vacanc(?:y|ies)|openings?|opportunit(?:y|ies)|postings?|viewjob)(?:\/[^/?#]+|\/?(?=[?#]|$))/i;
  const JOB_QUERY = /[?&](?:gh_jid|jk|vjk|currentJobId|jobId|job_id|jobid|posting_id|reqId|requisitionId)=/i;
  // Search pages that also show one selected job (LinkedIn currentJobId, Indeed vjk, LinkedIn job view).
  const SELECTED_JOB = /[?&](?:currentJobId|vjk|jk)=|\/jobs\/view\/\d+/i;

  function parseUrl(value) {
    try {
      return new URL(String(value || ''));
    } catch {
      return null;
    }
  }

  function hasJobSiteUrl(url) {
    if (!url) return false;
    return JOB_SITE_HOST.test(url.hostname)
      || JOB_PATH.test(url.pathname)
      || JOB_QUERY.test(url.search);
  }

  // Reasons: structured-data, keywords, or score (a job page); closed (a job page that is closed or
  // removed); not-loaded (a browser check or sign-in page); uncertain (job signals, but too few); not-job.
  // listPage marks a search page showing one selected job, which must stay open.
  function evaluateJobPage(snapshot) {
    const text = String(snapshot?.text || '');
    // A closed notice counts only when shown; pages can carry hidden ones for every state.
    const shownText = String(snapshot?.visibleText ?? text);
    const groups = keywordGroups(text.replace(/[.,:;!?]/g, ' '));
    const keywordMatches = Object.values(groups).filter(Boolean).length;
    const url = parseUrl(snapshot?.url);
    const headingMatches = Number(snapshot?.headingMatches || 0);
    const onJobSite = hasJobSiteUrl(url);
    const applySignal = Boolean(snapshot?.hasApplyControl || snapshot?.hasCvUpload);
    const hasDescription = Boolean(snapshot?.hasJobPostingData) || headingMatches >= DESCRIPTION_HEADINGS;
    const looksLikeJob = onJobSite || applySignal || Boolean(snapshot?.hasJobBoardFrame)
      || Boolean(snapshot?.hasJobPostingData) || keywordMatches > 0 || headingMatches > 0;
    const showsSelectedJob = Boolean(snapshot?.hasJobDetailPane) || SELECTED_JOB.test(url ? `${url.pathname}${url.search}` : '');
    const result = (isJobPage, reason, score) => ({ isJobPage, reason, score, keywordMatches, listPage: showsSelectedJob });

    if (snapshot?.postingExpired || (looksLikeJob && CLOSED_PATTERNS.some((pattern) => pattern.test(shownText)))) {
      return result(false, 'closed', 0);
    }
    if (!hasDescription && snapshot?.blocked) return result(false, 'not-loaded', 0);
    if (snapshot?.hasJobPostingData) return result(true, 'structured-data', PASS_SCORE);
    if (snapshot?.articlePage && !applySignal && !snapshot?.specificUrl) return result(false, 'not-job', 0);
    if ((snapshot?.structuredCount > 1 || Number(snapshot?.jobLinkCount) >= JOB_LIST_MIN_LINKS) && !showsSelectedJob && !snapshot?.specificUrl) return result(false, 'not-job', 0);
    const title = String(snapshot?.title || '').trim();
    const meaningfulTitle = title && !/^(jobs?|careers?|vacancies|search results|opportunities|welcome|loading[.…]*|redirecting[.…]*|please wait|just a moment)$/i.test(title)
      && !/^(how to |career advice|tips for |a guide to )/i.test(title);
    if (title && !meaningfulTitle && !showsSelectedJob && !(snapshot?.hasJobBoardFrame && snapshot?.specificUrl)) return result(false, 'not-job', 0);
    if (meaningfulTitle && (groups.responsibilities || groups.requirements || groups.qualifications || groups.role)) return result(true, 'content', keywordMatches);
    if (meaningfulTitle && (applySignal || snapshot?.specificUrl) && (groups.employment || groups.identifiers)) return result(true, 'content', keywordMatches);
    if (meaningfulTitle && /\b(?:you will|you'll|we seek|we need|join us|your work|successful candidate)\b/i.test(text)) return result(true, 'content', keywordMatches);

    const looksLikeJobList = !showsSelectedJob && Number(snapshot?.jobLinkCount || 0) >= JOB_LIST_MIN_LINKS;
    let score = Math.min(keywordMatches, MAX_KEYWORD_POINTS);
    if (onJobSite) score += SIGNAL_POINTS;
    if (applySignal) score += SIGNAL_POINTS;
    if (snapshot?.hasJobBoardFrame) score += SIGNAL_POINTS;
    if (headingMatches >= 2) score += SIGNAL_POINTS;
    if (looksLikeJobList) score -= JOB_LIST_PENALTY;

    if (score >= PASS_SCORE) return result(true, 'score', score);
    // One strong job signal short of passing: worth the Manager's look, unless it is a list of jobs.
    const uncertain = !looksLikeJobList && (snapshot?.specificUrl || Boolean(snapshot?.hasJobBoardFrame)) && (meaningfulTitle || groups.role || applySignal);
    return result(uncertain, uncertain ? 'plausible' : 'not-job', score);
  }

  // The job description page for an apply-form page, or '' when the page is not one.
  function descriptionUrlForApplyPage(value) {
    const url = parseUrl(value);
    if (!url) return '';
    for (const page of APPLY_PAGES) {
      const match = page.host.test(url.hostname) && url.pathname.match(page.path);
      if (match) return `${url.origin}${match[1]}`;
    }
    return '';
  }

  global.__qtsJobPageDetection = Object.freeze({
    PASS_SCORE,
    evaluateJobPage,
    descriptionUrlForApplyPage,
    hasJobSiteUrl: (value) => hasJobSiteUrl(parseUrl(value)),
    KEYWORDS, keywordGroups, inspectJobPage, normalizeIdentityUrl,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsJobPageDetection;
  }
})(typeof self !== 'undefined' ? self : globalThis);
