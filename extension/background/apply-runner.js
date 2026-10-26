// Apply: takes Generation-completed jobs from the server one at a time, fills their application
// forms in Apply's own window, and submits exactly once, only after the server allows it. Loaded by
// the service worker with importScripts; it uses the worker's shared helpers (workerApiRequest,
// getTab, sleep, tabOwnership, the ChatGPT helpers) at call time.
//
// Rules (docs/architecture.md): facts come only from the candidate's profile and saved answers;
// a required fact that is missing stops the application instead of being guessed; open questions
// go to ChatGPT once per page with one fix-up; CAPTCHAs and logins go to the Manager; after Submit
// the page is watched for up to 2 minutes; an unconfirmed or failed application keeps a screenshot
// PDF in this computer's Downloads, in the job's Generation folder.

const APPLY_QUEUE_ALARM = 'qts-apply-queue';
const APPLY_WINDOW_KEY = 'qtsApplyWindowId';
const APPLY_CHAT_TAB_KEY = 'qtsApplyChatTab';
// Test mode: fills everything, then stops right before Submit and gives the job back.
const APPLY_DRY_RUN_KEY = 'qtsApplyDryRun';
const APPLY_HEARTBEAT_MS = 30 * 1000;
const APPLY_FORM_WAIT_MS = 25 * 1000;
const APPLY_RESULT_WAIT_MS = 2 * 60 * 1000;
const APPLY_APPLICATIONS_PER_CHAT_TAB = 10;
const APPLY_MAX_FORM_PAGES = 5;
// Questions a page shows only after earlier answers (Teamtailor unlocks its form after the requirement
// questions) are filled in further rounds, until no new question appears.
const APPLY_FILL_ROUNDS = 5;
// Clicks to reach the form from a job page: "Apply for this job", then perhaps "Apply manually".
const APPLY_START_STEPS = 3;
const APPLY_START_WAIT_MS = 15 * 1000;
let applyLoopRunning = false;

class ApplyStop extends Error {
  // A reason to give the job back before Submit: skip=true leaves it for the Manager for good.
  constructor(message, { skip = true, keepTab = true, dryRun = false } = {}) {
    super(message);
    this.name = 'ApplyStop';
    this.skip = skip;
    this.dryRun = dryRun;
    this.keepTab = keepTab;
  }
}

async function isApplyOn() {
  const stored = await chrome.storage.local.get(EXTENSION_STATUS_KEY);
  return stored[EXTENSION_STATUS_KEY] === 'apply';
}

async function syncApplyQueueAlarm() {
  if (await isApplyOn()) {
    if (!(await chrome.alarms.get(APPLY_QUEUE_ALARM))) {
      await chrome.alarms.create(APPLY_QUEUE_ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    }
  } else {
    await chrome.alarms.clear(APPLY_QUEUE_ALARM);
  }
}

async function notifyApply(message) {
  await new Promise((resolve) => {
    chrome.notifications.create(
      { type: 'basic', iconUrl: chrome.runtime.getURL('assets/icon128.png'), title: 'QTS Apply', message: String(message).slice(0, 300) },
      () => resolve(),
    );
  });
}

/** Apply's own window, opened without taking focus; every tab in it belongs to Apply. */
async function applyWindowId() {
  const stored = await chrome.storage.session.get(APPLY_WINDOW_KEY);
  const existing = stored[APPLY_WINDOW_KEY];
  if (Number.isInteger(existing)) {
    const window = await chrome.windows.get(existing).catch(() => null);
    if (window) return window.id;
  }
  const window = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'normal' });
  await tabOwnership.markWindow(window.id, 'apply');
  await chrome.storage.session.set({ [APPLY_WINDOW_KEY]: window.id });
  return window.id;
}

async function openApplyTab(url) {
  const windowId = await applyWindowId();
  const tab = await chrome.tabs.create({ windowId, url, active: true });
  await tabOwnership.markTab(tab.id, 'apply');
  // The about:blank tab the window opened with is no longer needed.
  for (const other of await chrome.tabs.query({ windowId })) {
    if (other.id !== tab.id && other.url === 'about:blank') chrome.tabs.remove(other.id).catch(() => {});
  }
  return tab;
}

