// Values and rules shared by the Apply and Chrome-registry routes. Pure, so they are testable
// without a database.

/** Applications in progress at once per Manager, across all Chromes (the 2-minute email wait included). */
export const APPLY_PARALLEL_LIMIT = 3;
/** A claim lives this long without a heartbeat; Chromes renew it every 30 seconds. */
export const APPLY_LEASE_SECONDS = 120;
/** After Submit, the lease covers the 2-minute confirmation wait plus reporting. */
export const APPLY_SUBMIT_LEASE_SECONDS = 300;
/** Generation and Apply work goes only to this extension version or newer. */
export const MIN_WORK_EXTENSION_VERSION = "1.33.0";

/** -1, 0, or 1 for dotted numeric versions; null when either is not one. */
export function compareExtensionVersions(left: string, right: string): number | null {
  const parse = (value: string) => (/^\d+(\.\d+){0,3}$/.test(value) ? value.split(".").map(Number) : null);
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether a Chrome may take Generation or Apply work. */
export function canTakeWork(extensionVersion: string | null): boolean {
  if (!extensionVersion) return false;
  const comparison = compareExtensionVersions(extensionVersion, MIN_WORK_EXTENSION_VERSION);
  return comparison !== null && comparison >= 0;
}

export type BrowserHeaders = { browserKey: string; extensionVersion: string | null; browserName: string | null };

/** The Chrome identity the extension sends with each request, or null when it sends none. */
export function parseBrowserHeaders(headers: Headers): BrowserHeaders | null {
  const browserKey = headers.get("x-qts-browser-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(browserKey)) return null;
  const version = headers.get("x-qts-extension-version")?.trim() ?? "";
  // The extension sends the name URI-encoded, since header values cannot carry every character.
  let name = headers.get("x-qts-browser-name") ?? "";
  try {
    name = decodeURIComponent(name);
  } catch {
    name = "";
  }
  name = name.replace(/\s+/g, " ").trim();
  return {
    browserKey,
    extensionVersion: /^\d+(\.\d+){0,3}$/.test(version) ? version : null,
    browserName: name ? name.slice(0, 60) : null,
  };
}

/** The automatic name of a Chrome: a short, readable form of its key. */
export function defaultBrowserName(browserKey: string): string {
  return `Chrome · ${browserKey.slice(0, 4).toUpperCase()}`;
}

/** The same question on different forms ("Why Exadel? *", "why exadel") shares one saved answer. */
export function normalizeQuestionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\(\s*(optional|required)\s*\)/g, " ")
    .replace(/[*:?!.,;"'()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export type ApplyResult = "confirmed" | "not_confirmed" | "failed";
export type ConfirmationSource = "page" | "email";

export type ApplyResultReport = {
  result: ApplyResult;
  reason: string | null;
  confirmationSource: ConfirmationSource | null;
  screenshotBrowserName: string | null;
  evidence: Record<string, unknown> | null;
};

const MAX_EVIDENCE_BYTES = 100_000;

/** A Chrome's result report, checked; a string is the reason it is refused. */
export function parseApplyResultReport(body: unknown): ApplyResultReport | string {
  if (!body || typeof body !== "object") return "The result report is missing.";
  const value = body as Record<string, unknown>;
  const result = value.result;
  if (result !== "confirmed" && result !== "not_confirmed" && result !== "failed") {
    return "The result must be confirmed, not_confirmed, or failed.";
  }
  const source = value.confirmationSource ?? null;
  if (source !== null && source !== "page" && source !== "email") return "The confirmation source is invalid.";
  if (result === "confirmed" && source === null) return "A confirmed result needs its source (page or email).";
  const reason = typeof value.reason === "string" ? value.reason.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  if (result !== "confirmed" && !reason) return "A not-confirmed or failed result needs a short reason.";
  const screenshot = typeof value.screenshotBrowserName === "string"
    ? value.screenshotBrowserName.replace(/\s+/g, " ").trim().slice(0, 60)
    : "";
  const evidence = value.evidence ?? null;
  if (evidence !== null && (typeof evidence !== "object" || Array.isArray(evidence))) return "The evidence is invalid.";
  if (evidence && JSON.stringify(evidence).length > MAX_EVIDENCE_BYTES) return "The evidence is too large.";
  return {
    result,
    reason: reason || null,
    confirmationSource: source,
    screenshotBrowserName: screenshot || null,
    evidence: evidence as Record<string, unknown> | null,
  };
}
