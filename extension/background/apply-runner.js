// Apply with Manager review: takes Generation-completed jobs from the server one at a time (one per
// Chrome), fills each step of the form in Apply's own window, and waits for the Manager on every
// step. The Manager clicks the site's Submit and answers "Submitted successfully?": Yes makes the
// bid. Loaded by the service worker with importScripts; it uses the worker's shared helpers
// (workerApiRequest, getTab, sleep, tabOwnership, openDownloadedFolder, the ChatGPT helpers) at call time.
//
// Rules (docs/architecture.md): the candidate's profile and saved answers fill what they can, each
// answer checked against what the site accepts; everything else, and any profile answer the site
// rejects, goes to ChatGPT with Super Admin's answer prompt (its tab shown while it writes), with
// one follow-up for answers that do not fit. What Apply cannot do (a CAPTCHA, a rejected field,
// ChatGPT failing, an upload) comes to the review marked; a sign-in wall leaves the job to the Manager.

const APPLY_QUEUE_ALARM = 'qts-apply-queue';
const APPLY_WINDOW_KEY = 'qtsApplyWindowId';
const APPLY_CHAT_TAB_KEY = 'qtsApplyChatTab';
// Test mode: fills everything, then stops right before Submit and gives the job back.
const APPLY_DRY_RUN_KEY = 'qtsApplyDryRun';
const APPLY_HEARTBEAT_MS = 30 * 1000;
const APPLY_FORM_WAIT_MS = 25 * 1000;
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
  // A list an earlier attempt left open would count as "already showing" and be ignored: close it first.
  await realEscape(tabId);
  await sleep(200);
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
    const choices = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownChoiceTexts(id), [field.id]).catch(() => []);
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
    // Search lists and suggestion boxes get the answer's first part typed; menus are only opened.
    // Typed up to the first apostrophe, bracket, or slash: "Associate's" may be written "Associate’s".
    const typed = field.kind === 'combobox' || field.kind === 'text' || field.searchable
      ? wanted.split(',')[0].split(/['’(/]/)[0].trim().slice(0, 40)
      : '';
    if (!(await realOpen(tabId, field, typed))) return { ok: false, error: 'the field is not on the screen' };
    // A search list may fetch its results after typing.
    let choice = null;
    for (let waited = 0; waited < 3000 && !choice; waited += 500) {
      choice = await inForm(tabId, (text, id) => globalThis.__qtsApplyForm.choiceBox(text, id), [wanted, field.id]).catch(() => null);
      if (!choice) await sleep(500);
    }
    if (!choice) {
      // What the list or suggestion box does offer goes to the AI as the field's choices.
      const choices = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownChoiceTexts(id), [field.id]).catch(() => []);
      await realEscape(tabId);
      return { ok: false, error: `the list has no "${wanted}"`, choices: choices || [] };
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

/** Ticks radio or tick-box options with real clicks on their labels; { ok } or { ok: false, error }. */
async function checkWithRealClick(tabId, field, value) {
  try {
    for (const wanted of [].concat(value).map((entry) => String(entry))) {
      if (await inForm(tabId, (id, text) => globalThis.__qtsApplyForm.optionChecked(id, text), [field.id, wanted])) continue;
      const box = await inForm(tabId, (id, text) => globalThis.__qtsApplyForm.optionBox(id, text), [field.id, wanted]).catch(() => null);
      if (!box) return { ok: false, error: `no option "${wanted}" on the screen` };
      await realClick(tabId, box);
      await sleep(300);
      if (!(await inForm(tabId, (id, text) => globalThis.__qtsApplyForm.optionChecked(id, text), [field.id, wanted]))) {
        return { ok: false, error: `"${wanted}" stayed unticked` };
      }
    }
    return { ok: true };
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

/** The answer prompt for a page's open questions: Super Admin's prompt for the AI mode, or the default. */
function answerPromptFor(application, fields) {
  return self.__qtsApplyAnswers.buildAnswerPrompt({
    template: application.answerPrompt?.template,
    job: application.job,
    candidate: application.candidate,
    resumeText: application.job.resumeText,
    coverLetterText: application.job.coverLetterText,
    fields,
    exchangeRates: application.exchangeRates,
    today: new Date(),
    savedAnswers: application.savedAnswers,
  });
}

// The AI that answers open questions, by Super Admin's mode for the Manager: ChatGPT in its tab, or
// Gemini through the QTS server. Everything around it (checks, follow-up, filling, review) is shared.
const aiName = (application) => (application.aiMode === 'gemini' ? 'Gemini' : 'ChatGPT');

async function askAiForAnswers(application, fields, keepAlive) {
  return application.aiMode === 'gemini'
    ? askGeminiForAnswers(application, fields)
    : askChatGptForAnswers(application, fields, keepAlive);
}

async function askAiToFix(application, problems, fields, keepAlive) {
  return application.aiMode === 'gemini'
    ? askGeminiToFix(application, problems, fields)
    : askChatGptToFix(application, problems, fields, keepAlive);
}

async function askGemini(application, turns) {
  const result = await workerApiRequest('POST', '/api/extension/apply/answers', { attemptId: application.attemptId, turns });
  if (result.success !== true) throw new Error(result.message || 'Gemini did not answer.');
  return String(result.reply || '');
}

/** Gemini's checked answers for a page's open questions, with one follow-up that carries the first turns. */
async function askGeminiForAnswers(application, fields) {
  const helpers = self.__qtsApplyAnswers;
  const first = answerPromptFor(application, fields);
  const reply = await askGemini(application, [{ role: 'user', text: first }]);
  application.geminiTurns = [{ role: 'user', text: first }, { role: 'model', text: reply }];
  const { answers, invalid } = helpers.parseAnswerReply(reply, fields);
  const needed = invalid.filter((entry) => fields.find((field) => field.id === entry.id)?.required);
  if (!needed.length) return answers;
  return { ...answers, ...(await askGeminiToFix(application, needed, fields)) };
}

async function askGeminiToFix(application, problems, fields) {
  const helpers = self.__qtsApplyAnswers;
  const retryFields = fields.filter((field) => problems.some((entry) => entry.id === field.id));
  const reply = await askGemini(application, [
    ...(application.geminiTurns || []),
    { role: 'user', text: helpers.buildFixPrompt(problems, retryFields) },
  ]);
  const retried = helpers.parseAnswerReply(reply, retryFields);
  const stillWrong = retried.invalid.filter((entry) => retryFields.find((field) => field.id === entry.id)?.required);
  if (stillWrong.length) {
    throw new ApplyStop(`Gemini could not answer: ${stillWrong.map((entry) => `${entry.label} (${entry.reason})`).join('; ')}`.slice(0, 480));
  }
  return retried.answers;
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
  const first = answerPromptFor(application, fields);
  const reply = await askChatGpt(chatTabId, application, first, keepAlive);
  const { answers, invalid } = helpers.parseAnswerReply(reply, fields);
  const needed = invalid.filter((entry) => fields.find((field) => field.id === entry.id)?.required);
  if (!needed.length) return answers;
  return { ...answers, ...(await askChatGptToFix(application, needed, fields, keepAlive)) };
}

// ChatGPT writes at full speed only in the tab its window shows, so the ChatGPT tab is shown while it
// answers, then the tab shown before (the job page) comes back. Only tabs switch; the window is left
// as it is. Applications in this Chrome share the ChatGPT tab, so the switch back waits for the last.
let chatGptTurns = 0;
let tabBeforeChatGpt = null;

async function askChatGpt(chatTabId, application, prompt, keepAlive) {
  const marker = application.attemptId;
  const chatTab = await getTab(chatTabId);
  if (chatGptTurns === 0 && chatTab) {
    const [shown] = await chrome.tabs.query({ windowId: chatTab.windowId, active: true }).catch(() => []);
    tabBeforeChatGpt = shown && shown.id !== chatTabId ? shown.id : null;
  }
  chatGptTurns += 1;
  await chrome.tabs.update(chatTabId, { active: true }).catch(() => {});
  try {
    await sendGenerationPromptWithRecovery(chatTabId, self.__qtsGenerationChatGpt.buildTaskPrompt(prompt, marker));
    return await waitForGenerationAnswer(chatTabId, marker, { local: () => {}, server: keepAlive });
  } finally {
    chatGptTurns -= 1;
    if (chatGptTurns === 0 && tabBeforeChatGpt != null) {
      await chrome.tabs.update(tabBeforeChatGpt, { active: true }).catch(() => {});
      tabBeforeChatGpt = null;
    }
  }
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
  // A dropdown that ignored simulated events gets real clicks, and so does a text box that ended up
  // empty: it keeps a value only when one of its suggestions is clicked (Lever's location).
  const emptied = field.kind === 'text' && !String(result?.value ?? '').trim();
  if (!result?.ok && (['menu', 'combobox'].includes(field.kind) || emptied) && !file) {
    const real = await pickWithRealClick(tabId, { ...field, id: fieldId }, answer.value);
    result = real.ok ? { ok: true } : { ok: false, error: `${result?.error || 'not taken'}; with real clicks: ${real.error}`, choices: real.choices };
  }
  // Radio and tick-box options a site ignores simulated clicks on get real clicks on their labels.
  if (!result?.ok && ['radio', 'checkbox-group'].includes(field.kind)) {
    const real = await checkWithRealClick(tabId, { ...field, id: fieldId }, answer.value);
    result = real.ok ? { ok: true } : { ok: false, error: `${result?.error || 'not taken'}; with real clicks: ${real.error}` };
  }
  if (!result?.ok) return { ok: false, error: result?.error || `it holds "${result?.value ?? ''}"`, choices: result?.choices || [] };
  const issue = await inForm(tabId, (id) => globalThis.__qtsApplyForm.fieldIssue(id), [fieldId]).catch(() => '');
  return issue ? { ok: false, error: issue } : { ok: true };
}

/**
 * Fills one step of the form in rounds. Each round: the profile's answers first, each checked
 * against what the site accepts; then one ChatGPT request for the questions the profile could not
 * answer and the profile answers the site rejected (with the profile's value as a hint); then
 * ChatGPT's answers, with one follow-up for any the site rejects. A new round answers questions
 * those answers revealed. Nothing here ends the application: what it cannot do becomes a problem
 * for the Manager's review. Returns { used, problems, canAskAgain }.
 */
async function fillFormPage(tabId, application, keepAlive, step) {
  const helpers = self.__qtsApplyAnswers;
  const used = {};
  const problems = [];
  let canAskAgain = false;
  const seen = new Set();
  const uploaded = new Set();
  let documents = null;
  let rechecked = false;
  const problem = (message, field = null, kind = 'field') => {
    if (!problems.some((entry) => entry.message === message)) problems.push({ message, fieldId: field?.id ?? null, kind });
  };
  for (let round = 0; round < APPLY_FILL_ROUNDS + 1; round += 1) {
    const fields = round === 0
      ? await waitForFormFields(tabId)
      : await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm());
    if (round === 0) {
      await inForm(tabId, () => globalThis.__qtsApplyForm.declineCookies()).catch(() => false);
      const blockers = await inForm(tabId, () => globalThis.__qtsApplyForm.detectBlockers());
      if (blockers?.includes('login')) throw new ApplyStop('The site asks to sign in or create an account.');
    }
    const fresh = (fields || []).filter((field) => !field.hidden && !field.disabled && !seen.has(field.id));
    if (!fresh.length) {
      // Complete before review: a required question still empty (an answer the site dropped, or
      // one asked before it was ready) gets one more round, as if new.
      if (rechecked) break;
      rechecked = true;
      const empty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
      if (!empty?.length) break;
      for (const entry of empty) seen.delete(entry.id);
      continue;
    }
    for (const field of fresh) seen.add(field.id);
    await readComboboxOptions(tabId, fresh);
    const resolved = helpers.resolveFields(fresh, application.candidate, application.savedAnswers, {
      exchangeRates: application.exchangeRates,
      today: new Date(),
      coverLetterText: application.job.coverLetterText,
    });
    const { answers } = resolved;
    // "Fill again" reuses this application's earlier answers instead of asking ChatGPT again.
    const open = resolved.open.filter((field) => {
      const cached = application.answerCache?.get(field.label);
      if (!cached) return true;
      answers[field.id] = cached;
      return false;
    });
    if (!documents && Object.values(answers).some((answer) => answer.file)) {
      try {
        documents = await fetchApplyDocuments(application.attemptId);
        application.documentsFolder = documents.folder;
      } catch (error) {
        problem(`The résumé could not be prepared (${error instanceof Error ? error.message : 'unknown error'}); upload it by hand from the folder above.`, null, 'upload');
        documents = {};
      }
    }

    // 1. The profile's answers, in page order; one the site does not take goes to ChatGPT.
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
      const file = answer.file ? { ...documents?.[answer.file], mimeType: 'application/pdf' } : null;
      if (answer.file && !file?.base64) {
        if (field.required) problem(`Upload the ${answer.file === 'coverLetter' ? 'cover letter' : 'résumé'} by hand: "${field.label}".`, field, 'upload');
        continue;
      }
      // Each document goes up once per step; a site may redraw its upload field after taking it.
      if (answer.file && uploaded.has(answer.file)) continue;
      const outcome = await fillAndCheck(tabId, field, answer, file, seen);
      if (outcome.gone) continue;
      if (outcome.ok) {
        if (answer.file) uploaded.add(answer.file);
        else used[field.label || field.id] = { ...answer, step, fieldId: field.id, ...fieldFacts(field) };
      } else if (answer.file) {
        // A cover letter that could not be attached is typed instead where the site offers it.
        const typed = answer.file === 'coverLetter' && application.job.coverLetterText
          && await inForm(tabId, (id) => globalThis.__qtsApplyForm.enterManually(id), [field.id]).catch(() => false);
        if (!typed && field.required) problem(`The ${answer.file === 'coverLetter' ? 'cover letter' : 'résumé'} upload failed: add it by hand ("${field.label}") from the folder above.`, field, 'upload');
      } else if (answer.source === 'documents') {
        if (field.required) problem(`"${field.label}" did not take the cover letter text; paste it by hand.`, field);
      } else {
        // The value that did not fit goes to ChatGPT with what it was (the profile's fact or a
        // reusable answer and its note), the site's reason, and the choices the field showed.
        const was = answer.source === 'reusable'
          ? `The reusable answer for this question is "${answer.saved ?? answer.value}"${answer.note ? ` (note: ${answer.note})` : ''}`
          : `The candidate's profile says "${answer.value}"`;
        rejected.push({
          ...field,
          ...(outcome.choices?.length ? { options: outcome.choices } : {}),
          hint: `${was}, but the site did not take it (${outcome.error}); give it in a form this field takes.`,
          intended: answerText(answer.saved ?? answer.value),
        });
      }
    }

    // 2. One AI request (ChatGPT or Gemini, by the Manager's mode) for the rest; 3. its answers, with
    // one follow-up for any the site rejects.
    let toAsk = [...open, ...rejected];
    // A value that did not fit became a known option on this question before (Apply's question
    // memory): it is filled without the AI, which is asked only when the site still rejects it.
    const remaining = [];
    for (const field of toAsk) {
      const choice = helpers.findRememberedChoice(field, field.intended, application.rememberedChoices);
      if (!choice) {
        remaining.push(field);
        continue;
      }
      const outcome = await fillAndCheck(tabId, field, { value: choice, source: 'saved' }, null, seen);
      if (outcome.ok) used[field.label || field.id] = { value: choice, source: 'saved', step, fieldId: field.id, ...fieldFacts(field) };
      else if (!outcome.gone) remaining.push(field);
    }
    toAsk = remaining;
    if (toAsk.length) {
      try {
        const aiAnswers = await askAiForAnswers(application, toAsk, keepAlive);
        const issues = [];
        const fillAnswers = async (answersById, fieldsToFill, onRejected) => {
          for (const field of fieldsToFill) {
            const answer = answersById[field.id];
            if (!answer) continue;
            const outcome = await fillAndCheck(tabId, field, answer, null, seen);
            if (outcome.gone) continue;
            if (outcome.ok) used[field.label || field.id] = { ...answer, step, fieldId: field.id, ...fieldFacts(field) };
            else onRejected(field, answer, outcome.error, outcome.choices);
          }
        };
        await fillAnswers(aiAnswers, toAsk, (field, answer, error, choices) => {
          // The follow-up offers the choices the field showed when the answer was typed.
          if (choices?.length) field.options = choices;
          issues.push({ id: field.id, label: field.label, reason: `the site did not take "${[].concat(answer.value).join(' | ')}": ${error}` });
        });
        if (issues.length) {
          const tried = new Map(issues.map((entry) => [entry.id, entry.reason]));
          try {
            const fixed = await askAiToFix(application, issues, toAsk, keepAlive);
            await fillAnswers(fixed, toAsk.filter((field) => tried.has(field.id)), (field, answer, error) => {
              if (field.required) problem(`Fill by hand: "${field.label}" — the site said: ${error}. Tried: ${tried.get(field.id)}; then "${[].concat(answer.value).join(' | ')}".`, field);
            });
          } catch (error) {
            for (const field of toAsk.filter((entry) => tried.has(entry.id) && entry.required)) {
              problem(`Fill by hand: "${field.label}" — ${tried.get(field.id)}.`, field);
            }
            if (!(error instanceof ApplyStop)) throw error;
          }
        }
      } catch (error) {
        if (error instanceof ApplyStop) throw error;
        canAskAgain = true;
        const reason = error instanceof Error ? error.message : `${aiName(application)} did not answer.`;
        for (const field of toAsk.filter((entry) => entry.required || entry.kind === 'textarea')) {
          problem(`${aiName(application)} did not answer "${field.label}" (${reason}). Write it, or Ask ${aiName(application)} again.`, field, 'chatgpt');
        }
      }
    }
    // Let the page show the questions these answers unlock before looking again.
    await sleep(1000);
  }
  const stillEmpty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
  for (const entry of stillEmpty || []) problem(`Still empty: "${entry.label}".`, entry);
  const errors = await inForm(tabId, () => globalThis.__qtsApplyForm.fieldErrors()).catch(() => []);
  for (const text of errors || []) problem(`The form shows: ${text}`);
  return { used, problems, canAskAgain };
}

async function browserName() {
  const stored = await chrome.storage.local.get('qtsBrowserName');
  return stored.qtsBrowserName || `Chrome · ${String(await self.__qtsApiWorker.workerBrowserKey()).slice(0, 4).toUpperCase()}`;
}

// What Apply's question memory keeps about a field: a choice or text question, the choices it
// offered, and the value meant when one did not fit as written.
const CHOICE_KINDS = new Set(['select', 'menu', 'combobox', 'radio', 'checkbox-group', 'checkbox']);
function fieldFacts(field) {
  const options = Array.isArray(field.options) ? field.options.slice(0, 30).map((option) => String(option)) : [];
  return { kind: options.length || CHOICE_KINDS.has(field.kind) ? 'choice' : 'text', options, intended: field.intended ?? null };
}

/** An answer as the record shows it: lists joined, tick boxes as Ticked/Not ticked. */
function answerText(value) {
  if (Array.isArray(value)) return value.map(String).join(' | ');
  if (typeof value === 'boolean') return value ? 'Ticked' : 'Not ticked';
  return String(value ?? '');
}

// The answers so far, kept with the attempt and on the job row: question, answer, source.
function appliedAnswers(answersUsed) {
  return Object.entries(answersUsed).map(([question, answer]) => ({
    question: question.slice(0, 300),
    answer: answerText(answer.value).slice(0, 2000),
    source: answer.source || 'ai',
  }));
}

/**
 * What was submitted: Apply's answers with the form's values at the Submit click. A value the
 * Manager changed, and a question only the Manager answered, is marked "manager".
 */
function submittedAnswers(answersUsed, current) {
  const simple = (value) => answerText(value).toLowerCase().replace(/\s+/g, ' ').trim();
  const shown = new Map((current || []).map((entry) => [entry.label, entry.value]));
  const answers = Object.entries(answersUsed).map(([question, answer]) => {
    const now = shown.get(question);
    const changed = now !== undefined && now !== '' && simple(now) !== simple(answer.value)
      && !simple(now).includes(simple(answer.value));
    return {
      question: question.slice(0, 300),
      answer: (changed ? now : answerText(answer.value)).slice(0, 2000),
      source: changed ? 'manager' : answer.source || 'ai',
    };
  });
  for (const [question, value] of shown) {
    if (!value || value === 'Not ticked' || answersUsed[question]) continue;
    answers.push({ question: question.slice(0, 300), answer: value.slice(0, 2000), source: 'manager' });
  }
  return answers;
}

/**
 * What a confirmed application teaches Apply's question memory: each answer with its kind, the
 * choices offered, and the value meant; a value the Manager changed counts as theirs. Personal
 * facts and documents are filtered out on the server.
 */
function learnedAnswers(answersUsed, current) {
  const simple = (value) => answerText(value).toLowerCase().replace(/\s+/g, ' ').trim();
  const shown = new Map((current || []).map((entry) => [entry.label, entry.value]));
  return Object.entries(answersUsed).map(([question, answer]) => {
    const now = shown.get(question);
    const changed = now !== undefined && now !== '' && simple(now) !== simple(answer.value) && !simple(now).includes(simple(answer.value));
    return {
      question: question.slice(0, 300),
      kind: answer.kind || 'text',
      answer: (changed ? now : answerText(answer.value)).slice(0, 2000),
      source: changed ? 'manager' : answer.source || 'ai',
      options: answer.options || [],
      intended: answer.intended ?? null,
    };
  });
}

// The review panel and notifications: each application waiting for the Manager has a waiter the
// panel's buttons (or the notification's) resolve.
const reviewWaiters = new Map();
const APPLY_REVIEW_REMINDER_MS = 10 * 60 * 1000;

function waitForManager(attemptId) {
  return new Promise((resolve) => reviewWaiters.set(attemptId, resolve));
}

function answerManager(attemptId, decision) {
  const resolve = reviewWaiters.get(attemptId);
  if (!resolve) return false;
  reviewWaiters.delete(attemptId);
  resolve(decision);
  return true;
}

async function showReviewPanel(tabId, state) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/apply-form.js', 'content/apply-review.js'] });
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (next) => globalThis.__qtsApplyReview?.render(next),
    args: [state],
  });
}