/** Apply's ChatGPT tab in its window, reused for up to ten applications with a new chat each. */
async function applyChatTab() {
  const stored = await chrome.storage.session.get(APPLY_CHAT_TAB_KEY);
  const saved = stored[APPLY_CHAT_TAB_KEY];
  if (saved && Number.isInteger(saved.id) && saved.uses < APPLY_APPLICATIONS_PER_CHAT_TAB && await getTab(saved.id)) {
    await startNewChatGptChat(saved.id);
    await chrome.storage.session.set({ [APPLY_CHAT_TAB_KEY]: { id: saved.id, uses: saved.uses + 1 } });
    return saved.id;
  }
  if (saved?.id != null) chrome.tabs.remove(saved.id).catch(() => {});
  const windowId = await applyWindowId();
  const tab = await chrome.tabs.create({ windowId, url: 'https://chatgpt.com/', active: false, pinned: true });
  await tabOwnership.markTab(tab.id, 'apply');
  await ensureChatGptReady(tab.id);
  await chrome.storage.session.set({ [APPLY_CHAT_TAB_KEY]: { id: tab.id, uses: 1 } });
  return tab.id;
}

async function waitForTabComplete(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getTab(tabId))?.status === 'complete') return true;
    await sleep(300);
  }
  return false;
}

async function inForm(tabId, func, args = []) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/apply-form.js'] });
  const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args });
  return result?.result;
}

/** The form's fields once the page has built them (Ashby fetches its form after loading). */
async function waitForFormFields(tabId) {
  const deadline = Date.now() + APPLY_FORM_WAIT_MS;
  let previous = -1;
  while (Date.now() < deadline) {
    const fields = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm()).catch(() => null);
    const visible = (fields || []).filter((field) => !field.hidden && !field.disabled);
    // Two scans in a row with the same number of fields: the form is built.
    if (visible.length > 2 && visible.length === previous) return fields;
    previous = visible.length;
    await sleep(1000);
  }
  throw new ApplyStop('The application form did not appear on the page.');
}

/** An application form is showing: an email field next to a name field or an upload. */
async function applicationFormShown(tabId) {
  const fields = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm()).catch(() => null);
  const visible = (fields || []).filter((field) => !field.hidden && !field.disabled);
  return visible.some((field) => field.kind === 'email' || /e-?mail/i.test(field.label))
    && visible.some((field) => field.kind === 'file' || /\bname\b/i.test(field.label));
}

/**
 * From a job page to its application form, the way a person gets there: click "Apply" (and a
 * following "Apply manually"), follow a new tab or page, or open an embedded job-site form.
 * onTab hears about a new tab so the caller keeps the right one. Returns the tab with the form.
 */
async function reachApplicationForm(tab, onTab) {
  const clicked = [];
  for (let step = 0; step < APPLY_START_STEPS; step += 1) {
    await inForm(tab.id, () => globalThis.__qtsApplyForm.declineCookies()).catch(() => false);
    // Pages often build their content after loading; give the form a few seconds to appear.
    for (let waited = 0; waited < 6000; waited += 1000) {
      if (await applicationFormShown(tab.id)) return tab;
      await sleep(1000);
    }
    const blockers = await inForm(tab.id, () => globalThis.__qtsApplyForm.detectBlockers()).catch(() => []);
    if (blockers?.includes('login')) throw new ApplyStop('The site asks to sign in or create an account.');
    const knownTabs = new Set((await chrome.tabs.query({})).map((entry) => entry.id));
    const start = await inForm(tab.id, (skip) => globalThis.__qtsApplyForm.clickStart(skip), [clicked]).catch(() => null);
    if (start?.email) throw new ApplyStop('This job takes applications by email; apply by hand.');
    if (!start?.ok) break;
    if (start.frameUrl) {
      await chrome.tabs.update(tab.id, { url: start.frameUrl });
      await sleep(500);
      await waitForTabComplete(tab.id, 45 * 1000);
      continue;
    }
    clicked.push(start.text);
    // The button may open a new tab, load another page, or show the form on this one.
    for (let waited = 0; waited < APPLY_START_WAIT_MS; waited += 1000) {
      await sleep(1000);
      const opened = (await chrome.tabs.query({})).find((entry) => !knownTabs.has(entry.id) && entry.openerTabId === tab.id);
      if (opened) {
        const jobPage = tab;
        tab = opened;
        onTab(tab);
        await tabOwnership.markTab(tab.id, 'apply');
        chrome.tabs.remove(jobPage.id).catch(() => {});
        await waitForTabComplete(tab.id, 45 * 1000);
        break;
      }
      if (await applicationFormShown(tab.id)) return tab;
    }
  }
  if (await applicationFormShown(tab.id)) return tab;
  throw new ApplyStop('No application form or Apply button was found on the job page; apply by hand.');
}

