// Where Apply starts for a job link. Ashby, Greenhouse, and Lever have known form addresses; every
// other site opens at the job page, where Apply finds the button that starts the application. Sites
// that need a candidate account and login are skipped with a reason, so the Manager applies by hand.

(function initApplyRecipes(global) {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const ACCOUNT_SITES = /(^|\.)(myworkdayjobs\.com|myworkdaysite\.com|oraclecloud\.com|taleo\.net|successfactors\.(com|eu)|icims\.com)$/i;

  /**
   * { site, formUrl } for a known form, { site: 'other', formUrl, findStart: true } for a job page
   * whose Apply button must be found, or { site, unsupported: reason } for one Apply does not handle.
   */
  function recipeFor(jobUrl) {
    let url;
    try {
      url = new URL(jobUrl);
    } catch {
      return { site: 'unknown', unsupported: 'The job link is not a valid address.' };
    }
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');

    if (host === 'jobs.ashbyhq.com') {
      const match = path.match(new RegExp(`^(/[^/]+/${UUID})(/application)?$`, 'i'));
      if (match) return { site: 'ashby', formUrl: `${url.origin}${match[1]}/application` };
    }
    if (/^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(host) && /\/jobs\/\d+$/.test(path)) {
      // Greenhouse shows the form under the job description on the same page.
      return { site: 'greenhouse', formUrl: `${url.origin}${path}` };
    }
    if (/^jobs(\.eu)?\.lever\.co$/.test(host)) {
      const match = path.match(new RegExp(`^(/[^/]+/${UUID})(/apply)?$`, 'i'));
      if (match) return { site: 'lever', formUrl: `${url.origin}${match[1]}/apply` };
    }
    // A company page that embeds Greenhouse names the job in gh_jid; Greenhouse opens its form from that.
    const greenhouseJob = url.searchParams.get('gh_jid');
    if (greenhouseJob && /^\d+$/.test(greenhouseJob)) {
      return { site: 'greenhouse', formUrl: `https://boards.greenhouse.io/embed/job_app?token=${greenhouseJob}` };
    }
    // Oracle's candidate sites also run under company domains (explore-jobs.ciklum.com).
    if (ACCOUNT_SITES.test(host) || /\/hcmUI\/CandidateExperience\/|\/sites\/[^/]+\/job\/\d+/i.test(path)) {
      return { site: 'account', unsupported: 'This site needs a candidate account and login; Apply supports it in a later release.' };
    }
    if (!/^https?:$/.test(url.protocol)) return { site: 'unknown', unsupported: 'The job link is not a web page.' };
    return { site: 'other', formUrl: url.href, findStart: true };
  }

  const api = { recipeFor };
  global.__qtsApplyRecipes = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
