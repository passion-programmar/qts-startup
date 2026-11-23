// Auto Apply with APIs (Super Admin's per-Manager switch): the same claims, panel and checklist as
// Auto Apply, in its own order, so a Manager without the switch is not touched by any of this.
//
//   clear a site last used for another candidate -> open -> whoever is signed in must be this candidate
//   -> empty the form -> read every question -> upload -> fill what the profile states -> check
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
  await holdSite(sessions.siteOf(sessions.hostOf(url)), application, options);
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

/** One form page, in the order above. Returns what fillFormPage returns. */
// Off: Skills, Experience and Education come only from the site's résumé import (switch on to have
// QTS add an empty section's entries through its own "ADD …" form).
const ADD_CARDS_BY_HAND = false;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const COUNTRY_WORDS = { uk: 'United Kingdom', 'u.k.': 'United Kingdom', usa: 'United States', us: 'United States', 'u.s.': 'United States' };

/**
 * Card sections (Oracle Candidate Experience: Skills, Experience, Education), on the page's first
 * visit only (the Manager's choice of 2026-11-22): every old card is deleted, then this application's
 * are added through each section's own "ADD …" form: skills from this job's résumé, jobs and schools
 * from the profile (a job's description from this résumé's bullets for it). What the site refuses is
 * left out and listed for the Manager. Never Submit.
 */
/**
 * Every old entry of Skills, Experience and Education removed with its own ✕ / Delete, checked, and
 * removed again (up to 3 rounds) until the sections are empty: the Manager's rule of 2026-11-22, "must
 * empty all, then upload the PDFs". An open ADD / Edit form is cancelled first (it hides the entries).
 * True when every section is empty (or the page has none).
 */
async function deleteOldCards(tabId, problem, say) {
  const form = (func, args = []) => inForm(tabId, func, args).catch(() => null);
  let sections = await form(() => globalThis.__qtsApplyForm.cardSections());
  if (!Array.isArray(sections) || !sections.length) return true;
  for (let round = 0; round < 3 && sections.some((section) => section.cards); round += 1) {
    for (const { kind, cards } of sections) {
      if (await form((k) => globalThis.__qtsApplyForm.sectionFormOpen(k), [kind])) await form((k) => globalThis.__qtsApplyForm.closeSectionForm(k, false), [kind]);
      if (!cards) continue;
      await say(`Removing the old ${kind} entries…`);
      await form((k) => globalThis.__qtsApplyForm.deleteSectionCards(k), [kind]);
    }
    await sleep(700);
    sections = (await form(() => globalThis.__qtsApplyForm.cardSections())) || [];
  }
  const left = sections.filter((section) => section.cards);
  for (const { kind, cards } of left) problem(`${kind[0].toUpperCase()}${kind.slice(1)}: ${cards} old ${cards === 1 ? 'entry' : 'entries'} could not be removed; remove ${cards === 1 ? 'it' : 'them'} by hand, then click Fill again.`, null, 'field', true);
  return !left.length;
}

// Sites whose "Employment" step QTS fills entry by entry from the profile's work history (the
// Manager's choice of 2026-11-22: Dropbox's careers site).
const EMPLOYMENT_SITES = /(^|\.)dropbox\.jobs$/i;

/**
 * Dropbox's "Employment *" and "Education *" steps: one entry per job (newest first) and per school of
 * the profile, each added with the section's own "Add". Employment: Job Title, Company (picked from its
 * list, else typed and Enter, as the form says), "I currently work here" for the current job, else the
 * To month, and the From month. Education: School (from its search list, else "Other", as the form
 * says), Qualification ("Bachelor's Degree" is "Bachelor"), Field of study (else "Other"), From and To
 * months. What a list really holds decides, never what its box shows. What does not take is listed
 * for the Manager. Never Submit.
 */