async function readComboboxOptions(tabId, fields) {
  for (const field of fields) {
    if (field.kind !== 'combobox' || field.hidden || field.disabled || field.options?.length) continue;
    field.options = await inForm(tabId, (id) => globalThis.__qtsApplyForm.readComboboxOptions(id), [field.id]).catch(() => []);
  }
}

/** ChatGPT's checked answers for a page's open questions, with one fix-up for unusable ones. */
async function askChatGptForAnswers(application, fields, keepAlive) {
  const chatTabId = await applyChatTab();
  const marker = application.attemptId;
  const helpers = self.__qtsApplyAnswers;
  const active = { local: () => {}, server: keepAlive };
  const first = helpers.buildAnswerPrompt({
    job: application.job,
    candidate: application.candidate,
    documentsJson: application.job.documentsJson,
    fields,
    exchangeRates: application.exchangeRates,
    today: new Date(),
  });
  await sendGenerationPromptWithRecovery(chatTabId, self.__qtsGenerationChatGpt.buildTaskPrompt(first, marker));
  let reply = await waitForGenerationAnswer(chatTabId, marker, active);
  let { answers, invalid } = helpers.parseAnswerReply(reply, fields);
  const needed = invalid.filter((entry) => fields.find((field) => field.id === entry.id)?.required);
  if (needed.length) {
    const retryFields = fields.filter((field) => needed.some((entry) => entry.id === field.id));
    await sendGenerationPromptWithRecovery(chatTabId, self.__qtsGenerationChatGpt.buildTaskPrompt(helpers.buildFixPrompt(needed), marker));
    reply = await waitForGenerationAnswer(chatTabId, marker, active);
    const retried = helpers.parseAnswerReply(reply, retryFields);
    answers = { ...answers, ...retried.answers };
    invalid = retried.invalid;
    if (invalid.length) {
      throw new ApplyStop(`ChatGPT could not answer: ${invalid.map((entry) => `${entry.label} (${entry.reason})`).join('; ')}`.slice(0, 480));
    }
  }
  return answers;
}

async function fetchApplyDocuments(attemptId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await workerApiRequest('GET', `/api/extension/apply/documents?attemptId=${encodeURIComponent(attemptId)}`);
    if (response.success === true) return response.documents;
    if (response.retry !== true) throw new ApplyStop(response.message || 'The résumé could not be prepared.', { skip: false });
    await sleep(5000);
  }
  throw new ApplyStop('The résumé could not be printed right now; the job goes back to the list.', { skip: false });
}

/**
 * Fills one page in rounds: each round answers the questions not seen before, in page order, then
 * looks again for questions those answers revealed. Returns the answers used, for the evidence.
 */