async function removeReviewPanel(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => globalThis.__qtsApplyReview?.remove(),
  }).catch(() => {});
}

async function focusApplyTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab) return;
  await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' }).catch(() => {});
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
}

/**
 * A Windows notification that stays until clicked: "Ready for review" with Open, or "Submitted
 * successfully?" with Yes and No. The title names this Chrome, so with several Apply Chromes the
 * Manager sees which window needs them.
 */
async function notifyManager(review, kind, text) {
  const id = `qts-apply-${review.attemptId}`;
  const title = kind === 'confirm' ? 'Submitted successfully?' : kind === 'problem' ? 'Needs you' : 'Ready for review';
  await chrome.notifications.clear(id).catch(() => {});
  await new Promise((resolve) => {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon128.png'),
      title: `QTS Apply · ${review.chromeName} — ${title}`,
      message: `${review.candidate} · ${review.job.company}: ${review.job.title}`.slice(0, 200),
      contextMessage: String(text || '').slice(0, 120),
      requireInteraction: true,
      priority: 2,
      buttons: kind === 'confirm' ? [{ title: 'Yes, submitted' }, { title: 'No' }] : [{ title: 'Open' }],
    }, () => resolve());
  });
  const stored = (await chrome.storage.session.get('qtsApplyNotices')).qtsApplyNotices || {};
  stored[id] = { attemptId: review.attemptId, tabId: review.tabId, kind };
  await chrome.storage.session.set({ qtsApplyNotices: stored });
}

