// Auto Apply with APIs: keeping candidates apart on job sites. A Chrome has one login and one set of
// stored data per site, so what one candidate left there must never reach another's application.
// This file only decides (tested in Node); the worker reads the page and clears the site
// (background/auto-apply-api.js).
//
//   sites this Chrome used     origin -> the candidate it was last used for
//   what the page shows        who is signed in: nobody, this candidate, someone else, or unknown
//   holds                      two candidates never work on one site at the same time in one Chrome
(function initSiteSessions(global) {
  const STORAGE_KEY = 'qtsSiteSessions';
  const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
  const MAX_SITES = 2000;
  // Sites people use for everything else (their mail, their own LinkedIn, QTS's AI): nobody is ever
  // signed out of these by QTS. When such a site shows another account, the Manager deals with it.
  const SHARED_SITES = new Set([
    'google.com', 'gmail.com', 'youtube.com', 'linkedin.com', 'indeed.com', 'glassdoor.com', 'facebook.com',
    'microsoft.com', 'live.com', 'outlook.com', 'office.com', 'apple.com', 'icloud.com', 'github.com',
    'openai.com', 'chatgpt.com', 'yahoo.com', 'vercel.app',
  ]);
  // Country endings of two parts (acme.co.uk): the site is the three parts.
  const TWO_PART_ENDING = /^(?:co|com|org|net|gov|ac|edu|ne|or|go)\.[a-z]{2}$/;

  function parsed(url) {
    try {
      const value = new URL(url);
      return /^https?:$/.test(value.protocol) ? value : null;
    } catch {
      return null;
    }
  }
  const originOf = (url) => parsed(url)?.origin || '';
  const hostOf = (url) => parsed(url)?.hostname.toLowerCase() || '';

  /** The site a host belongs to; a login cookie can be shared across its addresses. */
  function siteOf(host) {
    const name = String(host || '').toLowerCase();
    if (!name || /^[\d.]+$/.test(name) || name.includes(':')) return name;
    const labels = name.split('.');
    if (labels.length <= 2) return name;
    return labels.slice(TWO_PART_ENDING.test(labels.slice(-2).join('.')) ? -3 : -2).join('.');
  }

  /**
   * What this Chrome knows about a site, before the page is even opened. standing: 'none' (never used
   * here by QTS), 'same' (last used for this candidate), 'other' (origins to clear), or 'shared'.
   */
  function siteStanding(ledger, url, candidateId) {
    const origin = originOf(url);
    if (!origin) return { standing: 'none', site: '', origins: [] };
    const site = siteOf(hostOf(url));
    if (SHARED_SITES.has(site)) return { standing: 'shared', site, origins: [] };
    const related = Object.entries(ledger || {}).filter(([key]) => siteOf(hostOf(key)) === site);
    const other = related.some(([, entry]) => entry.candidateId !== candidateId);
    return {
      standing: other ? 'other' : related.length ? 'same' : 'none',
      site,
      origins: other ? [...new Set([origin, ...related.map(([key]) => key)])] : [],
    };
  }

  /** The record with this site marked as this candidate's; old entries go. Never stores anything else. */
  function rememberSite(ledger, url, candidateId, now) {
    const origin = originOf(url);
    const next = { ...(ledger || {}) };
    if (!origin || !candidateId) return next;
    next[origin] = { candidateId, at: now };
    const kept = Object.entries(next).filter(([, entry]) => now - entry.at <= KEEP_MS).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_SITES);
    return Object.fromEntries(kept);
  }

  function forgetSites(ledger, origins) {
    const next = { ...(ledger || {}) };
    for (const origin of origins || []) delete next[origin];
    return next;
  }

  const email = (value) => String(value || '').trim().toLowerCase();
  const words = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  /**
   * Who a page says is signed in (account: __qtsApplyForm.siteAccount()). standing: 'none', 'same',
   * 'other' (shown: the address it names), or 'unknown' (signed in, but not whose account it is).
   */
  function accountStanding(account, candidate) {
    if (!account?.signedIn) return { standing: 'none' };
    const own = email(candidate?.email);
    // What the site shows about the account comes first; an email already in its form is the next sign.
    const shown = [...new Set((account.emails || []).map(email).filter(Boolean))];
    if (shown.length) return own && shown.includes(own) ? { standing: 'same' } : { standing: 'other', shown: shown[0] };
    const inForm = email(account.formEmail);
    if (inForm) return inForm === own ? { standing: 'same' } : { standing: 'other', shown: inForm };
    const text = ` ${words(account.text)} `;
    const first = words(candidate?.firstName);
    const last = words(candidate?.lastName);
    if (first && last && text.includes(` ${first} `) && text.includes(` ${last} `)) return { standing: 'same' };
    return { standing: 'unknown' };
  }

  const squash = (value) => words(value).replace(/\s+/g, '');

  /** Generation names each PDF after the candidate: false when a path names someone else. */
  function documentsBelong(paths, candidate) {
    const name = squash([candidate?.firstName, candidate?.lastName].filter(Boolean).join(' '));
    if (!name) return true;
    return (paths || []).every((path) => squash(String(path || '').split('/').pop()).includes(name));
  }

  /**
   * Which candidate is working on each site in this Chrome. A run holds one site at a time, so two
   * runs waiting for each other's site cannot both wait forever.
   */
  function createSiteHolds() {
    const holds = new Map();
    const release = (attemptId, except = null) => {
      for (const [site, hold] of holds) {
        if (site === except) continue;
        hold.attempts.delete(attemptId);
        if (!hold.attempts.size) holds.delete(site);
      }
    };
    return {
      /** True when this run now holds the site; false while another candidate's run does. */
      tryHold(site, attemptId, candidateId) {
        release(attemptId, site);
        const hold = holds.get(site);
        if (hold && hold.candidateId !== candidateId) return false;
        if (hold) hold.attempts.add(attemptId);
        else holds.set(site, { candidateId, attempts: new Set([attemptId]) });
        return true;
      },
      release: (attemptId) => release(attemptId),
      holder: (site) => holds.get(site)?.candidateId ?? null,
    };
  }

  const api = { STORAGE_KEY, SHARED_SITES, originOf, hostOf, siteOf, siteStanding, rememberSite, forgetSites, accountStanding, documentsBelong, createSiteHolds };
  global.__qtsSiteSessions = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