async function fillFormPage(tabId, application, keepAlive) {
  const helpers = self.__qtsApplyAnswers;
  const used = {};
  const seen = new Set();
  let documents = null;
  for (let round = 0; round < APPLY_FILL_ROUNDS; round += 1) {
    const fields = round === 0
      ? await waitForFormFields(tabId)
      : await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm());
    if (round === 0) {
      await inForm(tabId, () => globalThis.__qtsApplyForm.declineCookies()).catch(() => false);
      const blockers = await inForm(tabId, () => globalThis.__qtsApplyForm.detectBlockers());
      if (blockers?.includes('login')) throw new ApplyStop('The site asks to sign in or create an account.');
    }
    const fresh = (fields || []).filter((field) => !field.hidden && !field.disabled && !seen.has(field.id));
    if (!fresh.length) break;
    await readComboboxOptions(tabId, fresh);
    const { answers, open, missing } = helpers.resolveFields(fresh, application.candidate, application.savedAnswers, {
      exchangeRates: application.exchangeRates,
      today: new Date(),
      coverLetterText: application.job.coverLetterText,
    });
    if (missing.length) {
      throw new ApplyStop(`Missing candidate facts: ${[...new Set(missing.map((entry) => entry.fact))].join(', ')}. Add them on the candidate's profile.`);
    }
    if (open.length) {
      if (application.aiMode !== 'chatgpt') throw new ApplyStop('Gemini answers for Apply come in a later release; ask your Super Admin to use ChatGPT mode.');
      Object.assign(answers, await askChatGptForAnswers(application, open, keepAlive));
    }
    if (!documents && Object.values(answers).some((answer) => answer.file)) {
      documents = await fetchApplyDocuments(application.attemptId);
      application.documentsFolder = documents.folder;
    }

    const failures = [];
    for (const field of fresh) {
      seen.add(field.id);
      const answer = answers[field.id];
      if (!answer) continue;
      const file = answer.file ? { ...documents[answer.file], mimeType: 'application/pdf' } : null;
      if (answer.file && !file?.base64) continue;
      const result = await inForm(tabId, (fieldId, value, upload) => globalThis.__qtsApplyForm.fillField(fieldId, value, upload), [field.id, answer.value ?? null, file]);
      if (!result?.ok && field.required) failures.push(field.label);
      if (!answer.file) used[field.label || field.id] = answer;
    }
    if (failures.length) throw new ApplyStop(`Could not fill: ${failures.join('; ')}`.slice(0, 480));
    // Let the page show the questions these answers unlock before looking again.
    await sleep(1000);
  }
  const errors = await inForm(tabId, () => globalThis.__qtsApplyForm.fieldErrors());
  if (errors?.length) throw new ApplyStop(`The form shows errors: ${errors.join('; ')}`.slice(0, 480));
  return used;
}

/** The application page as proof: a screenshot when possible, the page's text otherwise. */
async function captureApplyProof(tabId, application, caption) {
  const tab = await getTab(tabId);
  let pdf = null;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (char) => char.charCodeAt(0));
    if (bytes.length > 5000) pdf = self.__qtsApplyPdf.buildImagePdf(bytes, caption);
  } catch {
    // A covered or minimized window cannot be captured this way.
  }
  if (!pdf && chrome.debugger) {
    try {
      const target = { tabId };
      await chrome.debugger.attach(target, '1.3');
      try {
        const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 });
        const bytes = Uint8Array.from(atob(shot.data), (char) => char.charCodeAt(0));
        pdf = self.__qtsApplyPdf.buildImagePdf(bytes, caption);
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
      }
    } catch {
      // No debugger access; the page text stands in.
    }
  }
  if (!pdf) {
    const text = await inForm(tabId, () => globalThis.__qtsApplyForm.pageText()).catch(() => '');
    pdf = self.__qtsApplyPdf.buildTextPdf(`${caption} (page text; no picture could be taken)`, text || '(the page had no text)');
  }
  return pdf;
}