async function fillRepeatedEntries(tabId, application, seen, problem, say) {
  const form = (func, args = []) => inForm(tabId, func, args).catch(() => null);
  const squash = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const month = (date) => /^\d{4}-\d{2}/.exec(String(date || ''))?.[0] || '';
  // A box holding the value counts: a message the page shows for a moment while it redraws (an item
  // of another list) is no refusal.
  const fill = async (field, value) => {
    if (!field) return false;
    if ((await fillAndCheck(tabId, field, { value, source: 'profile' }, null, seen)).ok) return true;
    if (typeof value === 'boolean') return (await form((id) => Boolean(globalThis.__qtsApplyForm.findFieldChecked?.(id)), [field.id])) === value;
    return squash(await form((id) => globalThis.__qtsApplyForm.boxValue?.(id), [field.id])) === squash(value);
  };
  const details = application.profileDetails || {};
  const kinds = {
    employment: {
      title: 'Employment',
      items: [...(details.experiences || [])]
        .filter((job) => job && (String(job.companyName || '').trim() || String(job.jobTitle || '').trim()))
        .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || ''))),
      name: (job) => [job.jobTitle, job.companyName].filter(Boolean).join(' at '),
    },
    education: {
      title: 'Education',
      items: [...(details.educations || [])]
        .filter((school) => school && (String(school.institution || '').trim() || String(school.degree || '').trim()))
        .sort((a, b) => String(b.endDate || b.startDate || '').localeCompare(String(a.endDate || a.startDate || ''))),
      name: (school) => [school.degree, school.institution].filter(Boolean).join(', '),
    },
  };
  /**
   * One list: its own choice already, else the closest of its choices (exact, then the profile's words
   * starting with a choice: "Bachelor's Degree" is "Bachelor", the longest such), else its search box
   * (picked, or typed and Enter when allowEnter), else "Other" when allowed. True when the list holds it.
   */
  const pickList = async (kind, index, part, wanted, { allowEnter = false, orOther = false } = {}) => {
    const read = async () => (await form((k, n) => globalThis.__qtsApplyForm.entryFields(k, n), [kind, index]))?.[part] || null;
    let list = await read();
    if (!list || !wanted) return false;
    const holds = (text) => squash(list?.chosen) === squash(text);
    if (holds(wanted)) return true;
    const exact = list.options.find((option) => squash(option) === squash(wanted));
    const starts = list.options.filter((option) => squash(option).length >= 3 && squash(wanted).startsWith(squash(option)))
      .sort((a, b) => b.length - a.length)[0];
    const choice = exact || starts;
    // Through the box a person uses first (the site's own widget then shows it too); the list behind it
    // only when the box will not take it.
    if (choice && list.box) {
      await realSuggestionOne(tabId, list.box, choice);
      list = await read();
      if (holds(choice)) return true;
    }
    if (choice && list.list) {
      await fillAndCheck(tabId, list.list, { value: choice, source: 'profile' }, null, seen);
      list = await read();
      if (holds(choice)) return true;
    }
    if (list.box && !choice) {
      await realSuggestionOne(tabId, list.box, wanted);
      list = await read();
      if (list && list.chosen && (holds(wanted) || squash(wanted).startsWith(squash(list.chosen)))) return true;
      if (allowEnter) {
        const box = await form((id) => globalThis.__qtsApplyForm.boxOf(id), [list.box.id]);
        if (box) {
          await realClick(tabId, box);
          await sleep(200);
          await realPasteText(tabId, wanted);
          await sleep(900);
          await realKey(tabId, REAL_KEYS.enter);
          await sleep(700);
        }
        list = await read();
        if (holds(wanted)) return true;
      }
    }
    if (orOther) {
      if (list?.box) {
        await realSuggestionOne(tabId, list.box, 'Other');
        list = await read();
        if (list && /^other\b/i.test(list.chosen)) return true;
      }
      const other = list?.options.find((option) => /^other\b/i.test(option));
      if (other && list.list) {
        await fillAndCheck(tabId, list.list, { value: other, source: 'profile' }, null, seen);
        list = await read();
        if (list && squash(list.chosen) === squash(other)) return true;
      }
    }
    return false;
  };
  for (const [kind, spec] of Object.entries(kinds)) {
    if ((await form((k) => globalThis.__qtsApplyForm.entryCount(k), [kind])) < 0) continue;
    if (!spec.items.length) {
      problem(`${spec.title}: the profile has none: add ${kind === 'employment' ? 'the jobs' : 'the schools'} by hand.`);
      continue;
    }
    await say(`${spec.title}: adding the entries from the profile…`);
    const left = [];
    for (let index = 0; index < spec.items.length; index += 1) {
      const item = spec.items[index];
      let count = await form((k) => globalThis.__qtsApplyForm.entryCount(k), [kind]);
      if (count <= index) count = await form((k) => globalThis.__qtsApplyForm.addEntry(k), [kind]);
      const entry = count > index ? await form((k, n) => globalThis.__qtsApplyForm.entryFields(k, n), [kind, index]) : null;
      if (!entry) { left.push(spec.name(item)); continue; }
      let ok = true;
      if (kind === 'employment') {
        if (item.jobTitle) ok = (await fill(entry.title, item.jobTitle)) && ok;
        if (item.companyName) ok = (await pickList(kind, index, 'company', item.companyName, { allowEnter: true })) && ok;
        if (month(item.startDate)) ok = (await fill(entry.start, month(item.startDate))) && ok;
        if (item.isCurrent || !item.endDate) ok = (await fill(entry.current, true)) && ok;
        else ok = (await fill(entry.end, month(item.endDate))) && ok;
      } else {
        if (item.institution) ok = (await pickList(kind, index, 'school', item.institution, { orOther: true })) && ok;
        if (item.degree) ok = (await pickList(kind, index, 'degree', item.degree, { orOther: true })) && ok;
        if (item.fieldOfStudy) ok = (await pickList(kind, index, 'field', item.fieldOfStudy, { orOther: true })) && ok;
        if (month(item.startDate)) await fill(entry.start, month(item.startDate));
        if (month(item.endDate)) await fill(entry.end, month(item.endDate));
      }
      if (!ok) left.push(spec.name(item));
    }
    if (left.length) problem(`${spec.title}: check ${left.join('; ')}: not every box took its value.`);
  }
}

