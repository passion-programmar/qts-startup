// Auto Apply with APIs (Super Admin's per-Manager switch): the same claims, panel and checklist as
// Auto Apply, in its own order, so a Manager without the switch is not touched by any of this.
//
//   clear a site last used for another candidate -> open -> whoever is signed in must be this candidate
//   -> preserve profile sections -> upload -> replace ordinary answers from the profile -> check
//   -> the Manager reviews; Ask AI (their click only) answers the boxes still empty -> Manager submits
//
// The AI is never asked by itself. Loaded by the service worker after apply-runner.js,
// whose helpers it uses (inForm, fillAndCheck, readComboboxOptions, ...).

const siteHolds = self.__qtsSiteSessions.createSiteHolds();
let siteLedgerWrites = Promise.resolve();

async function readSiteLedger() {
  const key = self.__qtsSiteSessions.STORAGE_KEY;
  return (await chrome.storage.local.get(key))[key] || {};
}

// One change at a time, so two applications never overwrite each other's note.
function changeSiteLedger(change) {
  const key = self.__qtsSiteSessions.STORAGE_KEY;
  const write = siteLedgerWrites.then(async () => {
    await chrome.storage.local.set({ [key]: change(await readSiteLedger()) });
  });
  siteLedgerWrites = write.catch((error) => console.error('Could not save which candidate used a site.', error));
  return write;
}

const candidateNameOf = (application) => [application.candidate?.firstName, application.candidate?.lastName].filter(Boolean).join(' ') || 'this candidate';

/** Two candidates never work on one site at the same time in this Chrome: the later one waits. */
async function holdSite(site, application, { stop, onWaiting }) {
  let told = false;
  for (;;) {
    if (siteHolds.tryHold(site, application.attemptId, application.candidate?.candidateId)) return;
    if (stop && await stop()) throw new ApplyStop('Stopped.', { skip: false, keepTab: false });
    if (!told) {
      told = true;
      await onWaiting?.(site);
    }
    await sleep(1500);
  }
}

/** Signs a site out and removes what it stored here, for these addresses only. */
async function clearSiteData(origins) {
  const removal = chrome.browsingData.remove({ origins }, {
    cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true,
  });
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Chrome did not finish in time')), 20000); });
  try {
    await Promise.race([removal, limit]);
  } catch (error) {
    throw new ApplyStop(`QTS could not sign this site out of the previous candidate (${error?.message || 'unknown reason'}). Clear it yourself, then try again.`, { skip: false });
  } finally {
    clearTimeout(timer);
  }
  await changeSiteLedger((ledger) => self.__qtsSiteSessions.forgetSites(ledger, origins));
  diag('site-cleared', { origins: origins.length });
}

/**
 * Before a page is opened or used: this run holds the site, and a site last used for another
 * candidate is cleared. { standing, site, cleared }.
 */
async function prepareSite(url, application, options) {
  const sessions = self.__qtsSiteSessions;
  if (!sessions.originOf(url)) return { standing: 'none', site: '', cleared: false };
  // (One candidate at a time per site, Workday per company; a platform nobody signs in to, none: 2026-11-26.)
  const key = sessions.holdKeyOf(url);
  if (key) await holdSite(key, application, options);
  const known = sessions.siteStanding(await readSiteLedger(), url, application.candidate?.candidateId);
  if (known.standing !== 'other') return { ...known, cleared: false };
  await clearSiteData(known.origins);
  return { ...known, cleared: true };
}

/** The page again with nothing of the site's left: its per-tab data goes too. */
async function reloadCleared(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: () => { try { sessionStorage.clear(); } catch { /* A site may forbid it. */ } } }).catch(() => {});
  await chrome.tabs.reload(tabId, { bypassCache: true });
  await sleep(300);
  await waitForTabComplete(tabId, 45 * 1000);
}

/**
 * Whoever the open page says is signed in, against this candidate. { ok: true }; { reloaded: true }
 * after clearing someone else's session; or { message, notice, site, confirmable } for the Manager.
 */
async function checkSiteAccount(tabId, application, options) {
  const sessions = self.__qtsSiteSessions;
  const url = (await getTab(tabId))?.url || '';
  if (!sessions.originOf(url)) return { ok: true };
  const prepared = await prepareSite(url, application, options);
  if (prepared.cleared) {
    await reloadCleared(tabId);
    return { reloaded: true, site: prepared.site };
  }
  const account = await inForm(tabId, () => globalThis.__qtsApplyForm.siteAccount()).catch(() => null);
  const seen = sessions.accountStanding(account, application.candidate);
  const { site } = prepared;
  const candidateId = application.candidate?.candidateId;
  const who = candidateNameOf(application);
  // Mail, LinkedIn and the like: who is signed in matters only when the application form is there.
  if (prepared.standing === 'shared' && ['other', 'unknown'].includes(seen.standing)) {
    const page = await inForm(tabId, () => globalThis.__qtsApplyForm.classifyPage()).catch(() => null);
    if (!['application_form', 'partial_application_form'].includes(page?.type)) return { ok: true, site };
  }
  if (seen.standing === 'none' || seen.standing === 'same' || (seen.standing === 'unknown' && application.verifiedSites.has(site))) {
    if (prepared.standing !== 'shared') await changeSiteLedger((ledger) => sessions.rememberSite(ledger, url, candidateId, Date.now()));
    return { ok: true, site };
  }
  if (seen.standing === 'other') {
    // Cleared once at most: a site that signs itself back in is the Manager's to sort out.
    if (prepared.standing !== 'shared' && !application.clearedSites.has(site)) {
      application.clearedSites.add(site);
      await clearSiteData([sessions.originOf(url)]);
      await reloadCleared(tabId);
      return { reloaded: true, site };
    }
    return {
      site,
      message: `This site is signed in as ${seen.shown}, not ${who}. Sign out here and sign in with ${who}'s account, or as a guest, then choose Continue.`,
      notice: 'Another account is signed in on this site.',
    };
  }
  return {
    site,
    confirmable: true,
    message: `This site is signed in to an account QTS cannot identify. Choose Continue only if it is ${who}'s${application.candidate?.email ? ` (${application.candidate.email})` : ''}; otherwise sign out first.`,
    notice: 'Check which account is signed in here.',
  };
}

/** The job board's own application reached: the job is given back with the reason. */
function hostedApplyStop(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { host = 'the job board'; }
  return new ApplyStop(`This job is only open through the job board's own application (${host}). QTS does not use those: apply on the company's site if it has one.`, { skip: false, keepTab: false, pageType: 'job_board_hosted' });
}

/** Why the way to the form ran out, with what was tried and what the page offered. */
async function describeNoRoute(tabId, clicked, trail, lead = 'No way to the application form was found') {
  const seen = await inForm(tabId, () => globalThis.__qtsApplyForm.applyControlsSeen()).catch(() => []);
  const url = (await getTab(tabId))?.url || trail.at(-1) || '';
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  const boardOnly = (seen || []).some((text) => /easy apply/i.test(text)) || /(^|\.)(indeed|ziprecruiter|glassdoor|monster|simplyhired)\.[a-z.]+$/i.test(host);
  const parts = [
    `${boardOnly ? 'This job board only offers its own application here, which QTS does not use' : lead}.`,
    `Ended at ${url.slice(0, 150)}.`,
    clicked.length ? `Clicked: ${clicked.map((text) => `"${text}"`).join(', ')}.` : 'Nothing to click was recognised.',
    seen?.length ? `Controls on the page: ${seen.map((text) => `"${text}"`).join(', ')}.` : 'The page shows no application controls.',
    ...(trail.length > 1 ? [`Pages visited: ${trail.length}.`] : []),
  ];
  diag('navigation', { clicked, pages: trail.length, seen });
  return parts.join(' ').slice(0, 470);
}

/** Normal Apply by a Manager with the switch: the site is remembered as this candidate's. */
async function noteSiteUsed(tabId, application) {
  const sessions = self.__qtsSiteSessions;
  const url = (await getTab(tabId))?.url || '';
  if (!sessions.originOf(url) || !application.candidate?.candidateId) return;
  if (sessions.siteStanding({}, url, '').standing === 'shared') return;
  await changeSiteLedger((ledger) => sessions.rememberSite(ledger, url, application.candidate.candidateId, Date.now()));
}

function answerContext(application) {
  return {
    exchangeRates: application.exchangeRates,
    today: new Date(),
    coverLetterText: application.job.coverLetterText,
    experiences: application.profileDetails?.experiences || [],
    educations: application.profileDetails?.educations || [],
    jobCompany: application.job.company || '',
    jobLocation: application.job.location || '',
    siteKey: application.siteKey || '',
  };
}

/**
 * What stops the site's Submit about this candidate on this page: another account signed in, a
 * personal answer that is not the profile's, a document that is not theirs, something left from
 * before that could not be removed. A check that cannot run counts against the page.
 */