async function saveApplyProof(pdf, application) {
  const safe = (value) => String(value || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 80) || 'Job';
  const folder = application.documentsFolder || 'QTS_Resume/Apply';
  const filename = `${folder}/${safe(application.job.company)} - ${safe(application.job.title)} - submit screenshot.pdf`;
  await chrome.downloads.download({
    url: `data:application/pdf;base64,${self.__qtsApplyPdf.toBase64(pdf)}`,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  return filename;
}

async function browserName() {
  const stored = await chrome.storage.local.get('qtsBrowserName');
  return stored.qtsBrowserName || `Chrome · ${String(await self.__qtsApiWorker.workerBrowserKey()).slice(0, 4).toUpperCase()}`;
}

/** Waits up to 2 minutes for the page to confirm the application or show an error. */
async function watchApplyResult(tabId, application, keepAlive) {
  const startedAt = Date.now();
  let proof = null;
  while (Date.now() - startedAt < APPLY_RESULT_WAIT_MS) {
    await sleep(2000);
    keepAlive().catch(() => {});
    const outcome = await inForm(tabId, () => globalThis.__qtsApplyForm.pageOutcome()).catch(() => null);
    if (outcome?.result === 'confirmed') return { result: 'confirmed', source: 'page', evidence: outcome.evidence, proof: null };
    if (outcome?.result === 'error') {
      return { result: 'failed', evidence: outcome.evidence, proof: await captureApplyProof(tabId, application, `${application.job.company} — application failed`) };
    }
    // The picture is taken while the result page is fresh and kept only if nothing confirms it.
    if (!proof && Date.now() - startedAt > 5000) {
      proof = await captureApplyProof(tabId, application, `${application.job.company} — ${application.job.title} (not confirmed)`).catch(() => null);
    }
  }
  return { result: 'not_confirmed', evidence: null, proof };
}

async function reportApplyResult(application, report) {
  return workerApiRequest('POST', '/api/extension/apply/result', { attemptId: application.attemptId, ...report });
}

async function runApplication(application, recipe) {
  let lostClaim = false;
  const keepAlive = async () => {
    const renewed = await workerApiRequest('POST', '/api/extension/apply/heartbeat', { attemptId: application.attemptId });
    if (renewed._httpStatus === 409) lostClaim = true;
  };
  const heartbeat = setInterval(() => keepAlive().catch(() => {}), APPLY_HEARTBEAT_MS);
  let tab = null;
  let submitted = false;
  try {
    tab = await openApplyTab(recipe.formUrl);
    await waitForTabComplete(tab.id, 45 * 1000);
    if (recipe.findStart) tab = await reachApplicationForm(tab, (opened) => { tab = opened; });
    const answersUsed = {};
    for (let page = 0; page < APPLY_MAX_FORM_PAGES; page += 1) {
      if (!(await isApplyOn())) throw new ApplyStop('Apply was cancelled.', { skip: false, keepTab: false });
      if (lostClaim) throw new ApplyStop('This Chrome lost the application to another one.', { skip: false, keepTab: false });
      Object.assign(answersUsed, await fillFormPage(tab.id, application, keepAlive));
      const buttons = await inForm(tab.id, () => globalThis.__qtsApplyForm.buttons());
      if (buttons?.submit) break;
      if (!buttons?.next) {
        throw new ApplyStop(buttons?.submitDisabled
          ? 'The Submit button stays disabled: the candidate may not meet a requirement question, or a required answer was not accepted.'
          : 'Neither a single Submit nor a Next button was found.');
      }
      await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('next'));
      await sleep(2500);
    }
    const blockers = await inForm(tab.id, () => globalThis.__qtsApplyForm.detectBlockers());
    if (blockers?.includes('captcha')) throw new ApplyStop('A CAPTCHA must be solved by a person. Solve it in the Apply window and submit by hand.');
    const dryRun = (await chrome.storage.local.get(APPLY_DRY_RUN_KEY))[APPLY_DRY_RUN_KEY] === true;
    if (dryRun) throw new ApplyStop('Test mode: everything is filled; stopped before Submit.', { skip: false, dryRun: true });
    if (!(await isApplyOn())) throw new ApplyStop('Apply was cancelled.', { skip: false, keepTab: false });

    // Submit exactly once, and only with the server's permission for this Chrome's claim.
    const permission = await workerApiRequest('POST', '/api/extension/apply/submit-permission', { attemptId: application.attemptId });
    if (permission.granted !== true) throw new ApplyStop(permission.message || 'QTS did not allow Submit.', { skip: false, keepTab: false });
    submitted = true;
    const clicked = await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('submit'));
    if (!clicked?.ok) {
      await reportApplyResult(application, { result: 'failed', reason: 'The Submit button could not be clicked.' });
      return;
    }
    const outcome = await watchApplyResult(tab.id, application, keepAlive);
    let screenshotBrowserName = null;
    if (outcome.result !== 'confirmed' && outcome.proof) {
      await saveApplyProof(outcome.proof, application);
      screenshotBrowserName = await browserName();
    }
    const evidence = {
      answers: Object.fromEntries(Object.entries(answersUsed).map(([label, answer]) => [label.slice(0, 200), String(answer.value).slice(0, 2000)])),
      generationRunId: application.job.generationRunId,
      pageEvidence: outcome.evidence,
    };
    await reportApplyResult(application, {
      result: outcome.result,
      confirmationSource: outcome.result === 'confirmed' ? 'page' : null,
      reason: outcome.result === 'confirmed' ? null
        : outcome.result === 'failed' ? `The site showed an error after Submit: ${outcome.evidence}`
          : 'No confirmation on the page within 2 minutes.',
      screenshotBrowserName,
      evidence,
      answers: Object.entries(answersUsed)
        .filter(([, answer]) => answer.source === 'ai' || answer.source === 'saved')
        .map(([question, answer]) => ({ question, answer: String(answer.value), source: 'ai' })),
    });
    if (outcome.result === 'confirmed') await chrome.tabs.remove(tab.id).catch(() => {});
    else await notifyApply(`${application.job.company}: ${outcome.result === 'failed' ? 'the application failed' : 'submitted, but not confirmed'}. A screenshot was saved.`);
  } catch (error) {
    if (submitted) {
      // After Submit the job is never handed out again; record what is known.
      await reportApplyResult(application, {
        result: 'not_confirmed',
        reason: `Apply stopped after Submit: ${error instanceof Error ? error.message : 'unknown error'}`.slice(0, 480),
      }).catch(() => {});
      return;
    }
    const stop = error instanceof ApplyStop ? error : new ApplyStop(error instanceof Error ? error.message : 'Apply failed.', { skip: false });
    await workerApiRequest('POST', '/api/extension/apply/release', {
      attemptId: application.attemptId,
      reason: stop.message.slice(0, 480),
      skip: stop.skip,
      dryRun: stop.dryRun === true,
    }).catch(() => {});
    // Test mode deletes the attempt, so the same job would be claimed again at once: one test per click.
    if (stop.dryRun) await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
    if (stop.keepTab) {
      await notifyApply(`${application.job.company}: ${stop.message}`);
    } else if (tab?.id != null) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  } finally {
    clearInterval(heartbeat);
  }
}

/** Applies to ready jobs while Apply is on in this Chrome; the alarm calls it again when idle. */
async function processApplyQueue() {
  if (applyLoopRunning) return;
  applyLoopRunning = true;
  try {
    while (await isApplyOn()) {
      const claim = await workerApiRequest('POST', '/api/extension/apply/claim', {});
      if (claim.success !== true) {
        if ([401, 403, 426].includes(claim._httpStatus)) {
          await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
          await notifyApply(claim.message || 'Apply stopped.');
        }
        return;
      }
      const application = claim.application;
      if (!application) return;
      const recipe = self.__qtsApplyRecipes.recipeFor(application.job.url);
      if (recipe.unsupported) {
        await workerApiRequest('POST', '/api/extension/apply/release', {
          attemptId: application.attemptId,
          reason: recipe.unsupported,
          skip: true,
        });
        continue;
      }
      await runApplication(application, recipe);
    }
  } finally {
    applyLoopRunning = false;
  }
}

self.__qtsApplyRunner = { processApplyQueue, syncApplyQueueAlarm, APPLY_QUEUE_ALARM, APPLY_DRY_RUN_KEY };
