// Auto Apply with APIs (Super Admin's per-Manager switch): the same claims, panel and checklist as
// Auto Apply, in its own order, so a Manager without the switch is not touched by any of this.
//
//   clear a site last used for another candidate -> open -> whoever is signed in must be this candidate
//   -> empty the form -> read every question -> ask the AI once -> upload -> fill everything -> check
//   -> ask only about questions that appeared -> check the page against the candidate -> Manager submits
//
// Nothing is filled until the AI has answered. Loaded by the service worker after apply-runner.js,
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
    jobCompany: application.job.company || '',
    jobLocation: application.job.location || '',
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
      const uploadProblems = await inForm(tabId, async () => {
        const api = globalThis.__qtsApplyForm;
        const verified = await api.verifyUploads();
        const missing = api.emptyRequiredUploads().filter((entry) => !verified.some((issue) => issue.id === entry.id));
        return [...verified, ...missing.map((entry) => ({ ...entry, message: 'A required attachment is still missing. Check this upload manually.' }))];
      }).catch(() => [{ id: null, label: 'Attachments', message: 'Could not verify the attachments. Check them before continuing.' }]);
      for (const entry of uploadProblems) problem(entry.message, entry, 'upload');
      const listed = (entry) => problems.some((known) => known.fieldId && known.fieldId === entry.id);
      const stillEmpty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
      for (const entry of stillEmpty || []) if (!listed(entry)) problem(`Still empty: "${entry.label}".`, entry);
      const answeredIds = new Set(Object.values(used).map((answer) => answer.fieldId));
      for (const entry of unresolved) if (entry.required && !answeredIds.has(entry.id) && !listed(entry)) problem(`Still empty: "${entry.label}".`, entry);
      const shownNow = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm().filter((field) => !field.hidden).length).catch(() => null);
      if (metFields.size && shownNow === 0) problem('The application form is no longer shown on this page (it may have closed): open it again and check every answer before Submit.');
      const unread = await inForm(tabId, () => globalThis.__qtsApplyForm.unreadRequired()).catch(() => []);
      for (const entry of (unread || []).filter((item) => !listed(item))) {
        problem(entry.kind === 'unread' ? `QTS couldn't read this question — check it: "${entry.label}".` : `Still empty: "${entry.label}".`, entry);
      }
      const frames = await inForm(tabId, () => globalThis.__qtsApplyForm.unreadableFrames()).catch(() => []);
      for (const host of [...new Set(frames || [])]) problem(`Part of this page comes from ${host}, which QTS cannot read: check it for questions to answer.`);
      const errors = await inForm(tabId, () => globalThis.__qtsApplyForm.fieldErrors()).catch(() => []);
      for (const text of errors || []) problem(`The form shows: ${text}`);
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

  // 0. The page: a sign-in or human check is the Manager's, and nothing is sent or filled for it.
  await inForm(tabId, (context) => globalThis.__qtsApplyForm.setUploadContext(context), [{ attemptId: application.attemptId, step }]);
  await waitForFormFields(tabId, { minFields: step > 1 ? 1 : 3, pollMs: 300, steadyPolls: 2 });
  await inForm(tabId, () => globalThis.__qtsApplyForm.declineCookies()).catch(() => false);
  const page = await inForm(tabId, () => globalThis.__qtsApplyForm.classifyPage()).catch(() => null);
  if (['authentication_required', 'registration_required', 'verification_required'].includes(page?.type)) {
    problem('This page needs account or verification details. Enter passwords and one-time codes yourself, then use the site’s sign-in or continue control; QTS will go on at the next application page.', null, 'field', true);
    return finish({ checks: false });
  }
  const gate = await inForm(tabId, () => globalThis.__qtsApplyForm.pageGate()).catch(() => null);
  if (gate?.kind === 'bot_check') {
    problem(`Solve the human check ("${String(gate.text).slice(0, 60)}") yourself. QTS does not get around it.`, null, 'field', true);
    return finish({ checks: false });
  }
  await inForm(tabId, () => globalThis.__qtsApplyForm.revealLazySections()).catch(() => null);

  // Boxes met on an earlier pass are the Manager's now: never emptied or filled again (only their
  // own Fill again or Ask AI again goes back over them).
  const metBefore = new Set(application.cleanedBoxes);

  // 1. Clean, once per page: nothing left from anyone before.
  await throwIfStopped();
  await say('Removing anything already in the form…');
  const cleanStarted = Date.now();
  const cleaned = await inForm(tabId, (given) => globalThis.__qtsApplyForm.emptyOldAnswers(given), [{
    known: [...application.cleanedBoxes],
    seedOnly: application.seedCleanOnce === true,
    keepValues: [application.job?.title, application.job?.company].filter(Boolean),
    uploads: true,
    keepFiles: [application.applyDocuments?.resume?.filename, application.applyDocuments?.coverLetter?.filename].filter(Boolean),
  }]).catch(() => null);
  application.seedCleanOnce = false;
  timings.clean = Date.now() - cleanStarted;
  if (!cleaned) {
    problem('QTS could not empty this form, so it filled nothing. Clear what is in it, then choose Fill again.', null, 'field', true);
    canAskAgain = true;
    return finish({ checks: false });
  }
  for (const key of cleaned.keys || []) application.cleanedBoxes.add(key);
  const reviewed = new Set(options.again ? [] : (cleaned.boxKeys || []).filter(([, key]) => metBefore.has(key)).map(([id]) => id));
  for (const box of cleaned.stuck || []) application.stuckBoxes.set(box.id ?? box.label, box);
  emptiedCount = (cleaned.emptied || []).length;
  await settle(300, 1500);

  // Rounds: a question that appears after an earlier answer goes through the same steps, alone.
  for (let round = 0; round <= APPLY_FILL_ROUNDS; round += 1) {
    await throwIfStopped();
    // 2. Read every question the page shows now.
    const fields = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist()) || [];
    const fresh = [];
    for (const field of fields) {
      if (field.hidden || field.disabled || field.unrelated || field.account || field.managerChanged || field.trackingValue || reviewed.has(field.id) || seen.has(field.id)) continue;
      if (await stillAnswered(field)) {
        seen.add(field.id);
        used[field.label].fieldId = field.id;
        continue;
      }
      fresh.push(field);
    }
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
    const unread = plan.ai.filter((entry) => !entry.check).map((entry) => fresh.find((field) => field.id === entry.field.id)).filter(Boolean);
    const changedByLooking = await readComboboxOptions(tabId, unread, options.stop);
    for (const field of changedByLooking) problem(`Check "${field.label}": looking at its choices changed it; set it as it should be.`, field);
    // Decided again: the choices are known now.
    plan = helpers.planApiFields(fresh, application.candidate, application.savedAnswers, answerContext(application));
    timings.discovery += Date.now() - discoveryStarted;
    for (const { field, message } of plan.manager) {
      problem(message, field);
      leave(field);
    }

    // 3. One request for every question QTS may not answer by itself. Nothing has been filled yet.
    const answers = {};
    const asked = new Map();
    const toAsk = [];
    const verify = (entry, answer) => {
      const verdict = helpers.verifyApiAnswer(entry, answer, { evidence: application.factSources?.evidence || '' });
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
      const earlier = named && (used[field.label] || application.answerCache.get(field.label));
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
    if (toAsk.length) {
      let failure = options.noAi ? 'AI answers are turned off in this Chrome' : null;
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
        application.onAi?.({ state: 'done', provider: 'AI', focused: false });
      }
      if (failure) {
        // No answers, no filling: the form stays clean for "Ask AI again" or for the Manager.
        application.aiUnanswered = [];
        application.aiReview = [];
        canAskAgain = true;
        problem(`The AI did not answer (${failure}), so QTS filled nothing on this page. Use "Ask AI again", or fill the form yourself.`, null, 'field', true);
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

    // 4. Documents next: whatever a site reads from the résumé is overwritten by the answers below.
    await throwIfStopped();
    const uploadStarted = Date.now();
    if (plan.autofillUpload || plan.uploads.length) await say('Attaching the documents…');
    let uploaded = false;
    if (plan.autofillUpload && !application.resumeAutofillTried) {
      const ready = await needDocuments();
      application.resumeAutofillTried = true;
      const outcome = await fillAndCheck(tabId, plan.autofillUpload, { file: 'resume', source: 'documents' }, { ...ready.resume, mimeType: 'application/pdf' }, seen);
      if (outcome.ok) {
        application.siteFilledFromResume = true;
        uploaded = true;
        await waitForSiteFill(tabId);
      } else problem(outcome.error || 'Check the resume parser upload before continuing.', plan.autofillUpload, 'upload');
    }
    for (const { field, answer } of plan.uploads) {
      await throwIfStopped();
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
        application.stuckBoxes.delete(field.id);
        continue;
      }
      if (outcome.gone) continue;
      // A cover letter that could not be attached is typed instead where the site offers it.
      const typed = !outcome.manualUpload && answer.file === 'coverLetter' && application.job.coverLetterText
        && await inForm(tabId, (id) => globalThis.__qtsApplyForm.enterManually(id), [field.id]).catch(() => false);
      if (!typed && (field.required || outcome.manualUpload)) problem(outcome.manualUpload ? outcome.error : `The ${name} upload failed: add it by hand ("${field.label}") from the folder above.`, field, 'upload');
    }
    if (uploaded) await settle(400, 4000);
    timings.upload += Date.now() - uploadStarted;

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
      return { outcome, chosen };
    };
    const issues = [];
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
        problem(`Fill by hand: "${field.label}" — the site did not take "${answerText(chosen.value)}" (${outcome.error}).`, field);
      }
    }
    // One follow-up for what the site refused: its reason and the choices it showed go with it.
    if (issues.length && application.geminiTurns?.length && !options.noAi) {
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
  fillPage: fillApiFormPage,
  releaseSites: (attemptId) => siteHolds.release(attemptId),
};
