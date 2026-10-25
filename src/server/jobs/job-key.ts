// Identity keys for the shared jobs model (docs/get-jd-redesign.md, section 3).
// Two pages are the same job when their job_key matches or their
// title_company_key matches. Pure functions: used by routes, the backfill
// script, and tests, so every caller computes identical keys.

type JobIdentityInput = {
  url: string;
  canonicalUrl?: string | null;
  title: string;
  company: string;
};

// Only parameters known to be tracking are removed; every other parameter may
// identify the job (for example ?id=123) and is kept.
const TRACKING_PARAMETER = /^(?:utm_.+|gclid|fbclid|msclkid|dclid|mc_cid|mc_eid|_hsenc|_hsmi|ref|refid|ref_id|referrer|source|src|trk|trkinfo|trackingid|tracking_id|lever-source|lever-via|gh_src|ccuid|eid|origin|lipi|midtoken|midsig)$/i;
const JOB_ID_PARAMETER = /^(?:id|jobid|job_id|job|jid|gh_jid|jk|vjk|currentjobid|posting_id|postingid|reqid|req_id|requisitionid|requisition_id|vacancyid|vacancy_id|position_id|positionid|opening_id|openingid)$/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function parseHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function param(url: URL, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === wanted && value.trim()) return value.trim();
  }
  return null;
}

/** Stable key from a platform's own job ID, or null when the URL has none. */
export function platformJobKey(value: string): string | null {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const host = hostOf(url);
  const path = url.pathname;

  if (hostIs(host, "linkedin.com")) {
    const id = param(url, "currentJobId") ?? /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/i.exec(path)?.[1];
    return id && /^\d+$/.test(id) ? `linkedin:${id}` : null;
  }
  if (/(?:^|\.)indeed\.[a-z.]+$/.test(host)) {
    const id = param(url, "jk") ?? param(url, "vjk");
    return id && /^[0-9a-f]{8,}$/i.test(id) ? `indeed:${id.toLowerCase()}` : null;
  }
  const greenhouseId = param(url, "gh_jid")
    ?? (hostIs(host, "greenhouse.io") ? /\/jobs\/(\d+)/.exec(path)?.[1] : undefined);
  if (greenhouseId && /^\d+$/.test(greenhouseId)) return `greenhouse:${greenhouseId}`;
  if (hostIs(host, "lever.co")) {
    const id = UUID.exec(path)?.[0];
    return id ? `lever:${id.toLowerCase()}` : null;
  }
  if (hostIs(host, "ashbyhq.com")) {
    const id = UUID.exec(path)?.[0];
    return id ? `ashby:${id.toLowerCase()}` : null;
  }
  if (hostIs(host, "smartrecruiters.com")) {
    const id = /\/(\d{6,})(?:-|$|\/)/.exec(path)?.[1];
    return id ? `smartrecruiters:${id}` : null;
  }
  if (hostIs(host, "myworkdayjobs.com") || hostIs(host, "myworkdaysite.com")) {
    const tenant = host.split(".")[0];
    const reqId = /_([A-Za-z]*-?\d[\w-]*)\/?$/.exec(path)?.[1];
    return reqId ? `workday:${tenant}:${reqId.toUpperCase()}` : null;
  }
  if (hostIs(host, "workable.com")) {
    const id = /\/j\/([0-9A-Za-z]{6,})/.exec(path)?.[1];
    return id ? `workable:${id.toUpperCase()}` : null;
  }
  return null;
}

/** Cleaned URL: https, lowercase host without www, no fragment, no trailing slash, no tracking parameters. */
export function normalizeJobKeyUrl(value: string): string | null {
  const url = parseHttpUrl(value);
  if (!url) return null;
  const kept = [...url.searchParams]
    .filter(([key]) => !TRACKING_PARAMETER.test(key))
    .sort(([left], [right]) => left.localeCompare(right));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `https://${hostOf(url)}${url.port ? `:${url.port}` : ""}${path}${query}`;
}

/** True when the URL points at one job rather than a careers or search page. */
export function isJobSpecificUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  if (platformJobKey(value)) return true;
  if ([...url.searchParams.keys()].some((key) => JOB_ID_PARAMETER.test(key))) return true;
  return url.pathname
    .split("/")
    .filter(Boolean)
    .some((segment) => UUID.test(segment) || /\d{3,}/.test(segment));
}

const REMOTE_TAG = /\s*[([]\s*(?:remote|hybrid|on-?site)\b[^)\]]*[)\]]\s*|\s+[-–—|,]\s*(?:remote|hybrid|on-?site)\b.*$/gi;
const LEGAL_SUFFIX = /\s+(?:inc|incorporated|llc|l\s?l\s?c|ltd|limited|gmbh|corp|corporation|co|company|plc|ag|sa|s\s?a|bv|b\s?v|oy|ab|sp\s?z\s?o\s?o|pty|srl|s\s?r\s?l)$/i;

function normalizeKeyText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalized "title|company"; a match means the same job. Empty when either part is missing. */
export function computeTitleCompanyKey(title: string, company: string): string {
  const normalizedTitle = normalizeKeyText(String(title || "").replace(REMOTE_TAG, " "));
  let normalizedCompany = normalizeKeyText(String(company || ""));
  // Repeat so "Acme Co Ltd" loses both suffixes.
  for (let previous = ""; previous !== normalizedCompany;) {
    previous = normalizedCompany;
    normalizedCompany = normalizedCompany.replace(LEGAL_SUFFIX, "").trim();
  }
  if (!normalizedTitle || !normalizedCompany) return "";
  return `${normalizedTitle}|${normalizedCompany}`;
}

/**
 * Same-job key from the page URL: the platform job ID when found, otherwise the
 * cleaned URL. A job-specific canonical URL is preferred over the page URL, and
 * a URL with nothing job-specific in it gets the title + company appended so
 * different jobs on one generic careers page never share a key.
 */
export function computeJobKey(input: JobIdentityInput): string | null {
  const canonical = input.canonicalUrl && isJobSpecificUrl(input.canonicalUrl) ? input.canonicalUrl : null;
  for (const candidate of [canonical, input.url]) {
    if (!candidate) continue;
    const platformKey = platformJobKey(candidate);
    if (platformKey) return platformKey;
  }
  const source = canonical ?? input.url;
  const normalized = normalizeJobKeyUrl(source);
  if (!normalized) return null;
  if (isJobSpecificUrl(source)) return normalized;
  const titleCompanyKey = computeTitleCompanyKey(input.title, input.company);
  return titleCompanyKey ? `${normalized}#tc:${titleCompanyKey}` : normalized;
}