async function clearManagerNotice(attemptId) {
  const id = `qts-apply-${attemptId}`;
  await chrome.notifications.clear(id).catch(() => {});
  const stored = (await chrome.storage.session.get('qtsApplyNotices')).qtsApplyNotices || {};
  delete stored[id];
  await chrome.storage.session.set({ qtsApplyNotices: stored });
}

/** Waits for the Manager, showing the panel, renewing the hold, and reminding every 10 minutes. */
async function askManager(review, panelState, noticeKind, noticeText) {
  review.panel = panelState;
  await showReviewPanel(review.tabId, panelState).catch(() => {});
  if (noticeKind) {
    await notifyManager(review, noticeKind, noticeText);
    review.notified = true;
  }
  const reminder = setInterval(() => {
    if (noticeKind) notifyManager(review, noticeKind, `Still waiting · ${noticeText || ''}`).catch(() => {});
  }, APPLY_REVIEW_REMINDER_MS);
  try {
    const decision = await waitForManager(review.attemptId);
    // The page may change right after a choice (Next, Submit): it shows "working" until the next state.
    review.panel = { ...panelState, mode: 'working', workingText: 'One moment…' };
    return decision;
  } finally {
    clearInterval(reminder);
  }
}

// The panel's and the notifications' buttons. A choice without a waiting application (the worker
// restarted) still reaches QTS for the answers that need no page: Yes, No, Skip, Later.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'QTS_APPLY_PANEL' || typeof msg.attemptId !== 'string') return false;
  (async () => {
    if (msg.action === 'ping') return { ok: true };
    if (msg.action === 'open_folder') {
      const review = activeReviews.get(msg.attemptId);
      return review?.resumeFolder ? openDownloadedFolder(review.resumeFolder) : { ok: false, error: 'No résumé folder for this job.' };
    }
    if (answerManager(msg.attemptId, { action: msg.action, answers: msg.answers || null, noticed: msg.noticed === true, tabId: sender.tab?.id })) {
      return { ok: true };
    }
    return answerWithoutRunner(msg.attemptId, msg.action, sender.tab?.id);
  })().then(sendResponse, (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Failed.' }));
  return true;
});

