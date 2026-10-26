// Apply: takes Generation-completed jobs from the server one at a time, fills their application
// forms in Apply's own window, and submits exactly once, only after the server allows it. Loaded by
// the service worker with importScripts; it uses the worker's shared helpers (workerApiRequest,
// getTab, sleep, tabOwnership, the ChatGPT helpers) at call time.
//
// Rules (docs/architecture.md): the candidate's profile and saved answers fill what they can, each
// answer checked against what the site accepts; everything else, and any profile answer the site
// rejects, goes to ChatGPT with Super Admin's answer prompt, with one follow-up for answers that do
// not fit; CAPTCHAs and logins go to the Manager; after Submit
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
  const closed = await inForm(tab.id, () => globalThis.__qtsApplyForm.jobClosed()).catch(() => '');
  if (closed) throw new ApplyStop(`The job is closed on the site ("${closed}").`);
  const blockers = await inForm(tab.id, () => globalThis.__qtsApplyForm.detectBlockers()).catch(() => []);
  if (blockers?.includes('captcha')) throw new ApplyStop('The site shows a security check (CAPTCHA) before the job page; open it in the Apply window and apply by hand.');
  throw new ApplyStop('No application form or Apply button was found on the job page; apply by hand.');
}

// Real input through Chrome's debugger, for dropdowns that ignore simulated events (Greenhouse's
// React Select, BambooHR's menus). Attached once per application tab while it is filled; Chrome
// shows its "being debugged" bar meanwhile. Detached when the application ends.
const debuggerTabs = new Set();
chrome.debugger?.onDetach?.addListener((source) => debuggerTabs.delete(source.tabId));

async function debuggerSend(tabId, method, params = {}) {
  if (!debuggerTabs.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerTabs.add(tabId);
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function releaseDebugger(tabId) {
  if (debuggerTabs.delete(tabId)) await chrome.debugger.detach({ tabId }).catch(() => {});
}

async function realClick(tabId, { x, y }) {
  const at = { x, y, button: 'left', clickCount: 1 };
  await debuggerSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await debuggerSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
  await debuggerSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
}

async function realEscape(tabId) {
  const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
  await debuggerSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key }).catch(() => {});
  await debuggerSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key }).catch(() => {});
}

/** Opens a dropdown with a real click (typing into a search list first); false when it cannot. */
async function realOpen(tabId, field, typed = '') {
  const box = await inForm(tabId, (id) => globalThis.__qtsApplyForm.boxOf(id), [field.id]).catch(() => null);
  if (!box) return false;
  await inForm(tabId, () => globalThis.__qtsApplyForm.markShownChoices()).catch(() => false);
  await realClick(tabId, box);
  await sleep(500);
  if (typed) {
    // Text left by an earlier simulated attempt would join what is typed ("NoNo"): select it all and delete it.
    const selectAll = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 };
    const backspace = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
    for (const key of [selectAll, backspace]) {
      await debuggerSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key });
      await debuggerSend(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    }
    await debuggerSend(tabId, 'Input.insertText', { text: typed });
    await sleep(900);
  }
  return true;
}

/** A dropdown's choices read after opening it with a real click. */
async function readChoicesWithRealClick(tabId, field) {
  try {
    if (!(await realOpen(tabId, field))) return [];
    const choices = await inForm(tabId, () => globalThis.__qtsApplyForm.shownChoiceTexts()).catch(() => []);
    await realEscape(tabId);
    await sleep(200);
    return choices || [];
  } catch {
    return [];
  }
}

/** Picks a dropdown's choice with real clicks; { ok } or { ok: false, error }. */
async function pickWithRealClick(tabId, field, value) {
  const wanted = String([].concat(value)[0] ?? '').trim();
  if (!wanted) return { ok: false, error: 'no answer' };
  try {
    const typed = field.kind === 'combobox' ? wanted.split(',')[0].trim() : '';
    if (!(await realOpen(tabId, field, typed))) return { ok: false, error: 'the field is not on the screen' };
    const choice = await inForm(tabId, (text) => globalThis.__qtsApplyForm.choiceBox(text), [wanted]).catch(() => null);
    if (!choice) {
      await realEscape(tabId);
      return { ok: false, error: `the list has no "${wanted}"` };
    }
    await realClick(tabId, choice);
    await sleep(400);
    const shown = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownValue(id), [field.id]).catch(() => '');
    const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, '');
    // A field may show the whole choice or a part of it (a phone country picker shows "+48" for "Poland +48").
    const [now, picked] = [squash(shown), squash(choice.text)];
    return now && (now.includes(picked) || (now.length >= 2 && picked.includes(now)))
      ? { ok: true }
      : { ok: false, error: `it shows "${String(shown).slice(0, 80)}"` };
  } catch (error) {
    return { ok: false, error: `real clicks failed: ${error instanceof Error ? error.message : error}` };
  }
}

