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
  return /^(0[1-9]|1[0-2])\/(?!0000)\d{4}$/.test(value);
}

export function profileMonthOrdinal(value: string): number | null {
  const match = /^(0[1-9]|1[0-2])\/(?!0000)(\d{4})$/.exec(value);
  if (!match) return null;
  return Number(match[2]) * 12 + Number(match[1]);
}

export function formatProfileMonth(value: string | null): string {
  const match = /^(?!0000)(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value ?? "");
  return match ? `${match[2]}/${match[1]}` : "";
}

export function sortProfileHistoryNewestFirst<T extends Record<string, string>>(
  rows: T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftCurrent = left.row.isCurrent === "true";
      const rightCurrent = right.row.isCurrent === "true";
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;

      const leftDate = profileMonthOrdinal(left.row.endDate || left.row.startDate) ?? -1;
      const rightDate = profileMonthOrdinal(right.row.endDate || right.row.startDate) ?? -1;
      if (leftDate !== rightDate) return rightDate - leftDate;

      const leftStart = profileMonthOrdinal(left.row.startDate) ?? -1;
      const rightStart = profileMonthOrdinal(right.row.startDate) ?? -1;
      if (leftStart !== rightStart) return rightStart - leftStart;
      return left.index - right.index;
    })
    .map(({ row }) => row);
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
  let inParentheses = false;
  let digitsInParentheses = 0;
  for (const character of value) {
    if (character === "(") {
      if (inParentheses) return false;
      inParentheses = true;
      digitsInParentheses = 0;
    } else if (character === ")") {
      if (!inParentheses || digitsInParentheses === 0) return false;
      inParentheses = false;
    } else if (inParentheses && /\d/.test(character)) {
      digitsInParentheses += 1;
    }
  }
  return digits.length >= 7 && digits.length <= 15 && !inParentheses;
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
