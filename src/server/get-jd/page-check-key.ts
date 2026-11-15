// The key of Get JD's "being checked" mark (get-jd-page-checks.ts). Pure, so it is testable.

import { createHash } from "node:crypto";
import { normalizeJobKeyUrl, platformJobKey } from "@/server/jobs/job-key";

/**
 * One key per job link: no fragment, tracking parameters, trailing slash, or host case.
 * With sent (the title, company and JD the Manager checked), one key per link and job text, so
 * an edited job is checked again instead of getting the earlier answer back.
 */
export function pageCheckKey(pageUrl: string, sent?: readonly string[]): string {
  let key: string;
  try {
    key = (platformJobKey(pageUrl) || normalizeJobKeyUrl(pageUrl) || pageUrl).slice(0, 2000);
  } catch {
    key = pageUrl.slice(0, 2000);
  }
  if (!sent) return key;
  return `${key}#${createHash("sha256").update(JSON.stringify(sent)).digest("hex").slice(0, 32)}`;
}
