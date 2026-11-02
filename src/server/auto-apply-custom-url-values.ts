export function normalizeAutoApplyCustomUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) return null;

  let url: URL;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
      url = new URL(input);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(input)) return null;
      url = new URL(`https://${input}`);
    }
  } catch {
    return null;
  }

  const authority = input.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0];
  if (authority.includes(":")) return null;
  if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return null;
  let hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (
    hostname.length > 253 ||
    hostname.split(".").length < 2 ||
    /^[\d.]+$/.test(hostname) ||
    !hostname.split(".").every((label) =>
      label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(label),
    )
  ) return null;
  return hostname;
}

export function matchesAutoApplyCustomUrl(jobUrl: string, urlPrefixes: readonly string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(jobUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return urlPrefixes.some((prefix) => hostname === prefix || hostname.endsWith(`.${prefix}`));
}
