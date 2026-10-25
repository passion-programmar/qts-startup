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

  function evaluateJobPage(snapshot, keywordRules, countKeywordMatches) {
    const text = String(snapshot?.text || '');
    if (CLOSED_PATTERNS.some((pattern) => pattern.test(text))) {
      return { isJobPage: false, reason: 'closed', score: 0, keywordMatches: 0 };
    }
    const keywordMatches = countKeywordMatches(text, keywordRules);
    if (snapshot?.hasJobPostingData) {
      return { isJobPage: true, reason: 'structured-data', score: PASS_SCORE, keywordMatches };
    }
    if (keywordMatches >= KEYWORD_RULE_MATCHES) {
      return { isJobPage: true, reason: 'keywords', score: keywordMatches, keywordMatches };
    }

    const url = parseUrl(snapshot?.url);
    const showsSelectedJob = Boolean(snapshot?.hasJobDetailPane) || SELECTED_JOB.test(url ? `${url.pathname}${url.search}` : '');
    const looksLikeJobList = !showsSelectedJob && Number(snapshot?.jobLinkCount || 0) >= JOB_LIST_MIN_LINKS;
    let score = Math.min(keywordMatches, MAX_KEYWORD_POINTS);
    if (hasJobSiteUrl(url)) score += SIGNAL_POINTS;
    if (snapshot?.hasApplyControl || snapshot?.hasCvUpload) score += SIGNAL_POINTS;
    if (snapshot?.hasJobBoardFrame) score += SIGNAL_POINTS;
    if (Number(snapshot?.headingMatches || 0) >= 2) score += SIGNAL_POINTS;
    if (looksLikeJobList) score -= JOB_LIST_PENALTY;

    const isJobPage = score >= PASS_SCORE;
    return { isJobPage, reason: isJobPage ? 'score' : 'not-job', score, keywordMatches };
  }

  global.__qtsJobPageDetection = Object.freeze({
    PASS_SCORE,
    evaluateJobPage,
    hasJobSiteUrl: (value) => hasJobSiteUrl(parseUrl(value)),
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.__qtsJobPageDetection;
  }
})(typeof self !== 'undefined' ? self : globalThis);