chrome.notifications.onClicked.addListener(async (id) => {
  const notice = ((await chrome.storage.session.get('qtsApplyNotices')).qtsApplyNotices || {})[id];
  if (notice?.tabId != null) await focusApplyTab(notice.tabId);
});

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  const notice = ((await chrome.storage.session.get('qtsApplyNotices')).qtsApplyNotices || {})[id];
  if (!notice) return;
  if (notice.kind !== 'confirm') {
    if (notice.tabId != null) await focusApplyTab(notice.tabId);
    return;
  }
  const action = index === 0 ? 'yes' : 'no';
  if (!answerManager(notice.attemptId, { action })) await answerWithoutRunner(notice.attemptId, action, notice.tabId);
});

async function answerWithoutRunner(attemptId, action, tabId) {
  let result = null;
  if (action === 'yes' || action === 'no') {
    result = await workerApiRequest('POST', '/api/extension/apply/result', { attemptId, submitted: action === 'yes' });
  } else if (action === 'skip' || action === 'later') {
    result = await workerApiRequest('POST', '/api/extension/apply/release', {
      attemptId,
      mode: action,
      reason: action === 'skip' ? 'Skipped by the Manager.' : 'The Manager will apply later.',
    });
  } else {
    return { ok: false, error: 'Apply restarted in this Chrome; finish this step by hand, or click Later.' };
  }
  if (result?.success) {
    await clearManagerNotice(attemptId);
    if (tabId != null) {
      await removeReviewPanel(tabId);
      if (action !== 'no') await chrome.tabs.remove(tabId).catch(() => {});
    }
  }
  return result?.success ? { ok: true } : { ok: false, error: result?.message || 'QTS did not record it.' };
}