async function readComboboxOptions(tabId, fields) {
  for (const field of fields) {
    if (field.hidden || field.disabled || field.options?.length) continue;
    if (field.kind === 'combobox') {
      field.options = await inForm(tabId, (id) => globalThis.__qtsApplyForm.readComboboxOptions(id), [field.id]).catch(() => []);
      // A list that ignores simulated events (React Select) opens for a real click.
      if (!field.options?.length) field.options = await readChoicesWithRealClick(tabId, field);
    } else if (field.kind === 'menu' && field.lazy) {
      field.options = await inForm(tabId, (id) => globalThis.__qtsApplyForm.readMenuOptions(id), [field.id]).catch(() => []);
      if (!field.options?.length) field.options = await readChoicesWithRealClick(tabId, field);
      // An optional menu that shows no choices even then is left alone. A required one stays, so a
      // choice it cannot take stops the application rather than sending what it already shows.
      if (!field.options.length && !field.required) field.hidden = true;
    }
  }
}

/**
 * ChatGPT's checked answers for a page's open questions, asked with Super Admin's answer prompt
 * (or the default), with one fix-up for answers that do not fit their field.
 */
async function askChatGptForAnswers(application, fields, keepAlive) {
  // A new chat per round; its follow-up goes to the same chat so ChatGPT keeps the context.
  const chatTabId = await applyChatTab();
  application.chatTabId = chatTabId;
  const helpers = self.__qtsApplyAnswers;
  const first = helpers.buildAnswerPrompt({
    template: application.answerPrompt?.template,
    job: application.job,
    candidate: application.candidate,
    documentsJson: application.job.documentsJson,
    fields,
    exchangeRates: application.exchangeRates,
    today: new Date(),
    savedAnswers: application.savedAnswers,
  });
  const reply = await askChatGpt(chatTabId, application, first, keepAlive);
  const { answers, invalid } = helpers.parseAnswerReply(reply, fields);
  const needed = invalid.filter((entry) => fields.find((field) => field.id === entry.id)?.required);
  if (!needed.length) return answers;
  return { ...answers, ...(await askChatGptToFix(application, needed, fields, keepAlive)) };
}

async function askChatGpt(chatTabId, application, prompt, keepAlive) {
  const marker = application.attemptId;
  await sendGenerationPromptWithRecovery(chatTabId, self.__qtsGenerationChatGpt.buildTaskPrompt(prompt, marker));
  return waitForGenerationAnswer(chatTabId, marker, { local: () => {}, server: keepAlive });
}

/** The one follow-up: these answers did not fit (before filling) or the site rejected them (after). */
async function askChatGptToFix(application, problems, fields, keepAlive) {
  const helpers = self.__qtsApplyAnswers;
  const retryFields = fields.filter((field) => problems.some((entry) => entry.id === field.id));
  const reply = await askChatGpt(application.chatTabId, application, helpers.buildFixPrompt(problems, retryFields), keepAlive);
  const retried = helpers.parseAnswerReply(reply, retryFields);
  const stillWrong = retried.invalid.filter((entry) => retryFields.find((field) => field.id === entry.id)?.required);
  if (stillWrong.length) {
    throw new ApplyStop(`ChatGPT could not answer: ${stillWrong.map((entry) => `${entry.label} (${entry.reason})`).join('; ')}`.slice(0, 480));
  }
  return retried.answers;
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
 * Fills one field and checks the site took it: the value read back, then the site's own message
 * next to the field. { ok, error } or { gone } when the field left the page for good.
 */
async function fillAndCheck(tabId, field, answer, file, seen) {
  const fill = (fieldId) => inForm(tabId, (id, value, upload) => globalThis.__qtsApplyForm.fillField(id, value, upload), [fieldId, answer.value ?? null, file]);
  let fieldId = field.id;
  let result = await fill(fieldId);
  // The page may rebuild a field after another answer (BambooHR); find it again by its question.
  if (result?.error === 'The field is no longer on the page.') {
    const again = (await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm()) || [])
      .find((entry) => entry.label === field.label && entry.kind === field.kind && !entry.hidden);
    if (!again) return { gone: true };
    seen.add(again.id);
    fieldId = again.id;
    result = await fill(fieldId);
  }
  // A dropdown that ignored simulated events gets real clicks.
  if (!result?.ok && ['menu', 'combobox'].includes(field.kind) && !file) {
    const real = await pickWithRealClick(tabId, { ...field, id: fieldId }, answer.value);
    result = real.ok ? { ok: true } : { ok: false, error: `${result?.error || 'not taken'}; with real clicks: ${real.error}` };
  }
  if (!result?.ok) return { ok: false, error: result?.error || `it holds "${result?.value ?? ''}"` };
  const issue = await inForm(tabId, (id) => globalThis.__qtsApplyForm.fieldIssue(id), [fieldId]).catch(() => '');
  return issue ? { ok: false, error: issue } : { ok: true };
}

