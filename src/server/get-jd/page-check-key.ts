// The key of Get JD's "being checked" mark (get-jd-page-checks.ts). Pure, so it is testable.

const TRACKING_PARAMETER = /^(utm_[a-z]+|gh_src|src|source|ref|referralcode|trid|lever-source|lever-origin|igbtracker|gclid|gbraid)$/i;

/** One key per job link: no fragment, tracking parameters, trailing slash, or host case. */
export function pageCheckKey(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(name)) url.searchParams.delete(name);
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+(\?|$)/, "$1").slice(0, 2000);
  } catch {
    return pageUrl.slice(0, 2000);
  }
}