// The application each tab holds while it waits for the Manager: the panel comes back after the
// page reloads or moves to the site's next step.
const activeReviews = new Map();

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  for (const review of activeReviews.values()) {
    if (review.tabId !== tabId || !review.panel) continue;
    if (review.panel.mode === 'review') {
      // The page changed under a review: the Manager clicked the site's Next (go on to the next
      // step) or Submit (ask Yes/No) themselves.
      answerManager(review.attemptId, { action: review.panel.final ? 'submitted' : 'continue_manual', noticed: true });
    }
    showReviewPanel(tabId, review.panel).catch(() => {});
  }
});

// Apply turned off in this Chrome (Cancel, or "Stop all"): a review gives its job back; a question
// after Submit stays for the Jobs page.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[EXTENSION_STATUS_KEY] || changes[EXTENSION_STATUS_KEY].newValue === 'apply') return;
  for (const review of activeReviews.values()) {
    answerManager(review.attemptId, { action: review.panel?.mode === 'confirm' ? 'stopped' : 'later' });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const review of activeReviews.values()) {
    if (review.tabId === tabId) answerManager(review.attemptId, { action: 'closed' });
  }
});

/**
 * One application with the Manager reviewing every step: Apply fills a step and waits; Continue
 * moves to the next one; on the last step the Manager clicks the site's Submit and answers whether
 * it went through. Problems (a CAPTCHA, a rejected field, ChatGPT failing, an upload) come to the
 * review marked, never ending the application quietly.
 */