/**
 * Fills one page in rounds. Each round: the profile's answers first, each checked against what
 * the site accepts; then one ChatGPT request for the questions the profile could not answer and
 * the profile answers the site rejected (with the profile's value as a hint); then ChatGPT's
 * answers, with one follow-up for any the site rejects. A new round answers questions those
 * answers revealed. Returns the answers used, for the evidence.
 */
async function fillFormPage(tabId, application, keepAlive) {
  const helpers = self.__qtsApplyAnswers;
  const used = {};
  const seen = new Set();
  const uploaded = new Set();
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
    for (const field of fresh) seen.add(field.id);
    await readComboboxOptions(tabId, fresh);
    const { answers, open } = helpers.resolveFields(fresh, application.candidate, application.savedAnswers, {
      exchangeRates: application.exchangeRates,
      today: new Date(),
      coverLetterText: application.job.coverLetterText,
    });
    if (!documents && Object.values(answers).some((answer) => answer.file)) {
      documents = await fetchApplyDocuments(application.attemptId);
      application.documentsFolder = documents.folder;
    }

    // 1. The profile's answers, in page order; one the site does not take goes to ChatGPT.
    const failures = [];
    const rejected = [];
    for (const field of fresh) {
      const answer = answers[field.id];
      if (!answer) {
        // Text left from someone else is emptied; a referral or source code the site filled stays.
        if (field.filled && !open.some((entry) => entry.id === field.id) && !/referr|source|\bcode\b|token|utm/i.test(field.label)) {
          await inForm(tabId, (id) => globalThis.__qtsApplyForm.clearField(id), [field.id]).catch(() => false);
        }
        continue;
      }
      const file = answer.file ? { ...documents[answer.file], mimeType: 'application/pdf' } : null;
      if (answer.file && !file?.base64) continue;
      // Each document goes up once per page; a site may redraw its upload field after taking it.
      if (answer.file && uploaded.has(answer.file)) continue;
      const outcome = await fillAndCheck(tabId, field, answer, file, seen);
      if (outcome.gone) continue;
      if (outcome.ok) {
        if (answer.file) uploaded.add(answer.file);
        else used[field.label || field.id] = answer;
      } else if (answer.file || answer.source === 'documents') {
        if (field.required) failures.push(field.label);
      } else {
        rejected.push({
          ...field,
          hint: `The candidate's profile says "${answer.value}", but the site did not take it (${outcome.error}); give it in a form this field takes.`,
        });
      }
    }

    // 2. One ChatGPT request for the rest; 3. its answers, with one follow-up for any the site rejects.
    const toAsk = [...open, ...rejected];
    if (toAsk.length) {
      if (application.aiMode !== 'chatgpt') throw new ApplyStop('Gemini answers for Apply come in a later release; ask your Super Admin to use ChatGPT mode.');
      const aiAnswers = await askChatGptForAnswers(application, toAsk, keepAlive);
      const problems = [];
      const fillAnswers = async (answersById, fieldsToFill, onRejected) => {
        for (const field of fieldsToFill) {
          const answer = answersById[field.id];
          if (!answer) continue;
          const outcome = await fillAndCheck(tabId, field, answer, null, seen);
          if (outcome.gone) continue;
          if (outcome.ok) used[field.label || field.id] = answer;
          else onRejected(field, answer, outcome.error);
        }
      };
      await fillAnswers(aiAnswers, toAsk, (field, answer, error) => {
        problems.push({ id: field.id, label: field.label, reason: `the site did not take "${[].concat(answer.value).join(' | ')}": ${error}` });
      });
      if (problems.length) {
        const fixed = await askChatGptToFix(application, problems, toAsk, keepAlive);
        await fillAnswers(fixed, toAsk.filter((field) => problems.some((entry) => entry.id === field.id)), (field) => {
          if (field.required) failures.push(field.label);
        });
      }
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
      const shot = await debuggerSend(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 70 });
      const bytes = Uint8Array.from(atob(shot.data), (char) => char.charCodeAt(0));
      pdf = self.__qtsApplyPdf.buildImagePdf(bytes, caption);
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
      let buttons = await inForm(tab.id, () => globalThis.__qtsApplyForm.buttons());
      // Sites keep Submit disabled while an upload finishes; give it a moment before judging.
      for (let waited = 0; waited < 15000 && !buttons?.submit && buttons?.submitDisabled; waited += 1000) {
        await sleep(1000);
        buttons = await inForm(tab.id, () => globalThis.__qtsApplyForm.buttons());
      }
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
      answerPromptId: application.answerPrompt?.id ?? null,
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
    // The "being debugged" bar goes away with the application.
    if (tab?.id != null) await releaseDebugger(tab.id);
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
