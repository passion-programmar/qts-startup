// Where each job site keeps its application form, and which sites Apply supports in this release
// (Ashby, Greenhouse, and Lever). Other sites are skipped with a reason, so the Manager applies by hand.

(function initApplyRecipes(global) {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const ACCOUNT_SITES = /(^|\.)(myworkdayjobs\.com|myworkdaysite\.com|oraclecloud\.com|taleo\.net|successfactors\.(com|eu)|icims\.com)$/i;

  /**
   * { site, formUrl } for a supported job link, or { site, unsupported: reason } for one Apply
   * does not handle yet.
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
    if (ACCOUNT_SITES.test(host)) {
      return { site: 'account', unsupported: 'This site needs a candidate account and login; Apply supports it in a later release.' };
    }
    return { site: 'other', unsupported: 'Apply does not support this job site yet; apply by hand.' };
  }

  const api = { recipeFor };
  global.__qtsApplyRecipes = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