async function runApplication(application, recipe) {
  let lostClaim = false;
  const keepAlive = async () => {
    const renewed = await workerApiRequest('POST', '/api/extension/apply/heartbeat', { attemptId: application.attemptId });
    if (renewed._httpStatus === 409) lostClaim = true;
    // Super Admin may change the review mode or automatic Submit during an application: the next step uses it.
    if (renewed.success === true) {
      if (renewed.reviewMode) application.reviewMode = renewed.reviewMode;
      if (typeof renewed.autoSubmit === 'boolean') application.autoSubmit = renewed.autoSubmit;
    }
  };
  const heartbeat = setInterval(() => keepAlive().catch(() => {}), APPLY_HEARTBEAT_MS);
  const answersUsed = {};
  application.answerCache = new Map();
  const dryRun = (await chrome.storage.local.get(APPLY_DRY_RUN_KEY))[APPLY_DRY_RUN_KEY] === true;
  const review = {
    attemptId: application.attemptId,
    tabId: null,
    chromeName: await browserName(),
    candidate: [application.candidate.firstName, application.candidate.lastName].filter(Boolean).join(' ') || 'Candidate',
    job: application.job,
    resumeFolder: application.job.resumeFolder,
    panel: null,
  };
  activeReviews.set(application.attemptId, review);
  const reviewState = (mode, extra = {}) => ({
    attemptId: application.attemptId,
    mode,
    chromeName: review.chromeName,
    candidate: review.candidate,
    job: {
      title: application.job.title,
      company: application.job.company,
      location: application.job.location,
      workType: application.job.workType,
      salary: application.job.salary,
      url: application.job.url,
    },
    resumeFolder: application.job.resumeFolder,
    aiName: aiName(application),
    promptName: application.job.promptName,
    templateName: application.job.templateName,
    answers: Object.entries(answersUsed).map(([question, answer]) => ({
      question,
      answer: answerText(answer.value).slice(0, 400),
      source: answer.source || 'ai',
      step: answer.step || 1,
      fieldId: answer.fieldId || null,
    })),
    ...extra,
  });
  const report = (path, body) => workerApiRequest('POST', `/api/extension/apply/${path}`, { attemptId: application.attemptId, ...body });
  const release = (mode, reason) => report('release', { mode, reason: reason.slice(0, 480), appliedAnswers: appliedAnswers(answersUsed) });
  let tab = null;
  let submitted = false;
  try {
    tab = await openApplyTab(recipe.formUrl);
    review.tabId = tab.id;
    await waitForTabComplete(tab.id, 45 * 1000);
    if (recipe.findStart) {
      try {
        tab = await reachApplicationForm(tab, (opened) => { tab = opened; review.tabId = opened.id; });
      } catch (error) {
        // A security check before the job page goes to the Manager: solve it, then Continue.
        if (!(error instanceof ApplyStop) || !/CAPTCHA|security check/i.test(error.message)) throw error;
        const decision = await askManager(review, reviewState('review', {
          step: 1, final: false, problems: [{ message: 'Solve the security check (CAPTCHA) on this page, then Continue.', fieldId: null }],
        }), 'problem', 'Solve the CAPTCHA, then Continue.');
        if (decision.action !== 'continue') return await finishBeforeSubmit(decision.action);
        tab = await reachApplicationForm(tab, (opened) => { tab = opened; review.tabId = opened.id; });
      }
    }

    let step = 1;
    let fillAgain = false;
    for (;;) {
      if (!(await isApplyOn())) throw new ApplyStop('Apply was cancelled.', { skip: false, keepTab: false });
      if (lostClaim) throw new ApplyStop('This Chrome lost the application to another one.', { skip: false, keepTab: false });
      await report('review', { review: false, appliedAnswers: appliedAnswers(answersUsed) });
      review.panel = reviewState('working', { step, workingText: fillAgain ? 'Filling again…' : `Filling step ${step}…` });
      await showReviewPanel(tab.id, review.panel).catch(() => {});
      const filled = await fillFormPage(tab.id, application, keepAlive, step);
      Object.assign(answersUsed, filled.used);
      for (const [label, answer] of Object.entries(filled.used)) {
        if (!answer.file) application.answerCache.set(label, answer);
      }
      let buttons = await inForm(tab.id, () => globalThis.__qtsApplyForm.buttons());
      // Sites keep Submit disabled while an upload finishes; give it a moment before judging.
      for (let waited = 0; waited < 15000 && !buttons?.submit && buttons?.submitDisabled; waited += 1000) {
        await sleep(1000);
        buttons = await inForm(tab.id, () => globalThis.__qtsApplyForm.buttons());
      }
      const final = Boolean(buttons?.submit) || !buttons?.next;
      const problems = [...filled.problems];
      const blockers = await inForm(tab.id, () => globalThis.__qtsApplyForm.detectBlockers()).catch(() => []);
      if (blockers?.includes('captcha')) problems.unshift({ message: 'Solve the CAPTCHA on this page.', fieldId: null });
      if (final && !buttons?.submit) {
        problems.push({ message: buttons?.submitDisabled
          ? 'The Submit button stays disabled: a requirement may not be met, or an answer was not accepted.'
          : 'No single Submit or Next button was found: finish the form by hand.', fieldId: null });
      }

      // Test mode (Claude's own checks): every step is filled and Next clicked; it stops before Submit.
      if (dryRun) {
        if (!final) {
          await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('next'));
          await sleep(2500);
          step += 1;
          if (step > APPLY_MAX_FORM_PAGES) throw new ApplyStop('Test mode: too many steps.', { skip: false, dryRun: true });
          continue;
        }
        throw new ApplyStop(`Test mode: everything is filled; stopped before Submit.${problems.length ? ` Needs: ${problems.map((entry) => entry.message).join(' ')}` : ''}`, { skip: false, dryRun: true });
      }

      // The step's settings as they are now (Super Admin may have changed them).
      await keepAlive().catch(() => {});

      // Review before Submit only (Super Admin's per-Manager mode): the steps before the last go on by
      // themselves while nothing needs the Manager; the last step waits for one review of everything.
      if (application.reviewMode === 'before_submit' && !application.autoSubmit && !final && !problems.length) {
        await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('next'));
        await sleep(2500);
        step += 1;
        continue;
      }

      // Automatic Submit (Super Admin's option): no stops while nothing needs the Manager.
      if (application.autoSubmit && !problems.length) {
        if (!final) {
          await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('next'));
          await sleep(2500);
          step += 1;
          continue;
        }
        const current = await inForm(tab.id, () => globalThis.__qtsApplyForm.currentAnswers()).catch(() => []);
        const marked = await report('submitted', { appliedAnswers: submittedAnswers(answersUsed, current), learned: learnedAnswers(answersUsed, current) });
        if (!marked.success) throw new ApplyStop(marked.message || 'QTS did not record the Submit.', { skip: false, keepTab: false });
        submitted = true;
        await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('submit'));
        await waitForConfirmation(review, reviewState, answersUsed, current, report, () => tab?.id);
        return;
      }

      await report('review', { review: true, appliedAnswers: appliedAnswers(answersUsed) });
      const problemFieldIds = problems.map((entry) => entry.fieldId).filter(Boolean);
      const decision = await askManager(
        review,
        reviewState('review', { step, final, problems, problemFieldIds, canAskAgain: filled.canAskAgain, reviewAll: application.reviewMode === 'before_submit' }),
        // One "Ready for review" per application, at its first stop; problems always alert.
        problems.length ? 'problem' : review.notified ? null : 'review',
        problems.length ? `${problems.length} thing${problems.length === 1 ? '' : 's'} need${problems.length === 1 ? 's' : ''} you.` : 'Check the answers, then Continue or Submit.',
      );
      fillAgain = false;
      if (decision.action === 'continue') {
        await inForm(tab.id, () => globalThis.__qtsApplyForm.clickButton('next'));
        await sleep(2500);
        step += 1;
        continue;
      }
      if (decision.action === 'continue_manual') {
        await sleep(1500);
        step += 1;
        continue;
      }
      if (decision.action === 'fill_again' || decision.action === 'ask_again') {
        // Fill again reuses the answers (no ChatGPT for known questions); Ask again forgets ChatGPT's failures.
        if (decision.action === 'ask_again') application.answerCache.clear();
        fillAgain = true;
        continue;
      }
      if (decision.action === 'submitted') {
        const current = decision.answers || await inForm(tab.id, () => globalThis.__qtsApplyForm.currentAnswers()).catch(() => []);
        const marked = await report('submitted', { appliedAnswers: submittedAnswers(answersUsed, current), learned: learnedAnswers(answersUsed, current) });
        if (!marked.success) throw new ApplyStop(marked.message || 'QTS did not record the Submit.', { skip: false, keepTab: false });
        submitted = true;
        const outcome = await waitForConfirmation(review, reviewState, answersUsed, current, report, () => tab?.id);
        if (outcome === 'back_to_review') {
          submitted = false;
          fillAgain = false;
          continue;
        }
        return;
      }
      return await finishBeforeSubmit(decision.action);
    }
  } catch (error) {
    if (submitted) {
      // After Submit the application waits for the Manager's Yes/No on the Jobs page.
      await notifyApply(`${application.job.company}: answer "Submitted successfully?" on the Jobs page.`);
      return;
    }
    const stop = error instanceof ApplyStop ? error : new ApplyStop(error instanceof Error ? error.message : 'Apply failed.', { skip: false });
    await release(stop.dryRun ? 'test' : stop.skip ? 'skip' : 'error', stop.message).catch(() => {});
    // Test mode gives the job back, so the same job would be claimed again at once: one test per click.
    if (stop.dryRun) await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
    if (stop.keepTab) {
      await notifyApply(`${application.job.company}: ${stop.message}`);
    } else if (tab?.id != null) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  } finally {
    clearInterval(heartbeat);
    activeReviews.delete(application.attemptId);
    reviewWaiters.delete(application.attemptId);
    await clearManagerNotice(application.attemptId).catch(() => {});
    if (tab?.id != null) {
      await removeReviewPanel(tab.id);
      // The "being debugged" bar goes away with the application.
      await releaseDebugger(tab.id);
    }
  }

  // Skip, Later, a closed tab, or Apply turned off during review: the job is given back.
  async function finishBeforeSubmit(action) {
    const mode = action === 'skip' ? 'skip' : 'later';
    const reason = action === 'skip' ? 'Skipped by the Manager.'
      : action === 'closed' ? 'The review tab was closed; the job went back to the list.'
        : 'The Manager will apply later.';
    await release(mode, reason).catch(() => {});
    if (tab?.id != null && action !== 'closed') await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * After the site's Submit: "Submitted successfully?" stays on the page and in a notification until
 * the Manager answers. Yes makes the bid, No marks the job Failed, "Not submitted" goes back to
 * review. A closed tab leaves the question on the Jobs page. Returns the answer.
 */
async function waitForConfirmation(review, reviewState, answersUsed, current, report, tabIdNow) {
  for (;;) {
    const decision = await askManager(review, reviewState('confirm', { final: true }), 'confirm', 'Check the page or the email, then answer.');
    if (decision.action === 'yes' || decision.action === 'no') {
      const answered = await report('result', { submitted: decision.action === 'yes', appliedAnswers: submittedAnswers(answersUsed, current) });
      if (!answered.success) {
        await notifyApply(answered.message || 'QTS did not record your answer; answer on the Jobs page.');
        return 'unanswered';
      }
      if (decision.action === 'yes' && tabIdNow() != null) await chrome.tabs.remove(tabIdNow()).catch(() => {});
      return decision.action;
    }
    if (decision.action === 'back_to_review') {
      const back = await report('back-to-review', {});
      if (back.success) return 'back_to_review';
      continue;
    }
    if (decision.action === 'closed' || decision.action === 'stopped') {
      await notifyApply(`${review.job.company}: answer "Submitted successfully?" on the Jobs page.`);
      return decision.action;
    }
    // A second Submit click (the site asked again) changes nothing: the question stays.
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
          mode: 'skip',
          reason: recipe.unsupported,
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
