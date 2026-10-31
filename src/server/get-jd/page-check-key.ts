// The key of Get JD's "being checked" mark (get-jd-page-checks.ts). Pure, so it is testable.

import { normalizeJobKeyUrl, platformJobKey } from "@/server/jobs/job-key";

/** One key per job link: no fragment, tracking parameters, trailing slash, or host case. */
export function pageCheckKey(pageUrl: string): string {
  try {
    return (platformJobKey(pageUrl) || normalizeJobKeyUrl(pageUrl) || pageUrl).slice(0, 2000);
  } catch {
    return pageUrl.slice(0, 2000);
  }
}
