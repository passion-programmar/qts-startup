export function normalizePageExclusionUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const normalized = `${hostname}${pathname === "/" ? "" : pathname}`;
  return normalized.length <= 2048 ? normalized : null;
}