async function candidateHolds(tabId, application) {
  const sessions = self.__qtsSiteSessions;
  const helpers = self.__qtsApplyAnswers;
  const holds = [];
  const who = candidateNameOf(application);
  try {
    const url = (await getTab(tabId))?.url || '';
    const account = await inForm(tabId, () => globalThis.__qtsApplyForm.siteAccount());
    // By now the form's email box holds QTS's own answer: only what the site shows counts.
    const seen = sessions.accountStanding({ ...account, formEmail: '' }, application.candidate);
    const site = sessions.siteOf(sessions.hostOf(url));
    if (seen.standing === 'other') holds.push(`This site is signed in as ${seen.shown}, not ${who}. Sign in with ${who}'s account, then Check.`);
    if (seen.standing === 'unknown' && !application.verifiedSites.has(site)) holds.push(`This site is signed in to an account QTS cannot identify. Make sure it is ${who}'s, then Check.`);

    const shown = await inForm(tabId, () => globalThis.__qtsApplyForm.answersForCheck());
    for (const wrong of helpers.personalMismatches(shown, application.candidate, application.savedAnswers, answerContext(application))) {
      holds.push(`"${wrong.label}" shows "${wrong.shown.slice(0, 60)}", but ${who}'s profile says "${wrong.profile.slice(0, 60)}". Correct it, then Check.`);
    }

    const documents = application.applyDocuments;
    const own = [documents?.resume?.filename, documents?.coverLetter?.filename].filter(Boolean);
    // (After a restart QTS no longer has the names; a file it could not remove is still checked.)
    const checksUploads = own.length || [...application.stuckBoxes.values()].some((box) => box.upload);
    const foreign = checksUploads ? await inForm(tabId, (allowed) => globalThis.__qtsApplyForm.foreignUploads(allowed), [own]) : [];
    for (const entry of foreign || []) holds.push(`"${entry.label}" holds "${entry.name}", which is not ${who}'s document. Remove it, then Check.`);

    for (const [key, box] of application.stuckBoxes) {
      if (box.upload) {
        const stillShown = await inForm(tabId, (name) => String(document.body?.innerText || '').includes(name), [box.label]).catch(() => true);
        if (box.id != null || !stillShown) application.stuckBoxes.delete(key);
        else holds.push(`"${box.label}" is still attached from before and QTS could not remove it. Remove it, then Check.`);
        continue;
      }
      const field = shown.find((entry) => entry.id === box.id);
      if (!field || !field.answered || field.managerChanged) application.stuckBoxes.delete(key);
      else holds.push(`"${box.label}" still holds a value from before that QTS could not remove or replace. Correct it, then Check.`);
    }
  } catch {
    return [`QTS could not check this page against ${who}. Check it yourself, then click Check.`];
  }
  return [...new Set(holds)];
}

/** Whether the page shows a question QTS has not met yet (the Manager's answer may have revealed one). */
async function hasNewQuestions(tabId, application) {
  const look = await inForm(tabId, (given) => globalThis.__qtsApplyForm.emptyOldAnswers(given), [{ known: [...application.cleanedBoxes], seedOnly: true }]).catch(() => null);
  return Boolean(look?.keys?.some((key) => !application.cleanedBoxes.has(key)));
}

/** Whether the AI's reply had anything in it at all. */
const aiSaidNothing = (replied, reviewed) => !Object.keys(replied || {}).length && !reviewed.length;

/** A yes/no box takes true or false, however the AI worded it. */
function forField(field, answer) {
  if (field.kind !== 'checkbox' || typeof answer.value === 'boolean') return answer;
  return { ...answer, value: /^\s*(yes|true|checked|ticked|agree|accept|i agree)/i.test(String(answer.value)) };
}

async function fillApiFormPage(tabId, application, keepAlive, step, options = {}) {
  const attempts = [];
  stepAttemptsByTab.set(tabId, attempts);
  try {
    return await fillApiFormPageBody(tabId, application, keepAlive, step, options, attempts);
  } finally {
    stepAttemptsByTab.delete(tabId);
  }
}

// ---- Choices from the job site's own public data (2026-11-25) ----
// Greenhouse publishes each job's questions with their choices (its Job Board API, "?questions=true":
// custom, location, EEO and demographic questions), so its lists, which build their choices only when
// opened, need not be opened just to read them. Used only where the question on the page and in the
// data have the same words (two sources agree); the page still decides: a choice its list does not show
// is never picked (the pick reads the list itself). Read once per job; nothing is sent to Greenhouse.
const siteChoicesCache = new Map();
const choiceKey = (text) => String(text || '').toLowerCase().replace(/\(\s*(required|optional)\s*\)/g, ' ')
  .replace(/[*✱]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function greenhouseJobOf(url) {
  let page;
  try { page = new URL(url); } catch { return null; }
  const host = page.hostname.toLowerCase();
  if (!/(^|\.)greenhouse\.io$/.test(host)) return null;
  const eu = /(^|\.)eu\.greenhouse\.io$/.test(host);
  const parts = page.pathname.split('/').filter(Boolean);
  // job-boards.greenhouse.io/{board}/jobs/{id} (also boards.greenhouse.io and the EU boards)
  if (parts[1] === 'jobs' && /^\d+$/.test(parts[2] || '')) return { board: parts[0], id: parts[2], eu };
  // boards.greenhouse.io/embed/job_app?for={board}&token={id} (the form a company site embeds)
  const board = page.searchParams.get('for');
  const token = page.searchParams.get('token');
  if (parts[0] === 'embed' && board && /^\d+$/.test(token || '')) return { board, id: token, eu };
  return null;
}

/** The page's Greenhouse questions with their choices: Map(question words → choices), or null. */
async function greenhouseChoices(url) {
  const job = greenhouseJobOf(url);
  if (!job || !/^[\w-]{1,100}$/.test(job.board)) return null;
  const key = `${job.board}/${job.id}`;
  if (siteChoicesCache.has(key)) return siteChoicesCache.get(key);
  let data = null;
  for (const host of job.eu ? ['boards-api.eu.greenhouse.io', 'boards-api.greenhouse.io'] : ['boards-api.greenhouse.io']) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`https://${host}/v1/boards/${encodeURIComponent(job.board)}/jobs/${job.id}?questions=true`, { signal: controller.signal, credentials: 'omit' });
      if (response.ok) data = await response.json();
    } catch { /* No data: the lists are read on the page, as before. */ } finally { clearTimeout(timer); }
    if (data) break;
  }
  const choices = new Map();
  // Every question in the data, wherever it sits (questions, location_questions, compliance,
  // demographic_questions): its words, and the labels of its choices.
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    if (typeof node.label === 'string') {
      const listed = [
        ...(Array.isArray(node.fields) ? node.fields.flatMap((entry) => (Array.isArray(entry?.values) ? entry.values : [])) : []),
        ...(Array.isArray(node.answer_options) ? node.answer_options : []),
        ...(Array.isArray(node.values) ? node.values : []),
      ].map((entry) => String(entry?.label ?? '').trim()).filter(Boolean);
      const words = choiceKey(node.label);
      if (words && listed.length && !choices.has(words)) choices.set(words, [...new Set(listed)].slice(0, 300));
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value, depth + 1);
  };
  walk(data);
  const result = choices.size ? choices : null;
  siteChoicesCache.set(key, result);
  if (siteChoicesCache.size > 50) siteChoicesCache.delete(siteChoicesCache.keys().next().value);
  return result;
}

/** Lists on this page with no choices read yet take them from the site's own data, where it has them. */
async function addSiteChoices(tabId, fields) {
  const lists = fields.filter((field) => ['combobox', 'select', 'menu', 'radio'].includes(field.kind) && !field.options?.length);
  if (!lists.length) return 0;
  const url = (await chrome.tabs.get(tabId).catch(() => null))?.url || '';
  const known = await greenhouseChoices(url).catch(() => null);
  if (!known) return 0;
  let added = 0;
  for (const field of lists) {
    const found = known.get(choiceKey(field.label));
    if (!found?.length) continue;
    field.options = found;
    field.optionsFrom = 'site data';
    added += 1;
  }
  if (added) diag('site-choices', { site: 'greenhouse', lists: added });
  return added;
}

// ---- Experience and Education: checked against the profile, corrected, completed (2026-11-26) ----
// A site's résumé reading often gets these wrong (a cut company name, another job's title, swapped
// dates, merged bullets), and some sites read nothing. Each entry on the page is matched to the
// profile's job or school; a box that says something else gets the profile's value; a job or school
// the page lacks is added with the section's own Add (an empty entry already there is used first).
// Nothing is ever deleted (entries matching nothing in the profile are listed for the Manager), the
// Manager's own edits are never changed, and Skills are not touched.
// How long adding a section's missing entries may take, each section on its own (2026-11-26: 90 s for
// both ran out on Workday after five jobs, and Education was never added).
const ENTRY_TIME_LIMIT = { experience: 150000, education: 90000 };
const ENTRY_GENERIC_WORDS = new Set(['ltd', 'limited', 'inc', 'llc', 'gmbh', 'srl', 'sa', 'plc', 'corp', 'corporation', 'co', 'company', 'ag', 'bv', 'sas', 'sarl', 'spa', 'oy', 'ab', 'as', 'the']);
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const entryWords = (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
const entrySquash = (text) => entryWords(text).join('');

/** { y, m } from a profile date "2021-08-01"; null without one. */
function profileMonth(iso) {
  const match = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  return match ? { y: Number(match[1]), m: Number(match[2]) } : null;
}
/** Every { y, m } a shown date may mean ("08/2021", "2021-08", "Aug 2021", "01/08/2021"; m null: year only). */
function shownMonths(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return [];
  const found = [];
  let match = /(\d{4})[-/.](\d{1,2})/.exec(value);
  if (match) found.push({ y: Number(match[1]), m: Number(match[2]) });
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value);
  if (match) {
    const y = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    found.push({ y, m: Number(match[2]) }, { y, m: Number(match[1]) });
  } else {
    match = /^(\d{1,2})[-/.](\d{4}|\d{2})$/.exec(value);
    if (match) found.push({ y: Number(match[2].length === 2 ? `20${match[2]}` : match[2]), m: Number(match[1]) });
  }
  const name = MONTH_NAMES.findIndex((month) => new RegExp(`\\b${month.slice(0, 3)}`).test(value));
  const year = /\b(19|20)\d{2}\b/.exec(value)?.[0];
  if (name >= 0 && year) found.push({ y: Number(year), m: name + 1 });
  if (!found.length && /^(19|20)\d{2}$/.test(value)) found.push({ y: Number(value), m: null });
  return found;
}
const sameMonth = (shown, want) => shownMonths(shown).some((date) => date.y === want.y && (date.m === null || date.m === want.m));

