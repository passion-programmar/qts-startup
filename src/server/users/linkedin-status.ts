// The candidate's LinkedIn account as their Manager marks it (2026-11-27). A signal only: nothing in
// Get JD, Generation or Apply reads it, except that the extension's Custom Easy Apply offers only
// the accounts marked "applying". "none" (2026-11-28): the candidate has no LinkedIn account yet.

export const LINKEDIN_STATUSES = ["none", "live", "applying", "blocked"] as const;
export type LinkedInStatus = (typeof LINKEDIN_STATUSES)[number];

export const LINKEDIN_STATUS_LABELS: Record<LinkedInStatus, string> = {
  none: "None",
  live: "Live",
  applying: "Applying",
  blocked: "Blocked",
};

export function isLinkedInStatus(value: unknown): value is LinkedInStatus {
  return typeof value === "string" && (LINKEDIN_STATUSES as readonly string[]).includes(value);
}

/** An unknown value (an older row) reads as "live", the default. */
export function linkedInStatusOf(value: unknown): LinkedInStatus {
  return isLinkedInStatus(value) ? value : "live";
}
