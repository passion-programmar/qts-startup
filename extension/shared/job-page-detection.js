// Decides whether a loaded page is a single job posting, from a snapshot the
// service worker collects in the page (see collectJobPageSnapshotInPage).
// Tuned not to miss real jobs: the Manager's two-keyword rule always passes,
// and other job signals can pass a page that has no keywords at all.

(function initJobPageDetection(global) {
  if (global.__qtsJobPageDetection) return;

  const PASS_SCORE = 3;
  const KEYWORD_RULE_MATCHES = 2;
  const MAX_KEYWORD_POINTS = 3;
  const SIGNAL_POINTS = 2;
  const JOB_LIST_PENALTY = 3;
  const JOB_LIST_MIN_LINKS = 8;

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
  function evaluateJobPage(snapshot, keywordRules, countKeywordMatches) {
    const text = String(snapshot?.text || '');
    // A closed notice counts only when shown; pages can carry hidden ones for every state.
    const shownText = String(snapshot?.visibleText ?? text);
    const keywordMatches = countKeywordMatches(text, keywordRules);
    const url = parseUrl(snapshot?.url);
    const headingMatches = Number(snapshot?.headingMatches || 0);
    const onJobSite = hasJobSiteUrl(url);
    const applySignal = Boolean(snapshot?.hasApplyControl || snapshot?.hasCvUpload);
    const hasDescription = Boolean(snapshot?.hasJobPostingData) || headingMatches >= DESCRIPTION_HEADINGS;
    const looksLikeJob = onJobSite || applySignal || Boolean(snapshot?.hasJobBoardFrame)
      || Boolean(snapshot?.hasJobPostingData) || keywordMatches > 0 || headingMatches > 0;
    const showsSelectedJob = Boolean(snapshot?.hasJobDetailPane) || SELECTED_JOB.test(url ? `${url.pathname}${url.search}` : '');
    const result = (isJobPage, reason, score) => ({ isJobPage, reason, score, keywordMatches, listPage: showsSelectedJob });

    if (!hasDescription && looksLikeJob && CLOSED_PATTERNS.some((pattern) => pattern.test(shownText))) {
      return result(false, 'closed', 0);
    }
    if (!hasDescription && snapshot?.blocked) return result(false, 'not-loaded', 0);
    if (snapshot?.hasJobPostingData) return result(true, 'structured-data', PASS_SCORE);
    if (keywordMatches >= KEYWORD_RULE_MATCHES) return result(true, 'keywords', keywordMatches);

    const looksLikeJobList = !showsSelectedJob && Number(snapshot?.jobLinkCount || 0) >= JOB_LIST_MIN_LINKS;
    let score = Math.min(keywordMatches, MAX_KEYWORD_POINTS);
    if (onJobSite) score += SIGNAL_POINTS;
    if (applySignal) score += SIGNAL_POINTS;
    if (snapshot?.hasJobBoardFrame) score += SIGNAL_POINTS;
    if (headingMatches >= 2) score += SIGNAL_POINTS;
    if (looksLikeJobList) score -= JOB_LIST_PENALTY;

    if (score >= PASS_SCORE) return result(true, 'score', score);
    // One strong job signal short of passing: worth the Manager's look, unless it is a list of jobs.
    const uncertain = !looksLikeJobList && (onJobSite || applySignal || Boolean(snapshot?.hasJobBoardFrame));
    return result(false, uncertain ? 'uncertain' : 'not-job', score);
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
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsJobPageDetection;
  }
})(typeof self !== 'undefined' ? self : globalThis);