/** Whether a box's text already says the profile's value (a role's own tolerance). */
function entrySays(role, shown, want) {
  if (!want) return true;
  const [now, wanted] = [entrySquash(shown), entrySquash(want)];
  if (!now) return false;
  if (now === wanted) return true;
  const core = (text) => entryWords(text).filter((word) => !ENTRY_GENERIC_WORDS.has(word)).join('');
  if (role === 'company') return core(shown) === core(want);
  if (role === 'location') return now.includes(entrySquash(String(want).split(',')[0]));
  if (role === 'school') {
    const [a, b] = [new Set(entryWords(shown)), entryWords(want)];
    return b.length > 0 && b.filter((word) => a.has(word)).length / b.length >= 0.75;
  }
  if (role === 'degree') {
    const level = (text) => /bachelor|\bbs\b|\bba\b|\bbsc\b|licen/i.test(text) ? 'bachelor' : /master|\bms\b|\bmsc\b|\bma\b|\bmba\b/i.test(text) ? 'master'
      : /ph\.?d|doctor/i.test(text) ? 'doctor' : /associate/i.test(text) ? 'associate' : /high school|secondary/i.test(text) ? 'school' : '';
    return Boolean(level(shown)) && level(shown) === level(want);
  }
  if (role === 'description') {
    const first = entrySquash(String(want).split('\n')[0]).slice(0, 40);
    return Boolean(first) && now.includes(first);
  }
  return false;
}

/** How well a page entry fits a profile job or school (0: not at all). */
function entryFit(kind, entry, item) {
  if (kind === 'experience') {
    let score = 0;
    const company = entry.company?.value || '';
    if (company && entrySays('company', company, item.companyName)) score += 3;
    else if (company && entrySquash(company).includes(entrySquash(item.companyName).slice(0, 6))) score += 2;
    const title = new Set(entryWords(entry.title?.value));
    const want = entryWords(item.jobTitle);
    if (want.length) score += 2 * (want.filter((word) => title.has(word)).length / want.length);
    const start = profileMonth(item.startDate);
    const startShown = entry.start?.whole?.value || entry.start?.year?.value || '';
    if (start && startShown && shownMonths(startShown).some((date) => date.y === start.y)) score += 1;
    return score;
  }
  let score = 0;
  if (entry.school?.value && entrySays('school', entry.school.value, item.institution)) score += 3;
  // (An entry that is only a Degree box, YLD's Greenhouse: its degree alone makes it the same school.)
  if (entry.degree?.value && entrySays('degree', entry.degree.value, item.degree)) score += entry.school ? 1 : 2;
  if (entry.field?.value && entrySquash(entry.field.value).includes(entrySquash(item.fieldOfStudy).slice(0, 8))) score += 1;
  return score;
}

/** A date for one box, in the box's own form: a list's month / year, a browser date box, or its pattern. */
function entryDateValue(box, date, half) {
  const mm = String(date.m).padStart(2, '0');
  if (half === 'year') return String(date.y);
  if (half === 'month') {
    const named = (box.options || []).find((option) => String(option).trim().toLowerCase().startsWith(MONTH_NAMES[date.m - 1].slice(0, 3)));
    const numbered = (box.options || []).find((option) => Number(String(option).trim()) === date.m);
    return named || numbered || mm;
  }
  if (box.nativeType === 'month') return `${date.y}-${mm}`;
  if (box.kind === 'date') return `${date.y}-${mm}-01`;
  const pattern = String(box.placeholder || '').trim().toLowerCase();
  if (/^m{1,2}[\s/.-]y{4}$/.test(pattern)) return `${mm}${pattern.match(/[\s/.-]/)[0]}${date.y}`;
  if (/^m{1,2}[\s/.-]y{2}$/.test(pattern)) return `${mm}${pattern.match(/[\s/.-]/)[0]}${String(date.y).slice(2)}`;
  if (/^y{4}[\s/.-]m{1,2}$/.test(pattern)) return `${date.y}${pattern.match(/[\s/.-]/)[0]}${mm}`;
  if (/^d{1,2}[\s/.-]m{1,2}[\s/.-]y{4}$/.test(pattern)) { const s = pattern.match(/[\s/.-]/)[0]; return `01${s}${mm}${s}${date.y}`; }
  if (/^m{1,2}[\s/.-]d{1,2}[\s/.-]y{4}$/.test(pattern)) { const s = pattern.match(/[\s/.-]/)[0]; return `${mm}${s}01${s}${date.y}`; }
  if (/^y{4}[\s/.-]m{1,2}[\s/.-]d{1,2}$/.test(pattern)) { const s = pattern.match(/[\s/.-]/)[0]; return `${date.y}${s}${mm}${s}01`; }
  return `${mm}/${date.y}`;
}

/** A list's choice for a school or degree: the same one, else "Other" (then the name is typed). */
function entryChoice(role, box, want) {
  const options = (box.options || []).map((option) => String(option));
  if (!options.length) return { value: want };
  const exact = options.find((option) => entrySquash(option) === entrySquash(want)) || options.find((option) => entrySays(role, option, want));
  if (exact) return { value: exact };
  const other = role === 'school' || role === 'field' ? options.find((option) => /^other\b/i.test(option.trim())) : null;
  return other ? { value: other, other: true } : { value: null };
}

