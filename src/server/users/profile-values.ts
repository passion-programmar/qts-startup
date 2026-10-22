export function isValidBirthday(value: string, today = new Date()): boolean {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    && value <= today.toISOString().slice(0, 10);
}

export function isValidProfileMonth(value: string): boolean {
  return /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidProfileEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const atIndex = value.indexOf("@");
  if (atIndex < 1 || atIndex !== value.lastIndexOf("@")) return false;

  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  if (
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    domain.length > 253
  ) {
    return false;
  }

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label)
  );
}

export function isValidProfilePhone(value: string): boolean {
  if (!/^\+?[0-9][0-9().\s-]*[0-9]$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  const parenthesesAreBalanced =
    (value.match(/\(/g)?.length ?? 0) === (value.match(/\)/g)?.length ?? 0);
  return digits.length >= 7 && digits.length <= 15 &&
    parenthesesAreBalanced && !/\(\s*\)/.test(value);
}

export function normalizeLinkedInProfile(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "";

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    hostname !== "linkedin.com" ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }

  const match = /^\/in\/([^/]+)\/?$/i.exec(url.pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (slug.length > 100 || !/^[\p{L}\p{N}_-]+$/u.test(slug)) return null;
  return `linkedin.com/in/${slug}`;
}