async function fillCardSections(tabId, application, seen, problem, say) {
  const form = (func, args = []) => inForm(tabId, func, args).catch(() => null);
  const all = await form(() => globalThis.__qtsApplyForm.cardSections());
  if (!Array.isArray(all) || !all.length) return;
  const helpers = self.__qtsApplyAnswers;
  const resumeText = application.job?.resumeText || '';
  const details = application.profileDetails || {};
  const names = { skills: 'Skills', experience: 'Experience', education: 'Education' };
  const title = (kind) => names[kind] || kind;
  /** The first of values the box takes; with keep, a box that already holds something is left. */
  const squash = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const fill = async (field, values, keep = false) => {
    if (!field) return false;
    // The page's own read of the box ("filled"): Oracle's empty Degree list reads as answered otherwise.
    if (keep && field.filled) return true;
    for (const value of values.filter((entry) => entry !== undefined && entry !== null && entry !== '')) {
      const outcome = await fillAndCheck(tabId, field, { value, source: 'profile' }, null, seen);
      if (outcome.ok) return true;
      // The entry form keeps its "invalid" mark until SAVE: the box holding the value is enough.
      const held = await form((id) => globalThis.__qtsApplyForm.boxValue?.(id), [field.id]);
      if (typeof value === 'string' && held && squash(held) === squash(value)) return true;
    }
    return false;
  };
  const dateParts = (value) => {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    if (!match) return null;
    const month = Number(match[2]);
    return { year: match[1], month: [MONTH_NAMES[month - 1], MONTH_NAMES[month - 1].slice(0, 3), match[2], String(month)] };
  };
  /** One entry's boxes from the profile (keep: only the empty ones). Whether the required ones took. */
  const fillEntry = async (kind, fields, entry, keep) => {
    const byLabel = (pattern) => fields.find((field) => pattern.test(String(field.label || '')));
    let ok = true;
    if (kind === 'skills') {
      ok = await fill(byLabel(/skill/i) || fields[0], [entry.skill], keep);
    } else if (kind === 'experience') {
      const { job } = entry;
      ok = await fill(byLabel(/employer|company/i), [job.companyName], keep);
      ok = (await fill(byLabel(/job title|^title|position/i), [job.jobTitle], keep)) && ok;
      const country = byLabel(/country/i);
      const dates = fields.filter((field) => field !== country && ['combobox', 'select', 'menu'].includes(field.kind)
        && (!field.label || /month|year|date/i.test(field.label)));
      const start = dateParts(job.startDate);
      const end = dateParts(job.endDate);
      if (start) { await fill(dates[0], start.month, keep); await fill(dates[1], [start.year], keep); }
      const current = fields.find((field) => field.kind === 'checkbox' && /current/i.test(String(field.label || '')));
      if (job.isCurrent && current) await fill(current, [true], keep);
      else if (end) { await fill(dates[2], end.month, keep); await fill(dates[3], [end.year], keep); }
      const parts = String(job.location || '').split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length) {
        const place = parts.at(-1);
        await fill(country, [COUNTRY_WORDS[place.toLowerCase()] || place, place], keep);
        if (parts.length > 1) await fill(byLabel(/city|town/i), [parts[0]], keep);
      }
      const text = helpers.resumeBullets(resumeText, job.companyName) || job.description || '';
      if (text) await fill(byLabel(/responsib|description|duties|summary/i), [text.slice(0, 2000)], keep);
    } else if (kind === 'education') {
      const { school } = entry;
      const degree = String(school.degree || '');
      await fill(byLabel(/degree|qualification/i), [degree, degree.replace(/\s*degree$/i, ''), degree.replace(/'s\b.*$/i, '')], keep);
      await fill(byLabel(/major|field|subject/i), [school.fieldOfStudy], keep);
      ok = await fill(byLabel(/institution|school|university|college/i), [school.institution], keep);
    }
    return ok;
  };
  const entries = {
    skills: () => helpers.resumeSkills(resumeText, 15).map((skill) => ({ name: skill, skill })),
    experience: () => (details.experiences || []).map((job, key) => ({ key, name: [job.jobTitle, job.companyName].filter(Boolean).join(' at '), job, words: [job.companyName, job.jobTitle, job.startDate?.slice(0, 4)] })),
    // A degree word on the card (Oracle shows the degree once it has one) and the years tell two
    // entries of one school apart.
    education: () => (details.educations || []).map((school, key) => ({ key, name: school.institution || school.degree || 'school', school,
      words: [school.institution, school.fieldOfStudy, String(school.degree || '').replace(/'s\b.*$/i, ''), school.startDate?.slice(0, 4), school.endDate?.slice(0, 4)] })),
  };

  // 1. Entries the import made but the site flags ("Fields to fix"): opened with their Edit, the empty
  // boxes filled from the profile entry the card names (else the only one), saved with SAVE.
  for (const { kind, cards, flagged } of all) {
    if (!cards || !flagged || kind === 'skills') continue;
    await say(`${title(kind)}: completing the entries marked "Fields to fix"…`);
    let left = 0;
    // Each profile entry completes one card at most (a Bachelor's and a Master's at the same school
    // are two cards): the card goes to the unused entry naming most of what it shows.
    const usedEntries = new Set();
    for (let index = 0; index < flagged; index += 1) {
      const opened = await form((k) => globalThis.__qtsApplyForm.openFlaggedCard(k), [kind]);
      if (!opened?.fields?.length) { left += 1; continue; }
      const card = squash(opened.text);
      const choices = entries[kind]().filter((item) => !usedEntries.has(item.name + item.key));
      const score = (item) => item.words.filter((word) => squash(word) && card.includes(squash(word))).length;
      const best = choices.map((item) => ({ item, points: score(item) })).sort((a, b) => b.points - a.points)[0];
      const entry = best && (best.points > 0 || choices.length === 1) ? best.item : null;
      if (entry) usedEntries.add(entry.name + entry.key);
      if (entry) await fillEntry(kind, opened.fields, entry, true);
      await form((k) => globalThis.__qtsApplyForm.closeSectionForm(k, true), [kind]);
      if (!entry || await form((k) => globalThis.__qtsApplyForm.sectionFormOpen(k), [kind])) {
        await form((k) => globalThis.__qtsApplyForm.closeSectionForm(k, false), [kind]);
        left += 1;
      }
    }
    if (left) problem(`${title(kind)}: ${left} ${left === 1 ? 'entry needs' : 'entries need'} a missing field ("Fields to fix"): open ${left === 1 ? 'it' : 'them'} with Edit and complete.`);
  }

  // 2. Sections the import left empty.
  const sections = all.filter((section) => !section.cards);
  if (!sections.length) return;
  // The sections come from the résumé import only (the Manager's choice of 2026-11-22: PDFs first, no
  // entry added one by one): one the import left empty is listed for the Manager.
  if (!ADD_CARDS_BY_HAND) {
    for (const { kind } of sections) problem(`${title(kind)}: empty after the résumé import; add ${kind === 'skills' ? 'the skills' : 'the entries'} by hand.`);
    return;
  }
  for (const { kind } of sections) {
    await say(`${title(kind)}: adding the entries…`);
    const skipped = [];
    for (const entry of entries[kind]()) {
      const fields = await form((k) => globalThis.__qtsApplyForm.openSectionForm(k), [kind]);
      if (!Array.isArray(fields) || !fields.length) { skipped.push(entry.name); continue; }
      const ok = await fillEntry(kind, fields, entry, false);
      if (ok) await form((k) => globalThis.__qtsApplyForm.closeSectionForm(k, true), [kind]);
      if (!ok || await form((k) => globalThis.__qtsApplyForm.sectionFormOpen(k), [kind])) {
        await form((k) => globalThis.__qtsApplyForm.closeSectionForm(k, false), [kind]);
        skipped.push(entry.name);
      }
    }
    if (skipped.length) problem(`${title(kind)}: not added (the site did not take them): ${skipped.slice(0, 12).join('; ')}. Add them by hand.`);
  }
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

async function fillApiFormPageBody(tabId, application, keepAlive, step, options, stepAttempts) {
  const helpers = self.__qtsApplyAnswers;
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
    timings.checks = Date.now() - checksStarted;
    const report = stepReport(step, metFields, used, problems, stepAttempts, { ...timings, total: Date.now() - stepStarted }, (application.aiCalls || 0) - aiCallsBefore);
    diag('step-report', report);
    const left = unresolved.filter((entry) => !(HAS_WORDS.test(entry.label || '') && used[entry.label]));
    const notes = [
      emptiedCount ? `Removed ${emptiedCount} old value${emptiedCount === 1 ? '' : 's'} before filling.` : '',
      ...corrections.map((entry) => `"${entry.label}": the AI wrote "${entry.said.slice(0, 60)}"; QTS used the profile's "${entry.used.slice(0, 60)}".`),
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
    documents = await fetchApplyDocuments(application.attemptId);
    if (!self.__qtsSiteSessions.documentsBelong(documents.paths, application.candidate)) {
      documents = null;
      throw new ApplyStop(`The PDFs saved for this job are not named after ${candidateNameOf(application)}, so QTS did not attach them. Check the job's documents.`, { skip: false });
    }
    application.documentsFolder = documents.folder;
    application.applyDocuments = documents;
    return documents;
  };

  /**
   * Attaches what the plan's file boxes need: the résumé to an "Autofill from resume" box (once per
   * application, never to a box already holding a file: a second send makes the site read it again and
   * reset what it filled), then the résumé and cover letter. A box already holding a file keeps it (the
   * clean took every old file off, so it is this application's). True when anything went up.
   */
  const attachDocuments = async (plan) => {
    const uploadStarted = Date.now();
    if (plan.autofillUpload || plan.uploads.length) await say('Attaching the documents…');
    let uploaded = false;
    const holds = (id) => inForm(tabId, (box) => globalThis.__qtsApplyForm.uploadHolds(box), [id]).catch(() => false);
    if (plan.autofillUpload && !application.resumeAutofillTried && await holds(plan.autofillUpload.id)) {
      application.resumeAutofillTried = true;
    }
    if (plan.autofillUpload && !application.resumeAutofillTried) {
      const ready = await needDocuments();
      application.resumeAutofillTried = true;
      const outcome = await fillAndCheck(tabId, plan.autofillUpload, { file: 'resume', source: 'documents' }, { ...ready.resume, mimeType: 'application/pdf' }, seen);
      if (outcome.ok) {
        application.siteFilledFromResume = true;
        application.uploadedFileNames.add(ready.resume.filename);
        uploaded = true;
        await waitForSiteFill(tabId);
      } else problem(outcome.error || 'Check the resume parser upload before continuing.', plan.autofillUpload, 'upload');
    }
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
      if (outcome.gone) continue;
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
  // An employment step with no entry yet shows no box at all (Dropbox): its first entry is opened.
  const employmentSite = EMPLOYMENT_SITES.test(self.__qtsSiteSessions.hostOf((await chrome.tabs.get(tabId).catch(() => null))?.url || '') || '');
  if (!quick && employmentSite) {
    for (const kind of ['employment', 'education']) {
      if ((await inForm(tabId, (k) => globalThis.__qtsApplyForm.entryCount(k), [kind]).catch(() => -1)) === 0) {
        await inForm(tabId, (k) => globalThis.__qtsApplyForm.addEntry(k), [kind]).catch(() => null);
      }
    }
  }
  if (!quick) await waitForFormFields(tabId, { minFields: step > 1 || application.tabMoved ? 1 : 3, pollMs: 300, steadyPolls: 2 });
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

  // Boxes met on an earlier pass are the Manager's now: never emptied or filled again (only their
  // own Fill again or Ask AI again goes back over them).
  const metBefore = new Set(application.cleanedBoxes);

  // 1. Clean, once per page: nothing left from anyone before (the Manager's choice of 2026-11-22,
  // replacing "nothing emptied" of 2026-11-17). The first time QTS meets a page of this application it
  // empties every box (text, choices, ticks) and takes off every attached file (an earlier job's
  // résumé the site kept included); later passes on the page empty nothing. Files QTS itself attached
  // in this application stay. QTS notes the boxes it has met, so a box met before is never emptied again.
  await throwIfStopped();
  application.uploadedFileNames ||= new Set();
  const cleanStarted = Date.now();
  const cleaned = quick ? { keys: [], boxKeys: [], stuck: [], emptied: [] } : await inForm(tabId, (given) => globalThis.__qtsApplyForm.emptyOldAnswers(given), [{
    known: [...application.cleanedBoxes],
    seedOnly: application.seedCleanOnce === true,
    values: true,
    keepValues: [application.job?.title, application.job?.company].filter(Boolean),
    uploads: true,
    keepFiles: [...application.uploadedFileNames],
  }]).catch(() => null);
  application.seedCleanOnce = false;
  timings.clean = Date.now() - cleanStarted;
  if (!cleaned) {
    problem('QTS could not empty this form, so it filled nothing. Clear what is in it, then choose Fill again.', null, 'field', true);
    canAskAgain = true;
    return finish({ checks: false });
  }
  for (const key of cleaned.keys || []) application.cleanedBoxes.add(key);
  // Card sections (Skills, Experience, Education): their old cards go on the page's first visit, before
  // this job's résumé is uploaded to the site's "Import your profile from resume", which fills them again.
  // sectionsEmpty: false while old Skills / Experience / Education entries are still on the page: the résumé import
  // waits (it would add this job's entries beside them).
  let sectionsEmpty = true;
  if (cleaned.newPage && !quick && !options.onlyEmpty) {
    sectionsEmpty = await deleteOldCards(tabId, problem, say).catch((error) => { problem(`The old profile entries could not be removed: ${error?.message || error}`); return false; });
  }
  // 1b. The documents, before any answer (the Manager's order of 2026-11-22: empty, clean, upload, fill):
  // "Import your profile from resume" first, then the résumé and cover-letter boxes. A site that
  // rebuilds its form from the résumé (Oracle) has finished before QTS reads a single question.
  let uploadedFirst = false;
  if (!quick && !options.onlyEmpty) {
    // Passes: Oracle shows its résumé and cover-letter boxes only after the import, so the page is
    // looked at again after each pass that attached something, until no document box is left.
    for (let pass = 0; pass < 3; pass += 1) {
      await throwIfStopped();
      const shown = (await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist({ fullNotes: true })).catch(() => [])) || [];
      const files = shown.filter((field) => field.kind === 'file' && !field.hidden && !field.disabled);
      if (!files.length) break;
      const filePlan = helpers.planApiFields(files, application.candidate, application.savedAnswers, answerContext(application));
      if (filePlan.uploads.length || filePlan.autofillUpload) await needDocuments();
      // The import only once every old entry is gone (the résumé and cover letter boxes go up anyway).
      if (!sectionsEmpty && filePlan.autofillUpload) {
        problem(`"${filePlan.autofillUpload.label}" was not used: old entries are still in the sections above. Remove them, then click Fill again.`, filePlan.autofillUpload, 'upload', true);
        filePlan.autofillUpload = null;
      }
      const attached = await attachDocuments(filePlan);
      if (!attached) break;
      uploadedFirst = true;
      await settle(600, 6000);
      // The site rebuilds its form after an import or upload (Oracle: "Uploading…", fields loading):
      // looked at again only once it is done and its boxes are there and steady (at most 90 s: the form
      // is hidden while a file is still uploading, and a cover letter can take a minute).
      await say('Waiting for the site to finish reading the documents…');
      let steady = 0;
      let last = -1;
      // As many boxes as the page showed before (at most 3): a page whose only box is the upload
      // (Dropbox's first step) is not waited on; one that hid its form while uploading (Oracle) is.
      const boxesBefore = Math.min(3, shown.filter((field) => !field.hidden && !field.disabled && field.kind !== 'file').length);
      for (let waited = 0; waited < 90000 && steady < 3; waited += 500) {
        await sleep(500);
        const look = await inForm(tabId, () => ({
          busy: globalThis.__qtsApplyForm.pageUploadBusy() || /fields-loading/i.test(document.body?.innerText || ''),
          boxes: globalThis.__qtsApplyForm.scanForAssist().filter((field) => !field.hidden && !field.disabled && field.kind !== 'file').length,
        })).catch(() => null);
        steady = look && !look.busy && look.boxes >= boxesBefore && look.boxes === last ? steady + 1 : 0;
        last = look?.boxes ?? -1;
      }
    }
  }
  // The employment step (Dropbox): one entry per job of the profile.
  if (!quick && !options.onlyEmpty && employmentSite) {
    await fillRepeatedEntries(tabId, application, seen, problem, say).catch((error) => problem(`Employment and education could not be filled: ${error?.message || error}`));
  }
  // An entry form the site opened by itself (Oracle opens an empty "Add Education" once a required
  // section has no entries): closed with its CANCEL, so the imported entries show.
  if (!quick && !options.onlyEmpty) {
    for (const kind of ['skills', 'experience', 'education']) {
      if (await inForm(tabId, (k) => globalThis.__qtsApplyForm.sectionFormOpen(k), [kind]).catch(() => false)) {
        await inForm(tabId, (k) => globalThis.__qtsApplyForm.closeSectionForm(k, false), [kind]).catch(() => false);
      }
    }
  }
  // (Ask AI goes over every box still empty, reviewed or not.)
  const reviewed =new Set(options.again || options.onlyEmpty ? [] : (cleaned.boxKeys || []).filter(([, key]) => metBefore.has(key)).map(([id]) => id));
  for (const box of cleaned.stuck || []) application.stuckBoxes.set(box.id ?? box.label, box);
  emptiedCount = (cleaned.emptied || []).length;
  if (!quick) await settle(300, 1500);

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
      if (field.hidden || field.disabled || field.unrelated || field.account || field.managerChanged || field.trackingValue || field.cardForm || reviewed.has(field.id) || seen.has(field.id)) continue;
      if (!options.onlyEmpty && await stillAnswered(field)) {
        seen.add(field.id);
        used[field.label].fieldId = field.id;
        continue;
      }
      fresh.push(field);
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
    const unread = plan.ai.filter((entry) => !entry.check).map((entry) => fresh.find((field) => field.id === entry.field.id)).filter(Boolean)
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
    if (plan.uploads.length || plan.autofillUpload) await needDocuments();

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
    if (toAsk.length && (options.noAi || aiAsked)) {
      // The AI is asked only when the Manager clicks Ask AI, and once per click. Until then a question
      // the profile states takes the profile's value; the rest stay empty, listed for the Manager.
      for (const { field, check } of toAsk) {
        if (check) answers[field.id] = { ...check };
        else leave(field, aiAsked ? 'appeared after the AI was asked: click Ask AI again, or fill it yourself' : 'not asked yet: click Ask AI, or fill it yourself');
      }
    } else if (toAsk.length) {
      aiAsked = true;
      let failure = null;
      let replied = {};
      let reviewed = [];
      if (!failure) {
        await throwIfStopped();
        application.onAi?.({ state: 'asking', provider: 'AI', focused: false });
        await say(`Asking the AI about ${toAsk.length} question${toAsk.length === 1 ? '' : 's'}…`);
        const aiStarted = Date.now();
        try {
          replied = await askAiForAnswers(application, toAsk.map((entry) => entry.field), keepAlive);
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
        if (outcome.ok || outcome.gone) break;
        const next = { ...first, value };
        const tried = await fillAndCheck(tabId, field, next, null, seen);
        if (tried.ok || tried.gone) chosen = next;
        outcome = tried.ok || tried.gone || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
      }
      if (!outcome.ok && !outcome.gone && entry?.check && first.source === 'ai') {
        const fallback = forField(field, { ...entry.check });
        const tried = await fillAndCheck(tabId, field, fallback, null, seen);
        if (tried.ok || tried.gone) chosen = fallback;
        outcome = tried.ok || tried.gone || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
      }
      // The profile's fact in the words of the choices the field showed ("Rumunia" for "Romania").
      const fact = chosen.fact || entry?.check?.fact;
      const meant = chosen.intended ?? entry?.check?.intended ?? entry?.check?.value;
      if (!outcome.ok && !outcome.gone && fact && meant && outcome.choices?.length) {
        const same = helpers.sameFactOption(fact, String(meant), outcome.choices);
        if (same) {
          const converted = { ...chosen, value: same, intended: String(meant) };
          const tried = await fillAndCheck(tabId, field, converted, null, seen);
          if (tried.ok || tried.gone) chosen = converted;
          outcome = tried;
        }
      }
      // Decided again with the choices the list showed (planned before they were known): "Are you
      // Hispanic/Latino?" Yes / No from the profile's ethnicity, a disability list in its own words.
      if (!outcome.ok && !outcome.gone && outcome.choices?.length && chosen.source !== 'ai') {
        const known = { ...field, ...choicesSeen(field, outcome.choices), options: outcome.choices };
        const again = helpers.planApiFields([known], application.candidate, application.savedAnswers, answerContext(application));
        const next = again.code.find((item) => item.field.id === field.id)?.answer || again.ai.find((item) => item.field.id === field.id)?.check;
        if (next && answerText(next.value) !== answerText(chosen.value)) {
          const retry = forField(field, next);
          const tried = await fillAndCheck(tabId, field, retry, null, seen);
          if (tried.ok || tried.gone) chosen = retry;
          outcome = tried.ok || tried.gone || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
        }
      }
      return { outcome, chosen };
    };
    const issues = [];
    const later = [];
    for (const field of fresh) {
      await throwIfStopped();
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
      if (outcome.gone) continue;
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
      if (again.outcome.ok || again.outcome.gone) { if (again.outcome.ok) record(field, again.chosen); continue; }
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
    // Card sections the résumé import left empty: QTS adds their cards (first visit only).
    if (cleaned?.newPage && !quick && !options.onlyEmpty) {
      await fillCardSections(tabId, application, seen, problem, say).catch((error) => problem(`The profile sections could not be filled: ${error?.message || error}`));
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
          if (outcome.gone) continue;
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
};