async function checkProfileEntries(tabId, application, { seen, problem, say, notes, managerEditBaseline, throwIfStopped }) {
  const owned = new Set();
  const read = () => inForm(tabId, () => globalThis.__qtsApplyForm.profileEntries()).catch(() => null);
  let layout = await read();
  if (!layout || (!layout.experience?.found && !layout.education?.found)) return owned;
  const details = application.profileDetails || {};
  const byNewest = (items) => [...items].sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  const profile = { experience: byNewest(details.experiences || []), education: byNewest(details.educations || []) };
  const started = Date.now();
  const ownAll = (entry) => {
    for (const part of Object.values(entry || {})) for (const box of [part, part?.whole, part?.month, part?.year]) if (box?.id) owned.add(box.id);
  };
  const fill = async (box, value) => {
    if (!box?.id || value === null || value === undefined) return false;
    const field = { id: box.id, label: box.label, kind: box.kind, required: box.required, options: box.options || [], ...(box.placeholder ? { placeholder: box.placeholder } : {}), ...(box.nativeType ? { nativeType: box.nativeType } : {}), managerEditBaseline, entryBox: true };
    const outcome = await fillAndCheck(tabId, field, { value, source: 'profile' }, null, seen).catch(() => ({ ok: false }));
    return Boolean(outcome.ok || outcome.preserved);
  };
  const label = (kind) => (kind === 'experience' ? 'Experience' : 'Education');
  const name = (kind, item) => (kind === 'experience' ? `${item.jobTitle} · ${item.companyName}` : `${item.degree || ''} ${item.fieldOfStudy || ''} · ${item.institution}`.trim());

  /** The profile's values written into one entry where it says otherwise. Returns what changed. */
  const correct = async (kind, entry, item, number) => {
    const changed = [];
    const set = async (role, box, want, shownAs = want) => {
      if (!box || want === null || want === undefined || want === '') return;
      if (box.kind === 'checkbox' ? box.value === want : entrySays(role, box.value, shownAs)) return;
      if (await fill(box, want)) changed.push(`${role} "${String(box.value || (box.kind === 'checkbox' ? 'no' : '—')).slice(0, 40)}" → "${String(typeof want === 'boolean' ? (want ? 'ticked' : 'not ticked') : want).slice(0, 40)}"`);
      else problem(`${label(kind)} ${number}: set ${role} to "${String(want).slice(0, 60)}" yourself.`, { id: box.id });
    };
    const setDate = async (role, part, iso) => {
      const date = profileMonth(iso);
      if (!part || !date) return;
      if (part.whole) {
        if (sameMonth(part.whole.value, date)) return;
        // A date in parts (Workday's Month and Year boxes): typed part by part with real key presses.
        if (part.whole.dateParts?.length) {
          const typed = await fillDateParts(tabId, { ...part.whole, managerEditBaseline }, { y: date.y, m: date.m, d: 1 })
            .catch((error) => ({ ok: false, error: error?.message || String(error) }));
          if (typed.ok) changed.push(`${role} "${part.whole.value || '—'}" → "${typed.value || `${String(date.m).padStart(2, '0')}/${date.y}`}"`);
          else if (!typed.preserved) problem(`${label(kind)} ${number}: set ${role} to ${MONTH_NAMES[date.m - 1].slice(0, 3)} ${date.y} yourself (${typed.error}).`, { id: part.whole.id });
          return;
        }
        const value = entryDateValue(part.whole, date, 'whole');
        if (await fill(part.whole, value)) changed.push(`${role} → ${MONTH_NAMES[date.m - 1].slice(0, 3)} ${date.y}`);
        else problem(`${label(kind)} ${number}: set ${role} to ${MONTH_NAMES[date.m - 1].slice(0, 3)} ${date.y} yourself.`, { id: part.whole.id });
        return;
      }
      let ok = true;
      if (part.month && !shownMonths(`${part.month.value} ${date.y}`).some((shown) => shown.m === date.m)) ok = (await fill(part.month, entryDateValue(part.month, date, 'month'))) && ok;
      if (part.year && String(part.year.value || '').trim() !== String(date.y)) ok = (await fill(part.year, entryDateValue(part.year, date, 'year'))) && ok;
      if (!ok) problem(`${label(kind)} ${number}: set ${role} to ${MONTH_NAMES[date.m - 1].slice(0, 3)} ${date.y} yourself.`, { id: (part.month || part.year).id });
    };
    if (kind === 'experience') {
      await set('title', entry.title, item.jobTitle);
      await set('company', entry.company, item.companyName);
      if (entry.location && item.location) await set('location', entry.location, item.location);
      await setDate('start date', entry.start, item.startDate);
      const current = Boolean(item.isCurrent || !item.endDate);
      if (entry.current) await set('currently work here', entry.current, current);
      if (!current) await setDate('end date', entry.end, item.endDate);
      const bullets = self.__qtsApplyAnswers.resumeBullets(application.job?.resumeText || '', item.companyName) || String(item.description || '').trim();
      if (entry.description && bullets) {
        const fitted = entry.description.maxLength ? bullets.slice(0, entry.description.maxLength) : bullets;
        await set('description', entry.description, fitted);
      }
    } else {
      const school = entry.school ? entryChoice('school', entry.school, item.institution) : null;
      if (school?.value) await set('school', entry.school, school.value, school.other ? school.value : item.institution);
      if (school?.other) {
        // "Other": the school's own name goes into the box the site shows for it.
        const again = (await read())?.education?.entries?.find((other) => other.school?.id === entry.school.id);
        const named = again && Object.values(again).find((box) => box?.id && box.kind !== 'checkbox' && /other|name|specify/i.test(box.label || '') && box.id !== entry.school.id && !box.value);
        if (named) await fill(named, item.institution);
      }
      const degree = entry.degree ? entryChoice('degree', entry.degree, item.degree) : null;
      if (degree?.value) await set('degree', entry.degree, degree.value, item.degree);
      const field = entry.field ? entryChoice('field', entry.field, item.fieldOfStudy) : null;
      if (field?.value) await set('field of study', entry.field, field.value, item.fieldOfStudy);
      await setDate('start date', entry.start, item.startDate);
      if (!item.isCurrent) await setDate('end date', entry.end, item.endDate);
    }
    return changed;
  };

  for (const kind of ['experience', 'education']) {
    await throwIfStopped();
    if (!layout?.[kind]?.found) continue;
    const items = profile[kind];
    if (!items.length) continue;
    await say(`${label(kind)}: checking the entries against the profile…`);
    let entries = layout[kind].entries || [];
    entries.forEach(ownAll);
    // 1. Each entry on the page with the profile's job or school that fits it best (each used once).
    const pairs = [];
    const free = new Set(items.map((_, index) => index));
    const scored = [];
    entries.forEach((entry, at) => items.forEach((item, index) => scored.push({ at, index, score: entryFit(kind, entry, item) })));
    for (const { at, index, score } of scored.sort((a, b) => b.score - a.score)) {
      if (score < 2 || !free.has(index) || pairs.some((pair) => pair.at === at)) continue;
      pairs.push({ at, index });
      free.delete(index);
    }
    // 2. Matched entries: corrected where they say otherwise.
    for (const { at, index } of pairs.sort((a, b) => a.at - b.at)) {
      await throwIfStopped();
      const changed = await correct(kind, entries[at], items[index], at + 1);
      if (changed.length) notes.push(`${label(kind)} ${at + 1}: ${changed.join('; ')}.`);
    }
    // 3. Empty entries already on the page take the profile's missing ones, in order.
    const isEmpty = (entry) => Object.values(entry).every((part) => {
      const boxes = [part, part?.whole, part?.month, part?.year].filter((box) => box?.id);
      return boxes.every((box) => (box.kind === 'checkbox' ? !box.value : !String(box.value || '').trim()));
    });
    const missing = [...free].sort((a, b) => a - b);
    for (const [at, entry] of entries.entries()) {
      if (!missing.length || pairs.some((pair) => pair.at === at) || !isEmpty(entry)) continue;
      const index = missing.shift();
      await correct(kind, entry, items[index], at + 1);
      notes.push(`${label(kind)} ${at + 1}: filled with ${name(kind, items[index])}.`);
    }
    // 4. Entries matching nothing in the profile: never deleted, listed for the Manager.
    for (const [at, entry] of entries.entries()) {
      if (pairs.some((pair) => pair.at === at) || isEmpty(entry)) continue;
      const said = kind === 'experience' ? `${entry.title?.value || '?'} · ${entry.company?.value || '?'}` : `${entry.school?.value || '?'}`;
      problem(`${label(kind)} ${at + 1} ("${said.slice(0, 60)}") matches nothing in the profile: check it, remove it if it is wrong.`, entry.title || entry.school || null);
    }
    // 5. Jobs or schools the page still lacks: added with the section's own Add, one at a time. The
    // entry a click opened is the one whose first box was not on the page before AND is still empty:
    // an entry already there is never taken for it (it would be written over, 2026-11-26).
    const kindStarted = Date.now();
    const anchorOf = (entry) => (entry.title || entry.school)?.id || null;
    const placed = new Set();
    const why = new Map();
    // A section whose entries have no job-title or school box (YLD's Greenhouse: "Education" = a Degree
    // list only) takes no more entries: one is enough and a new one cannot be told apart (2026-11-27).
    let canAdd = !(entries.length && entries.every((entry) => !anchorOf(entry)));
    // (No entry read, but the form already shows a lone "Degree" / "School" box: that box is the section.)
    if (canAdd && !entries.length && kind === 'education') {
      const plain = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist()
        .some((box) => !box.hidden && /^(degree|school|university|education|highest degree|level of education)\s*\*?$/i.test(String(box.label || '').trim()))).catch(() => false);
      if (plain) {
        canAdd = false;
        // That box is filled with the profile's degree as a question: nothing to add, nothing to report.
        missing.length = 0;
      }
    }
    for (const [count, index] of missing.entries()) {
      await throwIfStopped();
      if (!canAdd) continue;
      if (Date.now() - kindStarted > ENTRY_TIME_LIMIT[kind]) { why.set(index, 'QTS ran out of time on this section'); continue; }
      // Already shown on the page as text (a card the site imported, with its own Edit): never added twice.
      const shownName = kind === 'experience' ? items[index].companyName : items[index].institution;
      if (await inForm(tabId, (text) => globalThis.__qtsApplyForm.pageMentions(text), [shownName]).catch(() => false)) { placed.add(index); continue; }
      const point = await inForm(tabId, (k) => globalThis.__qtsApplyForm.entryAddPoint(k), [kind]).catch(() => null);
      if (!point) { why.set(index, 'QTS found no Add button for this section'); canAdd = false; continue; }
      const known = new Set(entries.map(anchorOf).filter(Boolean));
      await say(`${label(kind)}: adding ${count + 1} of ${missing.length}, ${name(kind, items[index])}…`);
      await realClick(tabId, point);
      let added = null;
      for (let waited = 0; waited < 8000 && !added; waited += 400) {
        await sleep(400);
        const now = await read();
        const opened = (now?.[kind]?.entries || []).find((entry) => anchorOf(entry) && !known.has(anchorOf(entry)) && isEmpty(entry));
        if (opened) {
          added = opened;
          layout = now;
          entries = now[kind].entries;
        }
      }
      // Nothing new and empty showed: no more clicks on Add (each would open one more entry); an
      // entry that opens late is filled by the sweep below.
      if (!added) { why.set(index, 'the Add button did not open a new entry'); canAdd = false; continue; }
      ownAll(added);
      const at = entries.indexOf(added) + 1;
      await correct(kind, added, items[index], at);
      placed.add(index);
      // An entry form with its own Save / Done (a small form or a pop-up): saved.
      const anchor = added.title || added.school;
      const save = anchor ? await inForm(tabId, (id) => globalThis.__qtsApplyForm.entrySavePoint(id), [anchor.id]).catch(() => null) : null;
      if (save) {
        await realClick(tabId, save);
        await sleep(800);
      }
      notes.push(`${label(kind)} ${at}: added ${name(kind, items[index])}.`);
      layout = (await read()) || layout;
      entries = layout?.[kind]?.entries || entries;
      entries.forEach(ownAll);
    }
    // 6. An empty entry still on the page (one that opened late, or one the site keeps) takes a job or
    // school still missing; one left over with required boxes (it stops the site's Continue) is named
    // for the Manager (QTS never deletes an entry).
    {
      if (missing.length) layout = (await read()) || layout;
      entries = layout?.[kind]?.entries || entries;
      entries.forEach(ownAll);
      const waiting = missing.filter((index) => !placed.has(index));
      const required = (entry) => Object.values(entry).some((part) => [part, part?.whole, part?.month, part?.year].some((box) => box?.required));
      for (const [at, entry] of entries.entries()) {
        if (!isEmpty(entry)) continue;
        const index = waiting.shift();
        if (index === undefined) {
          if (required(entry)) problem(`${label(kind)} ${at + 1} is empty: fill it, or delete it with its Delete button.`, entry.title || entry.school || null);
          continue;
        }
        await throwIfStopped();
        await correct(kind, entry, items[index], at + 1);
        notes.push(`${label(kind)} ${at + 1}: filled with ${name(kind, items[index])}.`);
      }
      for (const index of waiting) problem(`${label(kind)}: add ${name(kind, items[index])} yourself (${why.get(index) || 'QTS could not add it'}).`);
    }
  }
  diag('profile-entries', { ms: Date.now() - started, owned: owned.size });
  return owned;
}

