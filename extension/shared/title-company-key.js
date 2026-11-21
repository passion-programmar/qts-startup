// The same "title|company" key as the server's computeTitleCompanyKey (src/server/jobs/job-key.ts),
// so a LinkedIn card matches the skip-list, the Manager's bids and saved jobs alike. Keep the two in
// step: src/server/linkedin-skips/title-company-key-parity.test.ts runs both on the same names.
(function initTitleCompanyKey(global) {
  const REMOTE_TAG = /\s*[([]\s*(?:remote|hybrid|on-?site)\b[^)\]]*[)\]]\s*|\s+[-–—|,]\s*(?:remote|hybrid|on-?site)\b.*$/gi;
  const LEGAL_SUFFIX = /\s+(?:inc|incorporated|llc|l\s?l\s?c|ltd|limited|gmbh|corp|corporation|co|company|plc|ag|sa|s\s?a|bv|b\s?v|oy|ab|sp\s?z\s?o\s?o|pty|srl|s\s?r\s?l)$/i;

  function normalizeKeyText(value) {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function normalizeCompanyName(company) {
    let normalized = normalizeKeyText(String(company || ''));
    for (let previous = ''; previous !== normalized;) {
      previous = normalized;
      normalized = normalized.replace(LEGAL_SUFFIX, '').trim();
    }
    return normalized;
  }

  /** Normalized "title|company"; empty when either part is missing. */
  function computeTitleCompanyKey(title, company) {
    const normalizedTitle = normalizeKeyText(String(title || '').replace(REMOTE_TAG, ' '));
    const normalizedCompany = normalizeCompanyName(company);
    if (!normalizedTitle || !normalizedCompany) return '';
    return `${normalizedTitle}|${normalizedCompany}`;
  }

  const api = Object.freeze({ computeTitleCompanyKey, normalizeCompanyName });
  global.__qtsTitleCompanyKey = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