async function fillApiFormPageBody(tabId, application, keepAlive, step, options, stepAttempts) {
  const helpers = self.__qtsApplyAnswers;
  const managerEditBaseline = await inForm(tabId, () => globalThis.__qtsApplyForm.managerEditRevision());
  // The job site this page is on (its own form of a saved answer is used first): from the page itself.
  application.siteKey = helpers.siteKeyOf?.((await chrome.tabs.get(tabId).catch(() => null))?.url) || application.siteKey || '';
  const throwIfStopped = async () => {
    if (options.stop && await options.stop()) throw new ApplyStop('Stopped.', { skip: false, keepTab: false });
  };
  const say = (text) => options.onPhase?.(text);
  const used = {};
  const problems = [];
  const unresolved = [];
  const corrections = [];
  const seen = new Set();
  const metFields = new Map();
  const timings = { clean: 0, discovery: 0, ai: 0, upload: 0, fill: 0, checks: 0 };
  const stepStarted = Date.now();
  const aiCallsBefore = application.aiCalls || 0;
  let canAskAgain = false;
  let rechecked = false;
  let emptiedCount = 0;
  // Experience / Education corrections and additions, shown on the panel.
  const entryNotes = [];
  let documents = application.applyDocuments || null;
  // keep: about the page as a whole and not something a look at the page can see again.
  const problem = (message, field = null, kind = 'field', keep = false) => {
    if (!problems.some((entry) => entry.message === message)) problems.push({ message, fieldId: field?.id ?? null, kind, ...(keep ? { keep: true } : {}) });
  };
  const leave = (field, reason) => {
    if (!unresolved.some((entry) => entry.id === field.id)) unresolved.push({ id: field.id, label: field.label, required: Boolean(field.required), ...(reason ? { reason } : {}) });
  };
  const settle = (quietMs, maxMs) => inForm(tabId, (quiet, max) => globalThis.__qtsApplyForm.settled({ quietMs: quiet, maxMs: max }), [quietMs, maxMs]).catch(() => false);

  /** The step's result, after reading the page once more when anything was done on it. */
  const finish = async ({ checks = true } = {}) => {
    const checksStarted = Date.now();
    if (checks) {
      // The step's checks, read in ONE trip into the page (they were seven): attachments, required
      // questions still empty, whether the form is still shown, questions QTS could not read, frames
      // it cannot read, and the site's own error messages. Each read fails on its own, as before.
      const seen = await inForm(tabId, async () => {
        const api = globalThis.__qtsApplyForm;
        const safe = (read, fallback) => { try { return read(); } catch { return fallback; } };
        let uploads = null;
        try {
          const verified = await api.verifyUploads();
          const missing = api.emptyRequiredUploads().filter((entry) => !verified.some((issue) => issue.id === entry.id));
          uploads = [...verified, ...missing.map((entry) => ({ ...entry, message: 'A required attachment is still missing. Check this upload manually.' }))];
        } catch { /* Reported below as "could not verify". */ }
        return {
          uploads,
          stillEmpty: safe(() => api.emptyRequired(), []),
          shown: safe(() => api.scanForm().filter((field) => !field.hidden).length, null),
          unread: safe(() => api.unreadRequired(), []),
          frames: safe(() => api.unreadableFrames(), []),
          errors: safe(() => api.fieldErrors(), []),
        };
      }).catch(() => null) || { uploads: null, stillEmpty: [], shown: null, unread: [], frames: [], errors: [] };
      const uploadProblems = seen.uploads || [{ id: null, label: 'Attachments', message: 'Could not verify the attachments. Check them before continuing.' }];
      for (const entry of uploadProblems) problem(entry.message, entry, 'upload');
      const listed = (entry) => problems.some((known) => known.fieldId && known.fieldId === entry.id);
      for (const entry of seen.stillEmpty || []) if (!listed(entry)) problem(`Still empty: "${entry.label}".`, entry);
      const answeredIds = new Set(Object.values(used).map((answer) => answer.fieldId));
      for (const entry of unresolved) if (entry.required && !answeredIds.has(entry.id) && !listed(entry)) problem(`Still empty: "${entry.label}".`, entry);
      if (metFields.size && seen.shown === 0) problem('The application form is no longer shown on this page (it may have closed): open it again and check every answer before Submit.');
      for (const entry of (seen.unread || []).filter((item) => !listed(item))) {
        problem(entry.kind === 'unread' ? `QTS couldn't read this question — check it: "${entry.label}".` : `Still empty: "${entry.label}".`, entry);
      }
      for (const host of [...new Set(seen.frames || [])]) problem(`Part of this page comes from ${host}, which QTS cannot read: check it for questions to answer.`);
      for (const text of seen.errors || []) problem(`The form shows: ${text}`);
    }
    timings.checks += Date.now() - checksStarted;
    const report = stepReport(step, metFields, used, problems, stepAttempts, { ...timings, total: Date.now() - stepStarted }, (application.aiCalls || 0) - aiCallsBefore);
    diag('step-report', report);
    const left = unresolved.filter((entry) => !(HAS_WORDS.test(entry.label || '') && used[entry.label]));
    const notes = [
      emptiedCount ? `Removed ${emptiedCount} old value${emptiedCount === 1 ? '' : 's'} before filling.` : '',
      ...corrections.map((entry) => `"${entry.label}": the AI wrote "${entry.said.slice(0, 60)}"; QTS used the profile's "${entry.used.slice(0, 60)}".`),
      ...entryNotes,
    ].filter(Boolean);
    return { used, problems, canAskAgain, report, unresolved: left, provisional: [], ...(notes.length ? { notice: notes.join(' ') } : {}) };
  };

  // A question answered in this step that still shows its answer is never filled again (a page that
  // draws it anew after the pick gives it a new id).
  const stillAnswered = async (field) => {
    const before = HAS_WORDS.test(field.label || '') ? used[field.label] : null;
    if (!before || before.step !== step) return false;
    const empty = await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [field]).catch(() => true);
    if (!empty) return true;
    return inForm(tabId, (id, text) => globalThis.__qtsApplyForm.choiceShown(id, text), [field.id, answerText(before.value)]).catch(() => false);
  };

  const needDocuments = async () => {
    if (documents) return documents;
    documents = await fetchApplyDocuments(application.attemptId, application.documentPaths);
    if (!self.__qtsSiteSessions.documentsBelong(documents.paths, application.candidate)) {
      documents = null;
      throw new ApplyStop(`The PDFs saved for this job are not named after ${candidateNameOf(application)}, so QTS did not attach them. Check the job's documents.`, { skip: false });
    }
    application.documentsFolder = documents.folder;
    application.applyDocuments = documents;
    return documents;
  };

  // Replace ordinary document attachments without importing or rebuilding the profile.
  const attachDocuments = async (plan) => {
    // Resume parsing can overwrite Education, Experience and Skills. Attach the
    // documents to their ordinary upload boxes without invoking profile import.
    const uploadStarted = Date.now();
    if (plan.uploads.length) await say('Attaching the documents…');
    let uploaded = false;
    const holds = (id) => inForm(tabId, (box) => globalThis.__qtsApplyForm.uploadHolds(box), [id]).catch(() => false);
    for (const { field, answer } of plan.uploads) {
      await throwIfStopped();
      if (await holds(field.id)) continue;
      const ready = await needDocuments();
      const file = { ...ready[answer.file], mimeType: 'application/pdf' };
      const name = answer.file === 'coverLetter' ? 'cover letter' : 'résumé';
      if (!file.base64) {
        if (field.required) problem(`Upload the ${name} by hand: "${field.label}".`, field, 'upload');
        continue;
      }
      const outcome = await fillAndCheck(tabId, field, answer, file, seen);
      if (outcome.ok) {
        uploaded = true;
        if (file.filename) application.uploadedFileNames.add(file.filename);
        application.stuckBoxes.delete(field.id);
        continue;
      }
      if (outcome.gone || outcome.preserved) continue;
      // Sent but not seen yet (a site redrawing its uploads while it reads the résumé, Telekom): looked
      // at again for up to 6 s once the page settles; shown by then, it is attached.
      if (outcome.manualUpload && !['rejected', 'mismatch'].includes(outcome.uploadState)) {
        let shown = false;
        for (let waited = 0; waited < 6000 && !shown; waited += 1000) {
          await sleep(1000);
          shown = await holds(field.id);
        }
        if (shown) {
          uploaded = true;
          if (file.filename) application.uploadedFileNames.add(file.filename);
          application.stuckBoxes.delete(field.id);
          continue;
        }
      }
      // A cover letter that could not be attached is typed instead where the site offers it.
      const typed = !outcome.manualUpload && answer.file === 'coverLetter' && application.job.coverLetterText
        && await inForm(tabId, (id) => globalThis.__qtsApplyForm.enterManually(id), [field.id]).catch(() => false);
      if (!typed && (field.required || outcome.manualUpload)) problem(outcome.manualUpload ? outcome.error : `The ${name} upload failed: add it by hand ("${field.label}") from the folder above.`, field, 'upload');
    }
    if (uploaded) await settle(400, 4000);
    timings.upload += Date.now() - uploadStarted;
    return uploaded;
  };

  // A quick Ask AI (the page and step just filled, options.quick): straight to the questions still
  // empty. The page, its sign-in and its old values were seen to by that fill; what the Manager has
  // typed since is marked on each box as they type, so nothing needs looking at again.
  const quick = options.quick === true;
  // 0. The page: a sign-in or human check is the Manager's, and nothing is sent or filled for it.
  await inForm(tabId, (context) => globalThis.__qtsApplyForm.setUploadContext(context), [{ attemptId: application.attemptId, step }]);
  let phaseAt = Date.now();
  const phase = (name) => { timings[name] = (timings[name] || 0) + (Date.now() - phaseAt); phaseAt = Date.now(); };
  if (!quick) await waitForFormFields(tabId, { minFields: step > 1 || application.tabMoved ? 1 : 3, pollMs: 300, steadyPolls: 2 });
  phase('wait');
  if (!quick) await inForm(tabId, () => globalThis.__qtsApplyForm.declineCookies()).catch(() => false);
  const page = quick ? null : await inForm(tabId, () => globalThis.__qtsApplyForm.classifyPage()).catch(() => null);
  if (['authentication_required', 'registration_required', 'verification_required'].includes(page?.type)) {
    problem('This page needs account or verification details. Enter passwords and one-time codes yourself, then use the site’s sign-in or continue control; QTS will go on at the next application page.', null, 'field', true);
    return finish({ checks: false });
  }
  const gate = quick ? null : await inForm(tabId, () => globalThis.__qtsApplyForm.pageGate()).catch(() => null);
  if (gate?.kind === 'bot_check') {
    problem(`Solve the human check ("${String(gate.text).slice(0, 60)}") yourself. QTS does not get around it.`, null, 'field', true);
    return finish({ checks: false });
  }
  if (!quick) await inForm(tabId, () => globalThis.__qtsApplyForm.revealLazySections()).catch(() => null);
  phase('page');
  // Résumé first (the Manager, 2026-11-27): a site's "Import resume from ▾" menu gets the résumé once
  // per application, the site fills the form from it, and QTS then fills everything as usual.
  if (!quick && !application.resumeImportTried) {
    const ready = await needDocuments().catch(() => null);
    if (ready?.resume?.base64) {
      const imported = await inForm(tabId, (file) => globalThis.__qtsApplyForm.importResume(file), [{ ...ready.resume, mimeType: 'application/pdf' }]).catch(() => null);
      // No such menu: the site's own "Autofill from resume" upload box (Ashby), when shown and empty.
      if (!imported?.found) {
        const boxes = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm()).catch(() => []);
        const box = (boxes || []).find((field) => !field.hidden && helpers.isAutofillUpload(field));
        if (box) {
          application.resumeImportTried = true;
          const outcome = await fillAndCheck(tabId, box, { file: 'resume', source: 'documents' }, { ...ready.resume, mimeType: 'application/pdf' }, seen).catch(() => null);
          if (outcome?.ok || outcome?.preserved) {
            await say('The site is reading the résumé…');
            await sleep(1500);
            await settle(800, 6000);
          }
        }
      }
      if (imported?.found) {
        application.resumeImportTried = true;
        if (imported.ok) {
          await say('The site is reading the résumé…');
          await sleep(1500);
          await settle(800, 6000);
          await waitForFormFields(tabId, { minFields: 3, pollMs: 300, steadyPolls: 2 }).catch(() => null);
        } else if (imported.error) problem(imported.error, null, 'upload');
      }
    }
  }
  phase('import');

  // Boxes met on an earlier pass are the Manager's now: never emptied or filled again (only their
  // own Fill again or Ask AI again goes back over them).
  const metBefore = new Set(application.cleanedBoxes);

  // Replace ordinary answers directly; only stale attachments are removed up front.
  await throwIfStopped();
  application.uploadedFileNames ||= new Set();
  const cleanStarted = Date.now();
  const cleaned = quick ? { keys: [], boxKeys: [], stuck: [], emptied: [] } : await inForm(tabId, (given) => globalThis.__qtsApplyForm.emptyOldAnswers(given), [{
    known: [...application.cleanedBoxes],
    seedOnly: application.seedCleanOnce === true,
    values: false,
    keepValues: [application.job?.title, application.job?.company].filter(Boolean),
    uploads: true,
    keepFiles: [...application.uploadedFileNames],
  }]).catch(() => null);
  application.seedCleanOnce = false;
  timings.clean = Date.now() - cleanStarted;
  if (!cleaned) {
    problem('QTS could not inspect the existing attachments. Choose Fill again to retry.', null, 'field', true);
    canAskAgain = true;
    return finish({ checks: false });
  }
  for (const key of cleaned.keys || []) application.cleanedBoxes.add(key);
  // Attach this job's documents before replacing ordinary answers.
  let uploadedFirst = false;
  if (!quick && !options.onlyEmpty) {
    // Look again after an attachment in case the site reveals another upload box.
    for (let pass = 0; pass < 3; pass += 1) {
      await throwIfStopped();
      const shown = (await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist({ fullNotes: true })).catch(() => [])) || [];
      const files = shown.filter((field) => field.kind === 'file' && !field.hidden && !field.disabled && !field.cardForm).map(field => ({ ...field, managerEditBaseline }));
      if (!files.length) break;
      const filePlan = helpers.planApiFields(files, application.candidate, application.savedAnswers, answerContext(application));
      if (filePlan.uploads.length) await needDocuments();
      const attached = await attachDocuments(filePlan);
      if (!attached) break;
      uploadedFirst = true;
      await settle(400, 3000);
      // The site rebuilds its form after an import or upload (Oracle: "Uploading…", fields loading):
      // looked at again only once it is done and its boxes are there and steady (at most 90 s: the form
      // is hidden while a file is still uploading, and a cover letter can take a minute).
      await say('Waiting for the site to finish reading the documents…');
      let steady = 0;
      let last = -1;
      // As many boxes as the page showed before (at most 3): a page whose only box is the upload
      // (Dropbox's first step) is not waited on; one that hid its form while uploading (Oracle) is.
      const boxesBefore = Math.min(3, shown.filter((field) => !field.hidden && !field.disabled && field.kind !== 'file').length);
      // (A page that never shows itself busy and keeps its boxes is done at the first look: 3 steady
      // looks only after it was busy or its boxes changed, 2026-11-27: justjoin waited ~3 s for nothing.)
      let sawBusy = false;
      for (let waited = 0; waited < 90000 && steady < (sawBusy ? 3 : 1); waited += 500) {
        if (waited) await sleep(500);
        const look = await inForm(tabId, () => ({
          busy: globalThis.__qtsApplyForm.pageUploadBusy() || /fields-loading/i.test(document.body?.innerText || ''),
          boxes: globalThis.__qtsApplyForm.scanForAssist().filter((field) => !field.hidden && !field.disabled && field.kind !== 'file').length,
        })).catch(() => null);
        if (!look || look.busy || look.boxes < boxesBefore || (last !== -1 && look.boxes !== last)) sawBusy = true;
        steady = look && !look.busy && look.boxes >= boxesBefore && (last === -1 || look.boxes === last) ? steady + 1 : 0;
        last = look?.boxes ?? -1;
      }
    }
  }
  // (Ask AI goes over every box still empty, reviewed or not.)
  const reviewed =new Set(options.again || options.onlyEmpty ? [] : (cleaned.boxKeys || []).filter(([, key]) => metBefore.has(key)).map(([id]) => id));
  for (const box of cleaned.stuck || []) application.stuckBoxes.set(box.id ?? box.label, box);
  emptiedCount = (cleaned.emptied || []).length;
  if (!quick) await settle(300, 1500);
  phase('settle');

  // Experience and Education (2026-11-26): every entry checked against the profile and corrected, the
  // missing jobs and schools added with the section's own Add; never deleted. Their boxes are this
  // step's, so the questions below never fill them.
  if (!quick && !options.onlyEmpty) {
    const entryStarted = Date.now();
    const ownedEntries = await checkProfileEntries(tabId, application, { seen, problem, say, notes: entryNotes, managerEditBaseline, throwIfStopped })
      .catch((error) => { if (error instanceof ApplyStop) throw error; problem(`Experience / Education could not be checked: ${error?.message || error}`); return new Set(); });
    for (const id of ownedEntries) seen.add(id);
    timings.fill += Date.now() - entryStarted;
  }
  phase('entries');

  // The AI is called at most once per fill (one Ask AI = one call): a question that appears later in
  // this fill, or an answer the site refuses, is left for the Manager and the next Ask AI.
  let aiAsked = false;
  // Light fill (default; storage qtsApplyLightFill=false turns it off): after a round, the quick look
  // (address, number of boxes, error marks; no layout work) decides whether the page changed. Unchanged,
  // the next full read of every question is skipped; only the cheap "required question still empty"
  // check runs, and a full read follows only when it finds one to try again.
  const lightFill = (await chrome.storage.local.get('qtsApplyLightFill').catch(() => ({}))).qtsApplyLightFill !== false;
  const glanceKey = () => inForm(tabId, () => globalThis.__qtsApplyForm.stepGlance?.()?.key ?? null).catch(() => null);
  let quietAfterFill = false;
  // Rounds: a question that appears after an earlier answer goes through the same steps, alone.
  for (let round = 0; round <= APPLY_FILL_ROUNDS; round += 1) {
    await throwIfStopped();
    if (quietAfterFill) {
      quietAfterFill = false;
      // Complete before review (as below, without the full read): a required question still empty
      // gets one more round, as if new.
      if (rechecked) break;
      rechecked = true;
      const empty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
      let again = 0;
      for (const entry of empty || []) {
        if (problems.some((known) => known.fieldId && known.fieldId === entry.id)) continue;
        if (await stillAnswered(metFields.get(entry.id) || entry)) continue;
        seen.delete(entry.id);
        again += 1;
      }
      if (!again) break;
    }
    // 2. Read every question the page shows now.
    const fields = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist({ fullNotes: true })) || [];
    // The page as this round read it, to tell after the filling whether anything new appeared.
    const readKey = lightFill ? await glanceKey() : null;
    let fresh = [];
    for (const field of fields) {
      // (A card form's box is the entry step's; one it left that is required and still empty, Oracle's
      // "Degree*" in an opened Education card, is filled like any question, 2026-11-27.)
      if (field.cardForm && !(field.required && await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [field]).catch(() => false))) continue;
      if (field.hidden || field.disabled || field.unrelated || field.account || (field.managerChanged && !options.again && !options.onlyEmpty) || field.trackingValue || reviewed.has(field.id) || seen.has(field.id)) continue;
      if (!options.onlyEmpty && await stillAnswered(field)) {
        seen.add(field.id);
        used[field.label].fieldId = field.id;
        continue;
      }
      fresh.push({ ...field, managerEditBaseline });
    }
    // Ask AI: only boxes still empty (required or not); whatever holds a value stays.
    if (options.onlyEmpty) fresh = await onlyEmptyFields(tabId, fresh, seen);
    if (!fresh.length) {
      // Complete before review: a required question still empty gets one more round, as if new.
      if (rechecked) break;
      rechecked = true;
      const empty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
      let again = 0;
      for (const entry of empty || []) {
        if (problems.some((known) => known.fieldId && known.fieldId === entry.id)) continue;
        if (await stillAnswered(fields.find((field) => field.id === entry.id) || entry)) continue;
        seen.delete(entry.id);
        again += 1;
      }
      if (!again) break;
      continue;
    }
    for (const field of fresh) {
      seen.add(field.id);
      metFields.set(field.id, field);
    }

    // Lists the AI must choose from are opened; a list the profile answers is not.
    await say('Reading the questions…');
    const discoveryStarted = Date.now();
    // Choices the job site publishes (Greenhouse) fill in lists that show none until opened.
    await addSiteChoices(tabId, fresh).catch(() => 0);
    let plan = helpers.planApiFields(fresh, application.candidate, application.savedAnswers, answerContext(application));
    // A fill without the AI (Alt+F, the fill on arrival) never uses the choices of a question only the
    // AI answers: those lists are read when the Manager asks the AI (Ask AI), not now (~1-2 s each).
    // Still read: a list whose choices would let the profile or a saved answer answer it (a required
    // agreement picks "Acknowledge/Confirm" or "Yes" from its own choices), told by planning it with
    // sample choices.
    // (One clear yes: an agreement is chosen only when its list has exactly one.)
    // ("LinkedIn": "Where did you hear about us?" is answered from its own choices too.)
    // ("English": a "Preferred language" list.)
    const SAMPLE_CHOICES = ['Yes', 'No', 'LinkedIn', 'English'];
    const answerableWithChoices = (field) => ['combobox', 'select', 'menu', 'radio'].includes(field.kind) && !field.options?.length && (() => {
      const trial = helpers.planApiFields([{ ...field, options: SAMPLE_CHOICES }], application.candidate, application.savedAnswers, answerContext(application));
      return trial.code.some((entry) => entry.field.id === field.id) || trial.ai.some((entry) => entry.field.id === field.id && entry.check);
    })();
    const unread = options.onlyEmpty && !options.noAi
      ? [...fresh]
      : plan.ai.filter((entry) => !entry.check).map((entry) => fresh.find((field) => field.id === entry.field.id)).filter(Boolean)
        .filter((field) => !options.noAi || answerableWithChoices(field));
    // A phone's country-code list is looked up too: one search for the candidate's country, then the
    // profile picks the number's own code from what it shows.
    // Not when the plan already has its answer (Oracle's "+40 (Romania)"): looking opens and searches
    // the list, which leaves some lists (Oracle's) unable to take the real pick after.
    for (const field of fresh) {
      if (field.kind === 'combobox' && /^((phone|telephone|mobile) )?country (phone |calling |dial(l)?ing )?code$|^(phone |telephone )?(dial(l)?ing|calling) code$/i.test(String(field.label || '').trim()) && !field.options?.length && !unread.includes(field)
        && !plan.code.some((entry) => entry.field.id === field.id)) unread.push(field);
    }
    const changedByLooking = await readComboboxOptions(tabId, unread, options.stop, application.candidate);
    for (const field of changedByLooking) problem(`Check "${field.label}": looking at its choices changed it; set it as it should be.`, field);
    // Decided again: the choices are known now.
    plan = helpers.planApiFields(fresh, application.candidate, application.savedAnswers, answerContext(application));
    timings.discovery += Date.now() - discoveryStarted;
    for (const { field, message } of plan.manager) {
      // A box that already holds an answer (picked on an earlier fill: a multi-select hides its picked
      // choices, so the saved answer seems missing from its list) is not flagged for the Manager.
      if (!(await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [field]).catch(() => true))) {
        seen.add(field.id);
        continue;
      }
      problem(message, field);
      leave(field);
    }

    // The documents are read before the AI is asked: a file that cannot be read must not cost a request.
    if (plan.uploads.length) await needDocuments();

    // 3. One request for every question QTS may not answer by itself. Nothing has been filled yet.
    const answers = {};
    const asked = new Map();
    const toAsk = [];
    const verify = (entry, answer) => {
      const verdict = helpers.verifyApiAnswer(entry, answer, { evidence: application.factSources?.evidence || '', instructions: application.answerPrompt?.template || '' });
      const { field } = entry;
      if (verdict.refused) {
        application.aiRefused?.set(field.label, verdict.refused);
        leave(field, verdict.refused);
        if (field.required) problem(`Fill by hand: "${field.label}" — ${verdict.refused}.`, field);
        return null;
      }
      if (verdict.corrected) {
        corrections.push({ label: field.label, ...verdict.corrected });
        return { ...verdict.answer, checkedNote: `The AI wrote "${verdict.corrected.said.slice(0, 80)}". QTS used the profile.` };
      }
      return verdict.answer;
    };
    for (const entry of plan.ai) {
      const { field } = entry;
      asked.set(field.id, entry);
      const named = HAS_WORDS.test(field.label || '');
      const earlier = named && used[field.label];
      if (earlier && 'value' in earlier) {
        const kept = verify(entry, earlier);
        if (kept) answers[field.id] = kept;
        continue;
      }
      const refused = named && application.aiRefused?.get(field.label);
      if (refused) {
        leave(field, refused);
        if (field.required) problem(`Review "${field.label}": the AI's answer was not filled because ${refused}.`, field);
        continue;
      }
      toAsk.push(entry);
    }
    // Alt+A sends every remaining empty question, including profile/saved-answer and
    // manual-review questions. The plan still controls which replies may be filled.
    // Read emptiness again after option discovery, which can take time.
    // Never a link other than LinkedIn or GitHub (2026-11-26: left empty); a question the plan wrote
    // an instruction for (a declaration's favorable answer, the profile's value) goes with it.
    const requestFields = (options.onlyEmpty && !options.noAi
      ? await onlyEmptyFields(tabId, fresh, seen)
      : toAsk.map((entry) => entry.field))
      .filter((field) => !field.otherLink)
      .map((field) => asked.get(field.id)?.field || field);
    if (requestFields.length && (options.noAi || aiAsked)) {
      // The AI is asked only when the Manager clicks Ask AI, and once per click. Until then a question
      // the profile states takes the profile's value; the rest stay empty, listed for the Manager.
      for (const { field, check } of toAsk) {
        if (check) answers[field.id] = { ...check };
        else leave(field, aiAsked ? 'appeared after the AI was asked: click Ask AI again, or fill it yourself' : 'not asked yet: click Ask AI, or fill it yourself');
      }
    } else if (requestFields.length) {
      aiAsked = true;
      let failure = null;
      let replied = {};
      let reviewed = [];
      if (!failure) {
        await throwIfStopped();
        application.onAi?.({ state: 'asking', provider: 'AI', focused: false });
        await say(`Asking the AI about ${requestFields.length} question${requestFields.length === 1 ? '' : 's'}…`);
        const aiStarted = Date.now();
        try {
          replied = await askAiForAnswers(application, requestFields, keepAlive);
          reviewed = (application.aiReview || []).splice(0);
          if (aiSaidNothing(replied, reviewed)) failure = 'its reply held no usable answers';
        } catch (error) {
          if (error instanceof ApplyStop) throw error;
          failure = error instanceof Error ? error.message : 'the AI did not answer';
        }
        timings.ai += Date.now() - aiStarted;
        application.onAi?.({ state: 'done', provider: 'AI', focused: false, ok: !failure });
      }
      if (failure) {
        // No answers, no filling: the form stays clean for "Ask AI again" or for the Manager.
        application.aiUnanswered = [];
        application.aiReview = [];
        canAskAgain = true;
        problem(`The AI did not answer (${failure}), so it filled nothing. Click Ask AI again, or fill the form yourself.`, null, 'field', true);
        for (const entry of toAsk) leave(entry.field, failure);
        return finish();
      }
      for (const entry of toAsk) {
        const { field } = entry;
        const reply = replied[field.id];
        if (reply) {
          const kept = verify(entry, reply);
          if (kept) answers[field.id] = kept;
        } else if (entry.check) {
          // The AI left it, but the profile states it.
          application.aiRefused?.delete(field.label);
          answers[field.id] = { ...entry.check };
        } else {
          const note = reviewed.find((item) => item.id === field.id)?.reason || (application.aiUnanswered || []).find((item) => item.id === field.id)?.reason || 'nothing given supports an answer';
          leave(field, note);
          if (field.required) problem(`Fill by hand: "${field.label}" — the AI gave no answer (${note}).`, field);
        }
      }
      application.aiUnanswered = [];
    }

    // 4. Documents a box that appeared later still needs (the page's own went up before the filling).
    await throwIfStopped();
    const uploaded = uploadedFirst || await attachDocuments(plan);

    // 5. Everything, in page order, replacing anything the site put there.
    await throwIfStopped();
    await say('Filling the answers…');
    const fillStarted = Date.now();
    const fromCode = new Map(plan.code.map((entry) => [entry.field.id, entry.answer]));
    const record = (field, answer) => {
      used[usedKey(used, field)] = { ...answer, step, fieldId: field.id, ...fieldFacts(field) };
      application.stuckBoxes.delete(field.id);
    };
    /** Fills one answer: the AI's wordings, then the profile's value. { outcome, chosen }. */
    const fillOne = async (field, given, entry) => {
      const { alternatives = [], ...first } = forField(field, given);
      let chosen = first;
      let outcome = await fillAndCheck(tabId, field, first, null, seen);
      for (const value of alternatives) {
        if (outcome.ok || outcome.gone || outcome.preserved) break;
        const next = { ...first, value };
        const tried = await fillAndCheck(tabId, field, next, null, seen);
        if (tried.ok || tried.gone || tried.preserved) chosen = next;
        outcome = tried.ok || tried.gone || tried.preserved || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
      }
      if (!outcome.ok && !outcome.gone && !outcome.preserved && entry?.check && first.source === 'ai') {
        const fallback = forField(field, { ...entry.check });
        const tried = await fillAndCheck(tabId, field, fallback, null, seen);
        if (tried.ok || tried.gone || tried.preserved) chosen = fallback;
        outcome = tried.ok || tried.gone || tried.preserved || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
      }
      // The profile's fact in the words of the choices the field showed ("Rumunia" for "Romania").
      const fact = chosen.fact || entry?.check?.fact;
      const meant = chosen.intended ?? entry?.check?.intended ?? entry?.check?.value;
      if (!outcome.ok && !outcome.gone && !outcome.preserved && fact && meant && outcome.choices?.length) {
        const same = helpers.sameFactOption(fact, String(meant), outcome.choices);
        if (same) {
          const converted = { ...chosen, value: same, intended: String(meant) };
          const tried = await fillAndCheck(tabId, field, converted, null, seen);
          if (tried.ok || tried.gone || tried.preserved) chosen = converted;
          outcome = tried;
        }
      }
      // Decided again with the choices the list showed (planned before they were known): "Are you
      // Hispanic/Latino?" Yes / No from the profile's ethnicity, a disability list in its own words.
      if (!outcome.ok && !outcome.gone && !outcome.preserved && outcome.choices?.length && chosen.source !== 'ai') {
        const known = { ...field, ...choicesSeen(field, outcome.choices), options: outcome.choices };
        const again = helpers.planApiFields([known], application.candidate, application.savedAnswers, answerContext(application));
        const next = again.code.find((item) => item.field.id === field.id)?.answer || again.ai.find((item) => item.field.id === field.id)?.check;
        if (next && answerText(next.value) !== answerText(chosen.value)) {
          const retry = forField(field, next);
          const tried = await fillAndCheck(tabId, field, retry, null, seen);
          if (tried.ok || tried.gone || tried.preserved) chosen = retry;
          outcome = tried.ok || tried.gone || tried.preserved || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
        }
      }
      return { outcome, chosen };
    };
    const issues = [];
    const later = [];
    for (const field of fresh) {
      await throwIfStopped();
      // The Manager may answer while discovery or the AI request is in flight.
      if (options.onlyEmpty && !(await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [field]).catch(() => false))) continue;
      const code = fromCode.get(field.id);
      const given = answers[field.id] || code;
      if (!given) {
        // Filled by the site from the résumé just attached: kept, and listed for the Manager.
        if (uploaded && field.kind !== 'file') {
          const value = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownValue(id), [field.id]).catch(() => '');
          if (value && !(await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [field]).catch(() => true))) {
            used[usedKey(used, field)] = { value, source: 'site', step, fieldId: field.id, ...fieldFacts(field) };
          }
        }
        continue;
      }
      const { outcome, chosen } = await fillOne(field, given, asked.get(field.id));
      if (outcome.gone || outcome.preserved) continue;
      if (outcome.ok) {
        record(field, chosen);
        continue;
      }
      if (asked.has(field.id) && chosen.source === 'ai') {
        const sent = asked.get(field.id).field;
        if (outcome.choices?.length) Object.assign(sent, choicesSeen(sent, outcome.choices));
        issues.push({ id: field.id, label: field.label, reason: `the site did not take "${[].concat(chosen.value).join(' | ')}": ${outcome.error}` });
      } else if (field.required) {
        // Looked at again once the whole page is filled (below): a site that redraws part of its form
        // meanwhile (Oracle after a Country pick) closes a list mid-pick, or marks a good answer late.
        later.push({ field, given, chosen, error: outcome.error });
      }
    }
    if (later.length) await settle(800, 5000);
    for (const { field, given, chosen, error } of later) {
      await throwIfStopped();
      const wanted = answerText(chosen.value);
      const held = await inForm(tabId, (id) => globalThis.__qtsApplyForm.boxValue?.(id), [field.id]).catch(() => '');
      const squashed = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      // The box's own text: the whole answer, or its start for a code list ("+40" for "+40 (Romania)").
      const holdsAnswer = (text) => {
        const own = squashed(text);
        return Boolean(own) && (own === squashed(wanted) || (field.kind === 'combobox' && own.length >= 2 && squashed(wanted).startsWith(own)));
      };
      if (holdsAnswer(held)) { record(field, chosen); continue; }
      const again = await fillOne(field, given, asked.get(field.id));
      if (again.outcome.ok || again.outcome.gone || again.outcome.preserved) { if (again.outcome.ok) record(field, again.chosen); continue; }
      // The site's red mark can stay a moment after a good pick (Oracle): the box holding the answer
      // with no error left on it after a short wait is done.
      // Oracle checks a list box when the cursor leaves it: the cursor is taken out first.
      await inForm(tabId, () => { const active = document.activeElement; if (active && active !== document.body) active.blur?.(); }).catch(() => null);
      await sleep(1500);
      const heldNow = await inForm(tabId, (id) => globalThis.__qtsApplyForm.boxValue?.(id), [field.id]).catch(() => '');
      const stillMarked = await inForm(tabId, (id) => globalThis.__qtsApplyForm.fieldError?.(id), [field.id]).catch(() => null);
      if (holdsAnswer(heldNow) && !stillMarked) { record(field, chosen); continue; }
      problem(`Fill by hand: "${field.label}" — the site did not take "${wanted}" (${again.outcome.error || error}).`, field);
    }
    // What the site refused is never sent to the AI again on its own (the Manager asked for one call
    // per Ask AI): it is listed with the site's reason, for the Manager or their next Ask AI.
    const ASK_AI_AGAIN_ON_REFUSAL = false;
    if (ASK_AI_AGAIN_ON_REFUSAL && issues.length && application.geminiTurns?.length && !options.noAi) {
      const tried = new Map(issues.map((entry) => [entry.id, entry.reason]));
      const retry = plan.ai.map((entry) => entry.field).filter((field) => tried.has(field.id));
      await say('Asking the AI about the answers the site refused…');
      try {
        const aiStarted = Date.now();
        const fixed = await askAiToFix(application, issues, retry, keepAlive);
        timings.ai += Date.now() - aiStarted;
        application.aiReview = [];
        application.aiUnanswered = [];
        for (const field of retry) {
          const entry = asked.get(field.id);
          const kept = fixed[field.id] ? verify(entry, fixed[field.id]) : null;
          const { outcome, chosen } = kept ? await fillOne(field, kept, entry) : { outcome: { ok: false, error: 'the AI gave no other answer' }, chosen: null };
          if (outcome.gone || outcome.preserved) continue;
          if (outcome.ok) record(field, chosen);
          else {
            leave(field, tried.get(field.id));
            if (field.required) problem(`Fill by hand: "${field.label}" — the site said: ${outcome.error}. Tried: ${tried.get(field.id)}.`, field);
          }
        }
      } catch (error) {
        if (error instanceof ApplyStop) throw error;
        canAskAgain = true;
        for (const field of retry) {
          leave(field, tried.get(field.id));
          if (field.required) problem(`Fill by hand: "${field.label}" — ${tried.get(field.id)}.`, field);
        }
      }
    } else {
      for (const issue of issues) {
        const field = fresh.find((entry) => entry.id === issue.id);
        leave(field, issue.reason);
        if (field.required) problem(`Fill by hand: "${field.label}" — ${issue.reason}.`, field);
      }
    }
    timings.fill += Date.now() - fillStarted;
    // 6. Let the page show the questions these answers unlock, then look again.
    await settle(350, 1500);
    // Nothing new on the page (same address, boxes and error marks): the next full read is skipped.
    if (lightFill && readKey !== null && (await glanceKey()) === readKey) quietAfterFill = true;
  }
  // 7. Read back (2026-11-25): every box QTS filled in this step must still show its answer now, after
  // the whole page is done (a site may change or empty a box later: a résumé import, a list that redraws
  // others). One trip reads them all; a box the site changed is filled once more, then, if it still does
  // not hold its answer, listed for the Manager. Usual reformatting is not a change: a phone shown
  // without its country code, "72,000" for "72000", a link without "https://www.". Dates and lists of
  // several picks are not compared (sites rewrite them).
  await throwIfStopped();
  phase('rounds');
  const toReadBack = Object.values(used)
    .filter((answer) => answer?.step === step && answer.fieldId && answer.source !== 'site' && metFields.has(answer.fieldId))
    .filter((answer) => !['file', 'date'].includes(metFields.get(answer.fieldId)?.kind) && !metFields.get(answer.fieldId)?.dateParts
      && !Array.isArray(answer.value) && answer.value !== undefined && answer.value !== null);
  if (toReadBack.length) {
    await say('Checking the answers…');
    const readBackStarted = Date.now();
    const looks = await inForm(tabId, (items) => {
      const api = globalThis.__qtsApplyForm;
      const squash = (text) => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const digits = (text) => String(text ?? '').replace(/\D/g, '');
      return items.map(({ id, kind, text, bool }) => {
        try {
          if (!api.findField?.(id)) return 'gone';
          if (typeof bool === 'boolean') return api.findFieldChecked(id) === bool ? 'ok' : 'changed';
          if (['radio', 'checkbox'].includes(kind)) return api.optionChecked(id, text) || api.choiceShown(id, text) ? 'ok' : 'changed';
          if (['select', 'combobox', 'menu'].includes(kind) && api.choiceShown(id, text)) return 'ok';
          const shown = String(api.shownValue(id) || api.boxValue?.(id) || '');
          const [now, wanted] = [squash(shown), squash(text)];
          if (!wanted) return 'ok';
          if (!now) return 'changed';
          if (now === wanted || now.endsWith(wanted) || wanted.endsWith(now) && now.length >= Math.min(6, wanted.length)) return 'ok';
          // The same number in the site's own format (a phone with or without its code, "0264…").
          const [a, b] = [digits(shown), digits(text)];
          if (a.length >= 7 && b.length >= 7 && a.slice(-7) === b.slice(-7)) return 'ok';
          // A code list showing only its code ("+40" for "+40 (Romania)").
          if (['select', 'combobox', 'menu'].includes(kind) && now.length >= 2 && wanted.startsWith(now)) return 'ok';
          // A long answer a box cut to its length limit.
          if (wanted.length > 60 && wanted.startsWith(now.slice(0, 40))) return 'ok';
          return 'changed';
        } catch {
          return 'gone';
        }
      });
    }, [toReadBack.map((answer) => ({
      id: answer.fieldId,
      kind: metFields.get(answer.fieldId)?.kind || '',
      text: answerText(answer.value),
      ...(typeof answer.value === 'boolean' ? { bool: answer.value } : {}),
    }))]).catch(() => null);
    const changed = (looks || []).map((look, index) => (look === 'changed' ? toReadBack[index] : null)).filter(Boolean);
    for (const answer of changed) {
      await throwIfStopped();
      const field = metFields.get(answer.fieldId);
      const refill = await fillAndCheck(tabId, field, answer, null, seen).catch(() => ({ ok: false }));
      diag('read-back', { question: String(field.label || '').slice(0, 80), refilled: Boolean(refill.ok || refill.preserved) });
      if (refill.ok || refill.preserved || refill.gone) continue;
      problem(`Check "${field.label}": the site changed it after QTS filled it with "${answerText(answer.value).slice(0, 80)}".`, field);
    }
    timings.checks += Date.now() - readBackStarted;
  }
  await say('Checking the page…');
  return finish();
}

self.__qtsAutoApplyApi = {
  prepareSite,
  checkSiteAccount,
  candidateHolds,
  noteSiteUsed,
  hasNewQuestions,
  hostedApplyStop,
  describeNoRoute,
  fillPage: fillApiFormPage,
  releaseSites: (attemptId) => siteHolds.release(attemptId),
  // Lists with no choices read yet take them from the job site's own data (Greenhouse); how many did.
  addSiteChoices,
  // The candidate whose application holds this job's site in this Chrome now (null: free), and the site.
  // ('' for a platform nobody signs in to: never busy; Workday: the company's own address.)
  siteOfJob: (url) => {
    const sessions = self.__qtsSiteSessions;
    if (!sessions.originOf(url)) return '';
    return sessions.holdKeyOf(url);
  },
  siteHolder: (site) => (site ? siteHolds.holder(site) : null),
};
