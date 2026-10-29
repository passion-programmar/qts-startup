// Apply with Manager review: takes Generation-completed jobs from the server one at a time (one per
// Chrome), fills each step of the form in a tab of the Manager's current window, and waits for the Manager on every
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
// The longest Apply waits for the AI's answers through the QTS server.
const APPLY_AI_TIMEOUT_MS = 120 * 1000;
// Clicks to reach the form from a job page: "Apply for this job", then perhaps "Apply manually".
const APPLY_START_STEPS = 3;
const APPLY_START_WAIT_MS = 15 * 1000;
let applyLoopRunning = false;

// Development diagnostics: off unless chrome.storage.local has qtsApplyDebug: true (set it from the
// service worker's console). Shown in that console only. Never the candidate's facts, the résumé,
// or written answers: those appear as their source and length.
const APPLY_DEBUG_KEY = 'qtsApplyDebug';
let applyDebug = false;
async function loadApplyDebug() {
  applyDebug = (await chrome.storage.local.get(APPLY_DEBUG_KEY))[APPLY_DEBUG_KEY] === true;
}
function diag(event, data) {
  if (applyDebug) console.debug(`[QTS Apply] ${event}`, data);
}
/** An answer as diagnostics show it: an AI's pick from a list as its option text; anything else redacted. */
function redacted(answer, field) {
  const value = answerText(answer?.value);
  if (typeof answer?.value === 'boolean') return value;
  if (answer?.source === 'ai' && !answer?.fact && field?.options?.length) return value.slice(0, 80);
  return `[${answer?.source || 'value'}, ${value.length} characters]`;
}

class ApplyStop extends Error {
  // A reason to give the job back before Submit: skip=true leaves it for the Manager for good.
  // pageType: what the page was (classifyPage) when that is why Apply stopped.
  constructor(message, { skip = true, keepTab = true, dryRun = false, pageType = null } = {}) {
    super(message);
    this.name = 'ApplyStop';
    this.skip = skip;
    this.dryRun = dryRun;
    this.keepTab = keepTab;
    this.pageType = pageType;
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

/**
 * The window Apply opens its tabs in: the one it used last while that is still open, else the
 * Manager's current one. Only Apply's own tabs there are marked as Apply's, never the window.
 */
async function applyWindowId() {
  const stored = await chrome.storage.session.get(APPLY_WINDOW_KEY);
  const existing = stored[APPLY_WINDOW_KEY];
  if (Number.isInteger(existing)) {
    const window = await chrome.windows.get(existing).catch(() => null);
    if (window) return window.id;
  }
  const windowId = await currentWorkWindowId();
  await chrome.storage.session.set({ [APPLY_WINDOW_KEY]: windowId });
  return windowId;
}

// The form is shown while Apply fills it. It opens next to the Manager's tab as its opener, so
// Chrome shows that tab again when the form closes. active: false opens it behind the Manager's tab.
async function openApplyTab(url, { active = true } = {}) {
  const windowId = await applyWindowId();
  const [shown] = await chrome.tabs.query({ windowId, active: true }).catch(() => []);
  const tab = await chrome.tabs.create({ windowId, url, active, ...(shown?.id != null ? { openerTabId: shown.id } : {}) });
  await tabOwnership.markTab(tab.id, 'apply');
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
    const tab = await getTab(tabId);
    // A closed page never loads: the wait ends at once.
    if (!tab) return false;
    if (tab.status === 'complete') return true;
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
  throw await pageStop(tabId, 'The application form did not appear on the page.');
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
    // An email-first step's "Apply"/"Continue" would send the email on (maybe into a sign-in): never
    // clicked by Apply; the Manager is asked instead.
    const page = await inForm(tab.id, () => globalThis.__qtsApplyForm.classifyPage()).catch(() => null);
    if (['email_first_application', 'authentication_required', 'registration_required', 'verification_required'].includes(page?.type)) {
      throw await pageStop(tab.id, 'The site asks to sign in or create an account.');
    }
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
    const urlBefore = (await getTab(tab.id))?.url;
    let movedOn = false;
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
        movedOn = true;
        break;
      }
      if (await applicationFormShown(tab.id)) return tab;
      if ((await getTab(tab.id))?.url !== urlBefore) movedOn = true;
    }
    // A link the page caught instead of following (Jobgether's sign-up box when not signed in):
    // its address is opened directly, as a person would by opening the link.
    if (!movedOn && start.href) {
      await chrome.tabs.update(tab.id, { url: start.href });
      await sleep(500);
      await waitForTabComplete(tab.id, 45 * 1000);
    }
  }
  if (await applicationFormShown(tab.id)) return tab;
  const closed = await inForm(tab.id, () => globalThis.__qtsApplyForm.jobClosed()).catch(() => '');
  if (closed) throw new ApplyStop(`The job is closed on the site ("${closed}").`);
  const blockers = await inForm(tab.id, () => globalThis.__qtsApplyForm.detectBlockers()).catch(() => []);
  if (blockers?.includes('captcha')) throw new ApplyStop('The site shows a security check (CAPTCHA) before the job page; open it in the Apply window and apply by hand.');
  throw await pageStop(tab.id, 'No application form or Apply button was found on the job page; apply by hand.');
}

/**
 * Why a page is not an application form Apply fills, as a stop with the reason: an email-first step
 * (its Continue may send a sign-in code or open an account page: never followed by Apply), a sign-in
 * page, or the given reason. Apply never signs in, creates accounts, or continues such steps itself.
 */
async function pageStop(tabId, otherwise) {
  const page = await inForm(tabId, () => globalThis.__qtsApplyForm.classifyPage()).catch(() => null);
  diag('page', page);
  const reasons = {
    email_first_application: 'The site asks for an email first; its next step may be a sign-in or a code sent by email. Apply by hand.',
    authentication_required: 'The site asks to sign in or create an account.',
    registration_required: 'The site asks to create an account; apply by hand.',
    verification_required: 'The site asks for a code sent by email or text; apply by hand.',
    captcha_required: 'The site shows a security check (CAPTCHA); open it in the Apply window and apply by hand.',
    application_closed: 'The job is closed on the site.',
    application_submitted: 'The site says an application was already sent.',
  };
  return new ApplyStop(reasons[page?.type] || otherwise, { pageType: page?.type || null });
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
    // Real key presses go wherever the cursor is: never into another question.
    if (!(await inForm(tabId, (id) => globalThis.__qtsApplyForm.cursorInField(id), [field.id]).catch(() => false))) return false;
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

/**
 * A dropdown's choices read after opening it with a real click, closed again with nothing picked;
 * a typed list's box is checked to be as it was. { options, partial, changed }.
 */
async function readChoicesWithRealClick(tabId, field) {
  const state = await inForm(tabId, (id) => globalThis.__qtsApplyForm.fieldStateOf(id), [field.id]).catch(() => null);
  try {
    if (!(await realOpen(tabId, field))) return { options: [], partial: false, changed: false };
    const choices = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownChoiceTexts(id), [field.id]).catch(() => []) || [];
    await realEscape(tabId);
    await sleep(200);
    const changed = await inForm(tabId, (id, before) => globalThis.__qtsApplyForm.restoreFieldState(id, before), [field.id, state]).catch(() => false);
    return { options: choices, partial: choices.length >= 300, changed: Boolean(changed) };
  } catch {
    return { options: [], partial: false, changed: false };
  }
}

/** Picks a dropdown's choice (each one, for a list that takes several) with real clicks; { ok } or { ok: false, error }. */
async function pickWithRealClick(tabId, field, value) {
  const values = [].concat(value).map((entry) => String(entry ?? '').trim()).filter(Boolean);
  if (!values.length) return { ok: false, error: 'no answer' };
  for (const wanted of values) {
    const result = await pickOneWithRealClick(tabId, field, wanted);
    if (!result.ok) return result;
  }
  return { ok: true };
}

async function pickOneWithRealClick(tabId, field, wanted) {
  try {
    // Search lists and suggestion boxes get the answer's first part typed; menus are only opened.
    // Typed up to the first apostrophe, bracket, or slash: "Associate's" may be written "Associate’s".
    const typed = field.kind === 'combobox' || field.kind === 'text' || field.searchable
      ? wanted.split(',')[0].split(/['’(/]/)[0].trim().slice(0, 40)
      : '';
    const findChoice = async (waitMs, exact) => {
      let found = null;
      for (let waited = 0; waited < waitMs && !found; waited += 500) {
        found = await inForm(tabId, (text, id, same) => globalThis.__qtsApplyForm.choiceBox(text, id, same), [wanted, field.id, exact]).catch(() => null);
        if (!found) await sleep(500);
      }
      return found;
    };
    let choice = null;
    // Click first: a list that shows its choices when opened is picked from, with nothing typed. A
    // list that can be searched takes only the same choice then; a menu, which cannot, the closest.
    // A plain text box (Lever's location) shows suggestions only once typed.
    if (field.kind !== 'text') {
      if (!(await realOpen(tabId, field))) return { ok: false, error: 'the field is not on the screen' };
      choice = await findChoice(typed ? 1000 : 3000, Boolean(typed));
    }
    // No choices shown, or not this one among them: typed to search. A search list may fetch its
    // results after typing.
    if (!choice && typed) {
      if (!(await realOpen(tabId, field, typed))) return { ok: false, error: 'the cursor could not be put in the field' };
      choice = await findChoice(3000, false);
    }
    if (!choice) {
      // What the list or suggestion box does offer goes to the AI as the field's choices.
      const choices = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownChoiceTexts(id), [field.id]).catch(() => []);
      await realEscape(tabId);
      // What was typed to search does not stay in the field.
      if (typed) await inForm(tabId, (id) => globalThis.__qtsApplyForm.clearField(id), [field.id]).catch(() => false);
      return { ok: false, error: `the list has no "${wanted}"`, choices: choices || [] };
    }
    await realClick(tabId, choice);
    await sleep(400);
    const shown = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownValue(id), [field.id]).catch(() => '');
    const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, '');
    // A field may show the whole choice or a part of it (a phone country picker shows "+48" for "Poland +48").
    const [now, picked] = [squash(shown), squash(choice.text)];
    if (now && (now.includes(picked) || (now.length >= 2 && picked.includes(now)))) return { ok: true };
    // A list taking several choices shows each as a chip beside its box, which stays empty.
    const chip = await inForm(tabId, (id, text) => globalThis.__qtsApplyForm.choiceShown(id, text), [field.id, choice.text]).catch(() => false);
    return chip ? { ok: true } : { ok: false, error: `it shows "${String(shown).slice(0, 80)}"` };
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

/**
 * Each dropdown's choices before anything is filled, with as little interaction as needed:
 * 1. already in the page (read by the scan, nothing opened); 2. opened by a click, then a real
 * click; 3. only when nothing shows, sample searches typed into a search list (collected, never
 * picked; only some of its choices, so the AI may still give its own wording).
 */
async function readComboboxOptions(tabId, fields) {
  // Fields whose box looking at the choices changed (a tag a site created): checked by the Manager.
  const changed = [];
  const keepChoices = (field, read, source) => {
    diag('discovery', { id: field.id, question: String(field.label || '').slice(0, 80), source, options: read?.options?.length || 0, partial: Boolean(read?.partial), changed: Boolean(read?.changed) });
    if (read?.changed) changed.push(field);
    if (!read?.options?.length) return false;
    field.options = read.options;
    field.optionsSource = source;
    // A list that may hold more than was read (scrolling, more than 300, sample searches) is partial,
    // so a choice outside what was read is still searched for instead of refused.
    if (read.partial || read.options.length >= 300) field.optionsPartial = true;
    return true;
  };
  for (const field of fields) {
    if (field.hidden || field.disabled || field.options?.length) continue;
    if (field.kind === 'combobox') {
      if (keepChoices(field, await inForm(tabId, (id) => globalThis.__qtsApplyForm.discoverComboboxChoices(id), [field.id]).catch(() => null), 'click')) continue;
      // A list that ignores simulated events (React Select) opens for a real click.
      if (keepChoices(field, await readChoicesWithRealClick(tabId, field), 'click')) continue;
      if (!keepChoices(field, await inForm(tabId, (id) => globalThis.__qtsApplyForm.searchComboboxChoices(id), [field.id]).catch(() => null), 'search')) field.options = [];
    } else if (field.kind === 'menu' && field.lazy) {
      field.options = await inForm(tabId, (id) => globalThis.__qtsApplyForm.readMenuOptions(id), [field.id]).catch(() => []);
      if (field.options?.length) field.optionsSource = 'click';
      else keepChoices(field, await readChoicesWithRealClick(tabId, field), 'click');
      field.options ||= [];
      // An optional menu that shows no choices even then is left alone. A required one stays, so a
      // choice it cannot take stops the application rather than sending what it already shows.
      if (!field.options.length && !field.required) field.hidden = true;
    }
  }
  return changed;
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
  application.aiCalls = (application.aiCalls || 0) + 1;
  diag('ai-request', { questions: fields.length, mode: application.aiMode });
  return application.aiMode === 'gemini'
    ? askGeminiForAnswers(application, fields)
    : askChatGptForAnswers(application, fields, keepAlive);
}

async function askAiToFix(application, problems, fields, keepAlive) {
  application.aiCalls = (application.aiCalls || 0) + 1;
  return application.aiMode === 'gemini'
    ? askGeminiToFix(application, problems, fields)
    : askChatGptToFix(application, problems, fields, keepAlive);
}

async function askGemini(application, turns) {
  diag('ai-send', { turns: turns.length, characters: turns.reduce((sum, turn) => sum + String(turn.text || '').length, 0) });
  // A reply that never comes ends as "did not answer" (the Manager writes it, or asks again), never a stall.
  const result = await workerApiRequest('POST', '/api/extension/apply/answers', { attemptId: application.attemptId, turns }, { timeoutMs: APPLY_AI_TIMEOUT_MS });
  diag('ai-reply', { ok: result.success === true, characters: String(result.reply || '').length });
  if (result.success !== true) throw new Error(result.message || 'Gemini did not answer.');
  return String(result.reply || '');
}

/** Gemini's checked answers for a page's open questions, with one follow-up that carries the first turns. */
async function askGeminiForAnswers(application, fields) {
  const helpers = self.__qtsApplyAnswers;
  const first = answerPromptFor(application, fields);
  const reply = await askGemini(application, [{ role: 'user', text: first }]);
  application.geminiTurns = [{ role: 'user', text: first }, { role: 'model', text: reply }];
  const { answers, invalid, review } = helpers.parseAnswerReply(reply, fields);
  noteForReview(application, review, fields);
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
  noteForReview(application, retried.review, retryFields);
  noteUnanswered(application, retried.invalid, retryFields);
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
  const { answers, invalid, review } = helpers.parseAnswerReply(reply, fields);
  noteForReview(application, review, fields);
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
  noteForReview(application, retried.review, retryFields);
  noteUnanswered(application, retried.invalid, retryFields);
  return retried.answers;
}

/**
 * Required questions the AI still could not answer in a form their field takes (not one of the
 * choices, twice): left for the Manager, never a reason to stop the whole application.
 */
function noteForReview(application, review, fields) {
  // Questions the AI found nothing to answer with (status "review"): required ones go to the
  // Manager; optional ones are left empty.
  const required = (review || []).filter((entry) => fields.find((field) => field.id === entry.id)?.required);
  (application.aiReview ||= []).push(...required);
}

function noteUnanswered(application, invalid, fields) {
  const required = invalid.filter((entry) => fields.find((field) => field.id === entry.id)?.required);
  (application.aiUnanswered ||= []).push(...required);
}

/**
 * After the résumé goes into a site's autofill upload, the site reads it and fills the form: waits
 * until the form has stopped changing for 3 seconds (at least 5, at most 20 seconds in all).
 */
async function waitForSiteFill(tabId) {
  const read = () => inForm(tabId, () => JSON.stringify(globalThis.__qtsApplyForm.currentAnswers())).catch(() => '');
  const started = Date.now();
  let last = await read();
  let stableSince = Date.now();
  while (Date.now() - started < 20_000) {
    await sleep(1000);
    const now = await read();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 3000 && Date.now() - started >= 5000) {
      return;
    }
  }
}

/**
 * The résumé and cover letter to upload, printed in a hidden tab of this application's window
 * (shared/chrome-pdf.js). An older server sends them printed already; when printing here fails,
 * QTS prints them, as before.
 */
async function fetchApplyDocuments(attemptId, tabId) {
  const path = `/api/extension/apply/documents?attemptId=${encodeURIComponent(attemptId)}`;
  const forChrome = await workerApiRequest('GET', `${path}&print=chrome`);
  if (forChrome.success === true && !forChrome.documents?.print) return forChrome.documents;
  if (forChrome.success === true) {
    const { print, ...documents } = forChrome.documents;
    const printed = await self.__qtsChromePdf.printDocuments(print, {
      serverUrl: await self.__qtsRuntimeConfig.getServerUrl(),
      windowId: (await getTab(tabId))?.windowId,
    });
    if (printed) {
      return {
        ...documents,
        resume: { ...documents.resume, base64: printed.resume },
        coverLetter: { ...documents.coverLetter, base64: printed['cover-letter'] },
      };
    }
  } else if (forChrome.retry !== true) {
    throw new ApplyStop(forChrome.message || 'The résumé could not be prepared.', { skip: false });
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await workerApiRequest('GET', path);
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
// A site's "this field is required" message, in the languages forms use.
const REQUIRED_MESSAGE = /required|mandatory|cannot be (empty|blank)|wymagane|obowi[aą]zkowe|pflicht|erforderlich|obligatoire|obligatorio|obrigat[oó]rio|obbligatorio/i;

// The fill attempts of the step being filled, for its report (one page is filled at a time per
// Chrome: test mode runs one application, the assistant's pages take turns).
let stepAttempts = null;

async function fillAndCheck(tabId, field, answer, file, seen) {
  const outcome = await fillAndCheckField(tabId, field, answer, file, seen);
  stepAttempts?.push({
    fieldId: field.id,
    action: file ? 'upload' : field.kind === 'file' ? 'upload' : 'fill',
    source: answer?.source || (file ? 'documents' : 'unknown'),
    verified: Boolean(outcome.ok),
    ...(outcome.gone ? { gone: true } : {}),
    ...(outcome.error ? { error: String(outcome.error).slice(0, 160) } : {}),
  });
  diag('fill', {
    id: field.id,
    question: String(field.label || '').slice(0, 80),
    type: field.kind,
    source: answer?.source || (file ? 'documents' : 'unknown'),
    intended: file ? `[file ${answer?.file}]` : redacted(answer, field),
    verified: Boolean(outcome.ok),
    ...(outcome.gone ? { gone: true } : {}),
    ...(outcome.error ? { error: String(outcome.error).slice(0, 160) } : {}),
  });
  return outcome;
}

async function fillAndCheckField(tabId, field, answer, file, seen) {
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
    // The choices either way of opening it showed go to the AI, so it picks one the field has.
    const choices = real.choices?.length ? real.choices : result?.choices;
    result = real.ok ? { ok: true } : { ok: false, error: `${result?.error || 'not taken'}; with real clicks: ${real.error}`, choices };
  }
  // Radio and tick-box options a site ignores simulated clicks on get real clicks on their labels.
  if (!result?.ok && ['radio', 'checkbox-group'].includes(field.kind)) {
    const real = await checkWithRealClick(tabId, { ...field, id: fieldId }, answer.value);
    result = real.ok ? { ok: true } : { ok: false, error: `${result?.error || 'not taken'}; with real clicks: ${real.error}` };
  }
  if (!result?.ok) return { ok: false, error: result?.error || `it holds "${result?.value ?? ''}"`, choices: result?.choices || [] };
  const issue = await inForm(tabId, (id) => globalThis.__qtsApplyForm.fieldIssue(id), [fieldId]).catch(() => '');
  // "This field is required" left from before the pick, under a field that now holds its answer, is
  // not the site rejecting it: the answer matched, and the field is not filled again.
  if (issue && REQUIRED_MESSAGE.test(issue)) {
    const empty = await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [{ ...field, id: fieldId }]).catch(() => true);
    if (!empty) return { ok: true };
  }
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
/**
 * Fills one form page. options.assist (Apply as the Manager's assistant): only what QTS knows for
 * sure (documents, cover letter, profile facts, reusable answers; no AI), never a text box that
 * already holds something, never a box options.skip(field) says was met on an earlier pass, never a
 * box outside the application (search, newsletter), and no checks for the Manager (the panel lists
 * what is still empty); only uploads and values the site refused are reported. The résumé and
 * cover letter are prepared once per application and reused on every page.
 */
async function fillFormPage(tabId, application, keepAlive, step, options = {}) {
  const helpers = self.__qtsApplyAnswers;
  const assist = options.assist === true;
  const skip = options.skip || (() => false);
  const used = {};
  const problems = [];
  let canAskAgain = false;
  const seen = new Set();
  const uploaded = new Set();
  let documents = assist ? application.assistDocuments || null : null;
  const keepDocuments = (ready) => {
    if (assist && ready?.resume?.base64) application.assistDocuments = ready;
  };
  let rechecked = false;
  // The step's report: every question met, how long each stage took, how many AI requests.
  stepAttempts = [];
  const metFields = new Map();
  const timings = { discovery: 0, ai: 0, checks: 0 };
  const stepStarted = Date.now();
  const aiCallsBefore = application.aiCalls || 0;
  const problem = (message, field = null, kind = 'field') => {
    if (!problems.some((entry) => entry.message === message)) problems.push({ message, fieldId: field?.id ?? null, kind });
  };
  // An AI answer that changed a profile fact's meaning, not only its form ("United Kingdom" for a
  // profile saying Romania), is never filled: the Manager fills that question.
  /**
   * Dependent lists (Country → Region → City): a dropdown below a choice filled in this round may
   * offer other choices now. Its choices are read again (from the page; a list read by a click is
   * opened again, never typed into) and its answer decided again with them: the profile or a
   * reusable answer may fit now, and the AI gets the current list. Returns the questions left for the AI.
   */
  const refreshDependentChoices = async (toAsk, position, lastFilledChoice) => {
    if (lastFilledChoice < 0) return toAsk;
    const changed = [];
    for (const field of toAsk) {
      if (!['select', 'menu', 'combobox'].includes(field.kind) || (position.get(field.id) ?? -1) <= lastFilledChoice) continue;
      let options = await inForm(tabId, (id) => globalThis.__qtsApplyForm.currentChoices(id), [field.id]).catch(() => null);
      let partial = false;
      if (!options && field.optionsSource === 'click') {
        const read = await inForm(tabId, (id) => globalThis.__qtsApplyForm.discoverComboboxChoices(id), [field.id]).catch(() => null);
        options = read?.options?.length ? read.options : null;
        partial = Boolean(read?.partial);
      }
      if (!options || JSON.stringify(options) === JSON.stringify(field.options || [])) continue;
      diag('dependent', { id: field.id, question: String(field.label || '').slice(0, 80), before: (field.options || []).length, after: options.length });
      field.options = options;
      field.optionsPartial = partial || options.length >= 300 || undefined;
      changed.push(field);
    }
    if (!changed.length) return toAsk;
    // Decided afresh: the earlier hint and value meant were for the old choices.
    const plain = changed.map((field) => {
      const copy = { ...field };
      delete copy.hint;
      delete copy.intended;
      delete copy.fact;
      return copy;
    });
    const again = helpers.resolveFields(plain, application.candidate, application.savedAnswers, {
      exchangeRates: application.exchangeRates,
      today: new Date(),
      coverLetterText: application.job.coverLetterText,
    });
    for (const entry of again.byHand || []) problem(entry.message, entry, assist ? 'profile' : 'field');
    const left = toAsk.filter((field) => !changed.includes(field));
    for (const field of plain) {
      const answer = again.answers[field.id];
      const reopened = again.open.find((entry) => entry.id === field.id);
      if (answer && !answer.file && (!assist || ASSIST_SOURCES.has(answer.source))) {
        const outcome = await fillAndCheck(tabId, field, answer, null, seen);
        if (outcome.ok) {
          used[usedKey(used, field)] = { ...answer, step, fieldId: field.id, ...fieldFacts(field) };
          continue;
        }
        if (!outcome.gone) left.push({ ...field, hint: `The candidate's profile or a reusable answer says "${answerText(answer.saved ?? answer.value)}", but the site did not take it (${outcome.error}); give it in a form this field takes.`, intended: answer.intended ?? answerText(answer.saved ?? answer.value), ...(answer.fact ? { fact: answer.fact } : {}) });
      } else if (reopened) {
        left.push(reopened);
      }
    }
    return left;
  };
  // A question answered in this step that still shows its answer is never filled again: not when
  // the page draws it anew after the pick (a new element, so a new id), not when a check cannot
  // see the answer in its box (a chip beside it).
  const stillAnswered = async (field) => {
    const before = HAS_WORDS.test(field.label || '') ? used[field.label] : null;
    if (!before || before.step !== step) return false;
    const empty = await inForm(tabId, (entry) => globalThis.__qtsApplyForm.isUnanswered(entry), [field]).catch(() => true);
    if (!empty) return true;
    return inForm(tabId, (id, text) => globalThis.__qtsApplyForm.choiceShown(id, text), [field.id, answerText(before.value)]).catch(() => false);
  };
  const keepProfileMeaning = (answersById, fields) => {
    // Required questions the AI could not answer in a form their field takes: the Manager's.
    for (const entry of (application.aiUnanswered || []).splice(0)) {
      problem(`Fill by hand: "${entry.label}" — ${aiName(application)} gave no answer this field takes (${entry.reason}).`, entry);
    }
    for (const entry of (application.aiReview || []).splice(0)) {
      problem(`Fill by hand: "${entry.label}" — ${aiName(application)} found nothing in the profile, résumé, or job description to answer it.`, entry);
    }
    for (const field of fields) {
      const answer = answersById[field.id];
      if (!answer) continue;
      if (helpers.keepsMeaning(field, answer.value)) {
        if (answer.alternatives) answer.alternatives = answer.alternatives.filter((value) => helpers.keepsMeaning(field, value));
        continue;
      }
      delete answersById[field.id];
      const from = field.fact === 'answer' ? 'the reusable answer' : 'the profile';
      problem(`Fill by hand: "${field.label}" — ${from} says "${field.intended}", and ${aiName(application)}'s "${answerText(answer.value)}" does not say the same.`, field);
    }
    return answersById;
  };
  for (let round = 0; round < APPLY_FILL_ROUNDS + 1; round += 1) {
    const fields = assist
      ? await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist())
      : round === 0
        ? await waitForFormFields(tabId)
        : await inForm(tabId, () => globalThis.__qtsApplyForm.scanForm());
    if (round === 0 && !assist) {
      await inForm(tabId, () => globalThis.__qtsApplyForm.declineCookies()).catch(() => false);
      const blockers = await inForm(tabId, () => globalThis.__qtsApplyForm.detectBlockers());
      if (blockers?.includes('login')) throw new ApplyStop('The site asks to sign in or create an account.');
    }
    if (applyDebug) {
      diag('round', { step, round, fields: (fields || []).length, seen: seen.size });
      if (round === 0) {
        const schema = await inForm(tabId, () => globalThis.__qtsApplyForm.formSchema()).catch(() => null);
        diag('form', schema && {
          schemaVersion: schema.schemaVersion,
          pageType: schema.page.type,
          revision: schema.page.revision,
          discoveryStatus: schema.discoveryStatus,
          unresolvedFields: schema.unresolvedFields,
          actions: schema.actions,
          fields: schema.fields.map((entry) => ({
            id: entry.id, question: entry.question.slice(0, 80), elementType: entry.elementType, inputType: entry.inputType,
            valueType: entry.valueType, required: entry.required, options: entry.options.length,
            optionsStatus: entry.optionsDiscovery.status, labelConfidence: entry.labelConfidence, lifecycle: entry.lifecycle,
            filled: Boolean(entry.currentValue),
          })),
        });
      }
    }
    const fresh = [];
    for (const field of fields || []) {
      if (field.hidden || field.disabled || seen.has(field.id)) continue;
      // The Manager's or the site's own text stays; a question met before is the Manager's now.
      if (assist && (field.filled || field.unrelated || field.account || skip(field))) continue;
      // Drawn again by the page after its answer was picked (a new element): kept as it is.
      if (await stillAnswered(field)) {
        seen.add(field.id);
        used[field.label].fieldId = field.id;
        continue;
      }
      fresh.push(field);
    }
    if (!fresh.length) {
      // Complete before review: a required question still empty (an answer the site dropped, or
      // one asked before it was ready) gets one more round, as if new.
      if (rechecked) break;
      rechecked = true;
      const empty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
      let again = 0;
      for (const entry of empty || []) {
        // Already listed for the Manager with its reason (by hand, AI gave nothing it takes): not retried.
        if (problems.some((known) => known.fieldId && known.fieldId === entry.id)) continue;
        // One the page shows answered another way (a chip, a value outside its box) stays answered.
        if (await stillAnswered((fields || []).find((field) => field.id === entry.id) || entry)) continue;
        seen.delete(entry.id);
        again += 1;
      }
      if (!again) break;
      continue;
    }
    for (const field of fresh) seen.add(field.id);
    // Résumé first: a form that reads the résumé to fill itself ("Autofill from resume", "Easy
    // Apply") gets it before anything else, once per application. The form is then read again.
    const autofill = !application.resumeAutofillTried && fresh.find((field) => helpers.isAutofillUpload(field));
    if (autofill) {
      application.resumeAutofillTried = true;
      if (!documents) {
        try {
          documents = await fetchApplyDocuments(application.attemptId, tabId);
          application.documentsFolder = documents.folder;
          keepDocuments(documents);
        } catch {
          documents = {};
        }
      }
      if (documents?.resume?.base64) {
        const outcome = await fillAndCheck(tabId, autofill, { file: 'resume', source: 'documents' }, { ...documents.resume, mimeType: 'application/pdf' }, seen);
        if (outcome.ok) {
          application.siteFilledFromResume = true;
          await waitForSiteFill(tabId);
          for (const field of fresh) if (field.id !== autofill.id) seen.delete(field.id);
          round -= 1;
          continue;
        }
      }
    }
    for (const field of fresh) metFields.set(field.id, field);
    const discoveryStarted = Date.now();
    // The assistant opens only the lists it has an answer for: no list opens on the page for nothing.
    const toDiscover = assist
      ? fresh.filter((field) => ASSIST_SOURCES.has(helpers.resolveFields([field], application.candidate, application.savedAnswers, {
        exchangeRates: application.exchangeRates, today: new Date(), coverLetterText: application.job.coverLetterText,
      }).answers[field.id]?.source))
      : fresh;
    const changedByLooking = await readComboboxOptions(tabId, toDiscover);
    timings.discovery += Date.now() - discoveryStarted;
    for (const field of changedByLooking) {
      problem(`Check "${field.label}": looking at its choices changed it; set it as it should be.`, field);
    }
    const resolved = helpers.resolveFields(fresh, application.candidate, application.savedAnswers, {
      exchangeRates: application.exchangeRates,
      today: new Date(),
      coverLetterText: application.job.coverLetterText,
    });
    const { answers } = resolved;
    // The assistant fills only the documents, the profile's facts, and reusable answers (no rules,
    // no consent ticks): the rest is the Manager's.
    if (assist) for (const [id, answer] of Object.entries(answers)) if (!ASSIST_SOURCES.has(answer.source)) delete answers[id];
    diag('resolved', { step, round, answered: Object.keys(answers).length, toAi: resolved.open.length, byHand: (resolved.byHand || []).length });
    // A personal fact the profile lacks is the Manager's to fill, never the AI's to guess.
    for (const entry of resolved.byHand || []) problem(entry.message, entry, assist ? 'profile' : 'field');
    // "Fill again" reuses this application's earlier answers instead of asking ChatGPT again.
    const open = resolved.open.filter((field) => {
      // What the site filled from the résumé is kept, not asked of the AI again.
      if (application.siteFilledFromResume && field.filled) return false;
      const cached = HAS_WORDS.test(field.label || '') && application.answerCache?.get(field.label);
      if (!cached) return true;
      answers[field.id] = cached;
      return false;
    });
    if (!documents && Object.values(answers).some((answer) => answer.file)) {
      try {
        documents = await fetchApplyDocuments(application.attemptId, tabId);
        application.documentsFolder = documents.folder;
        keepDocuments(documents);
      } catch (error) {
        problem(`The résumé could not be prepared (${error instanceof Error ? error.message : 'unknown error'}); upload it by hand from the folder above.`, null, 'upload');
        documents = {};
      }
    }

    // 1. The profile's answers, in page order; one the site does not take goes to ChatGPT.
    const rejected = [];
    const position = new Map(fresh.map((field, index) => [field.id, index]));
    // The last choice question filled in this round, in page order: lists below it may have changed.
    let lastFilledChoice = -1;
    const noteFilled = (field) => {
      if (CHOICE_KINDS.has(field.kind)) lastFilledChoice = Math.max(lastFilledChoice, position.get(field.id) ?? -1);
    };
    for (const field of fresh) {
      const answer = answers[field.id];
      if (!answer) {
        // Filled by the site from the résumé: kept, and listed so the Manager can check it.
        if (field.filled && application.siteFilledFromResume) {
          const value = await inForm(tabId, (id) => globalThis.__qtsApplyForm.shownValue(id), [field.id]).catch(() => '');
          if (value) used[usedKey(used, field)] = { value, source: 'site', step, fieldId: field.id, ...fieldFacts(field) };
          continue;
        }
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
      // Each document goes up once per step; a site may redraw its upload field after taking it. A
      // page that reloaded (a language switch) has lost it: then it goes up again.
      if (answer.file && uploaded.has(answer.file)) {
        const holds = await inForm(tabId, (id) => globalThis.__qtsApplyForm.uploadHolds(id), [field.id]).catch(() => true);
        if (holds) continue;
        uploaded.delete(answer.file);
      }
      const outcome = await fillAndCheck(tabId, field, answer, file, seen);
      if (outcome.gone) continue;
      if (outcome.ok) {
        if (answer.file) uploaded.add(answer.file);
        else used[usedKey(used, field)] = { ...answer, step, fieldId: field.id, ...fieldFacts(field) };
        noteFilled(field);
      } else if (answer.file) {
        // A cover letter that could not be attached is typed instead where the site offers it.
        const typed = answer.file === 'coverLetter' && application.job.coverLetterText
          && await inForm(tabId, (id) => globalThis.__qtsApplyForm.enterManually(id), [field.id]).catch(() => false);
        if (!typed && field.required) problem(`The ${answer.file === 'coverLetter' ? 'cover letter' : 'résumé'} upload failed: add it by hand ("${field.label}") from the folder above.`, field, 'upload');
      } else if (answer.source === 'documents') {
        if (field.required) problem(`"${field.label}" did not take the cover letter text; paste it by hand.`, field);
      } else {
        // The profile's fact in the words of the choices the field showed ("Rumunia" for
        // "Romania", "RO"): filled without the AI.
        const meant = answer.intended ?? answerText(answer.saved ?? answer.value);
        const same = answer.fact && outcome.choices?.length ? helpers.sameFactOption(answer.fact, meant, outcome.choices) : null;
        if (same) {
          const converted = { ...answer, value: same, intended: meant };
          const again = await fillAndCheck(tabId, field, converted, null, seen);
          if (again.gone) continue;
          if (again.ok) {
            used[usedKey(used, field)] = { ...converted, step, fieldId: field.id, ...fieldFacts(field) };
            noteFilled(field);
            continue;
          }
        }
        // The value that did not fit goes to ChatGPT with what it was (the profile's fact or a
        // reusable answer and its note), the site's reason, and the choices the field showed.
        if (assist) {
          problem(`Fill by hand: "${field.label}" — the site did not take ${answer.source === 'reusable' ? 'the reusable answer' : 'the profile\'s'} "${meant}".`, field, 'check');
          continue;
        }
        const was = answer.source === 'reusable'
          ? `The reusable answer for this question is "${answer.saved ?? answer.value}"${answer.note ? ` (note: ${answer.note})` : ''}`
          : `The candidate's profile says "${meant}"`;
        rejected.push({
          ...field,
          ...(outcome.choices?.length ? choicesSeen(field, outcome.choices) : {}),
          hint: `${was}, but the site did not take it (${outcome.error}); give it in a form this field takes.`,
          intended: meant,
          ...(answer.fact ? { fact: answer.fact } : {}),
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
      if (!choice || !helpers.keepsMeaning(field, choice)) {
        remaining.push(field);
        continue;
      }
      const outcome = await fillAndCheck(tabId, field, { value: choice, source: 'saved' }, null, seen);
      if (outcome.ok) {
        used[usedKey(used, field)] = { value: choice, source: 'saved', step, fieldId: field.id, ...fieldFacts(field) };
        noteFilled(field);
      } else if (!outcome.gone) remaining.push(field);
    }
    toAsk = await refreshDependentChoices(remaining, position, lastFilledChoice);
    if (toAsk.length && !assist) {
      try {
        const aiStarted = Date.now();
        const aiAnswers = keepProfileMeaning(await askAiForAnswers(application, toAsk, keepAlive), toAsk);
        timings.ai += Date.now() - aiStarted;
        const issues = [];
        const fillAnswers = async (answersById, fieldsToFill, onRejected) => {
          for (const field of fieldsToFill) {
            const { alternatives = [], ...first } = answersById[field.id] || {};
            if (!('value' in first)) continue;
            let answer = first;
            let outcome = await fillAndCheck(tabId, field, answer, null, seen);
            // A dropdown whose choices could not be read: the AI's other wordings of the same answer,
            // in its order, before asking it again.
            for (const value of alternatives) {
              if (outcome.ok || outcome.gone) break;
              const next = { ...first, value };
              const tried = await fillAndCheck(tabId, field, next, null, seen);
              if (tried.ok || tried.gone) answer = next;
              // The choices any attempt showed go to the follow-up.
              outcome = tried.ok || tried.gone || tried.choices?.length ? tried : { ...tried, choices: outcome.choices };
            }
            if (outcome.gone) continue;
            if (outcome.ok) used[usedKey(used, field)] = { ...answer, step, fieldId: field.id, ...fieldFacts(field) };
            else onRejected(field, alternatives.length ? { ...first, value: [first.value, ...alternatives] } : first, outcome.error, outcome.choices);
          }
        };
        await fillAnswers(aiAnswers, toAsk, (field, answer, error, choices) => {
          // The follow-up offers the choices the field showed when the answer was typed.
          if (choices?.length) Object.assign(field, choicesSeen(field, choices));
          issues.push({ id: field.id, label: field.label, reason: `the site did not take "${[].concat(answer.value).join(' | ')}": ${error}` });
        });
        if (issues.length) {
          const tried = new Map(issues.map((entry) => [entry.id, entry.reason]));
          try {
            const fixed = keepProfileMeaning(await askAiToFix(application, issues, toAsk, keepAlive), toAsk);
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
  if (assist) {
    stepAttempts = null;
    // What the Manager must do, and why: an upload, a value the site refused, a fact the profile lacks.
    return { used, problems: problems.filter((entry) => ['upload', 'check', 'profile'].includes(entry.kind)), met: [...metFields.values()] };
  }
  const checksStarted = Date.now();
  const stillEmpty = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequired()).catch(() => []);
  // A question already listed with its reason (a fact the profile lacks) is not listed again.
  const listed = (entry) => problems.some((known) => known.fieldId && known.fieldId === entry.id);
  for (const entry of stillEmpty || []) if (!listed(entry)) problem(`Still empty: "${entry.label}".`, entry);
  // The safety net: questions the page shows as required that Apply could not read, or left empty.
  const unread = await inForm(tabId, () => globalThis.__qtsApplyForm.unreadRequired()).catch(() => []);
  for (const entry of (unread || []).filter((item) => !listed(item))) {
    problem(entry.kind === 'unread' ? `QTS couldn't read this question — check it: "${entry.label}".` : `Still empty: "${entry.label}".`, entry);
  }
  // A required upload left empty (lost to a reload, refused by the site) is never assumed done.
  const emptyUploads = await inForm(tabId, () => globalThis.__qtsApplyForm.emptyRequiredUploads()).catch(() => []);
  for (const entry of (emptyUploads || []).filter((item) => !listed(item))) {
    problem(`Upload by hand: "${entry.label}" is required and still empty (the files are in the folder above).`, entry, 'upload');
  }
  // A frame from another site the browser does not let QTS read may hold questions: the Manager is told.
  const frames = await inForm(tabId, () => globalThis.__qtsApplyForm.unreadableFrames()).catch(() => []);
  for (const host of [...new Set(frames || [])]) problem(`Part of this page comes from ${host}, which QTS cannot read: check it for questions to answer.`);
  const errors = await inForm(tabId, () => globalThis.__qtsApplyForm.fieldErrors()).catch(() => []);
  for (const text of errors || []) problem(`The form shows: ${text}`);
  timings.checks = Date.now() - checksStarted;
  const report = stepReport(step, metFields, used, problems, stepAttempts, {
    ...timings, total: Date.now() - stepStarted,
  }, (application.aiCalls || 0) - aiCallsBefore);
  diag('step-report', report);
  stepAttempts = null;
  return { used, problems, canAskAgain, report };
}

async function browserName() {
  const stored = await chrome.storage.local.get('qtsBrowserName');
  return stored.qtsBrowserName || `Chrome · ${String(await self.__qtsApiWorker.workerBrowserKey()).slice(0, 4).toUpperCase()}`;
}

/**
 * A form step's report, from what the runner already keeps (no second record): the answer plan
 * (each question met: its type, the source and status of its answer) and the execution results
 * (each fill attempt: verified or why not), with totals, stage times, and AI requests. Values are
 * never in it: questions and sources only.
 */
function stepReport(step, metFields, used, problems, attempts, timings, aiCalls) {
  const answered = new Map(Object.values(used).filter((entry) => entry.fieldId).map((entry) => [entry.fieldId, entry]));
  // Uploads are not kept with the typed answers: a verified upload attempt counts as answered.
  for (const attempt of attempts) {
    if (attempt.action === 'upload' && attempt.verified && !answered.has(attempt.fieldId)) answered.set(attempt.fieldId, { source: attempt.source });
  }
  const flagged = new Map(problems.filter((entry) => entry.fieldId).map((entry) => [entry.fieldId, entry.message]));
  const plan = [...metFields.values()].map((field) => {
    const answer = answered.get(field.id);
    return {
      fieldId: field.id,
      question: String(field.label || '').slice(0, 80),
      type: field.kind,
      options: (field.options || []).length,
      optionsStatus: !CHOICE_KINDS.has(field.kind) ? 'not_applicable' : !(field.options || []).length ? 'unknown' : field.optionsPartial ? 'partial' : 'complete',
      source: answer?.source || null,
      status: answer ? 'verified' : flagged.has(field.id) ? 'needs_review' : field.labelUnresolved ? 'unresolved' : 'left',
      ...(flagged.has(field.id) ? { reason: String(flagged.get(field.id)).slice(0, 160) } : {}),
    };
  });
  const count = (status) => plan.filter((entry) => entry.status === status).length;
  return {
    step,
    fields: plan.length,
    verified: count('verified'),
    needsReview: count('needs_review'),
    unresolved: count('unresolved'),
    left: count('left'),
    attempts: attempts.length,
    failedAttempts: attempts.filter((entry) => !entry.verified && !entry.gone).length,
    aiCalls,
    timingsMs: timings,
    plan,
    execution: attempts,
  };
}

/**
 * The choices a failed fill showed (often search results for what was typed), for the follow-up:
 * never a complete list, and a complete list read before is kept.
 */
function choicesSeen(field, choices) {
  return field.options?.length && !field.optionsPartial ? {} : { options: choices, optionsPartial: true };
}

// A question's text has words; a lone required mark ("*") does not.
const HAS_WORDS = /\p{L}{2}/u;

/**
 * The record's name for a field's answer: its question, unless that has no words or another field
 * already answered under it; then made unique, so answers never overwrite each other.
 */
function usedKey(used, field) {
  const label = String(field.label || '').trim();
  const base = HAS_WORDS.test(label) ? label : `${label || 'Question'} (${field.id})`;
  let key = base;
  for (let count = 2; used[key] && used[key].fieldId !== field.id; count += 1) key = `${base} (${count})`;
  return key;
}

// What Apply's question memory keeps about a field: a choice or text question, the choices it
// offered, and the value meant when one did not fit as written.
const CHOICE_KINDS = new Set(['select', 'menu', 'combobox', 'radio', 'checkbox-group', 'checkbox']);
function fieldFacts(field) {
  const options = Array.isArray(field.options) ? field.options.slice(0, 30).map((option) => String(option)) : [];
  // A value meant for the field (a profile fact changed only in form) is kept from the answer when the field has none.
  return { kind: options.length || CHOICE_KINDS.has(field.kind) ? 'choice' : 'text', options, ...(field.intended != null ? { intended: field.intended } : {}), ...(field.fact ? { fact: field.fact } : {}) };
}

/** An answer as the record shows it: lists joined, tick boxes as Ticked/Not ticked. */
function answerText(value) {
  if (Array.isArray(value)) return value.map(String).join(' | ');
  if (typeof value === 'boolean') return value ? 'Ticked' : 'Not ticked';
  return String(value ?? '');
}

// Two values compared as words, case and punctuation aside.
const simpleText = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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

// The assistant's decisions that came while its page was busy (the page closed while it loaded, a
// click during a fill): kept and handled as soon as it waits again, never lost.
const earlyDecisions = new Map();
// An ending replaces a click kept earlier; a click never replaces an ending.
const ENDING_ACTIONS = new Set(['closed', 'cancel', 'remove', 'stopped', 'later', 'lost']);

function waitForManager(attemptId) {
  const early = earlyDecisions.get(attemptId);
  if (early) {
    earlyDecisions.delete(attemptId);
    return Promise.resolve(early);
  }
  return new Promise((resolve) => reviewWaiters.set(attemptId, resolve));
}

function answerManager(attemptId, decision) {
  const resolve = reviewWaiters.get(attemptId);
  if (!resolve) {
    if (!activeReviews.get(attemptId)?.assist) return false;
    const kept = earlyDecisions.get(attemptId);
    if (!kept || (ENDING_ACTIONS.has(decision.action) && !ENDING_ACTIONS.has(kept.action))) earlyDecisions.set(attemptId, decision);
    return true;
  }
  reviewWaiters.delete(attemptId);
  resolve(decision);
  return true;
}

// The assistant's panel (state.assist: the job page with the profile) or the review panel.
async function showReviewPanel(tabId, state) {
  const panel = state?.assist ? 'content/apply-assist.js' : 'content/apply-review.js';
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/apply-form.js', panel] });
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: (next) => (next?.assist ? globalThis.__qtsApplyAssist : globalThis.__qtsApplyReview)?.render(next),
    args: [state],
  });
}

async function removeReviewPanel(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => {
      globalThis.__qtsApplyReview?.remove();
      globalThis.__qtsApplyAssist?.remove();
    },
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
    // New boxes on an assistant's page: filled at once.
    if (msg.action === 'fields_changed') {
      activeReviews.get(msg.attemptId)?.assistant?.poke(sender.tab?.id);
      return { ok: true };
    }
    // "Fill again" on the panel: this page as if the job were new.
    if (msg.action === 'refill') {
      activeReviews.get(msg.attemptId)?.assistant?.refill(sender.tab?.id);
      return { ok: true };
    }
    if (msg.action === 'open_folder') {
      const review = activeReviews.get(msg.attemptId);
      return review?.resumeFolder ? openDownloadedFolder(review.resumeFolder) : { ok: false, error: 'No résumé folder for this job.' };
    }
    if (answerManager(msg.attemptId, { action: msg.action, answers: msg.answers || null, noticed: msg.noticed === true, tabId: sender.tab?.id })) {
      return { ok: true };
    }
    return msg.assist
      ? answerAssistWithoutRunner(msg, sender.tab?.id)
      : answerWithoutRunner(msg.attemptId, msg.action, sender.tab?.id);
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

/**
 * The assistant's panel answered after the worker restarted (its application is no longer running
 * here). Only Submitted or Yes records anything: the bid, and the job row deleted. Cancel lets the
 * job go with nothing recorded.
 */
async function answerAssistWithoutRunner(msg, tabId) {
  const { attemptId, action } = msg;
  const post = (path, body = {}) => workerApiRequest('POST', `/api/extension/apply/${path}`, { attemptId, ...body });
  let result;
  if (action === 'submitted') {
    // The form's answers as the panel read them (a plain question and answer each).
    const appliedAnswers = (Array.isArray(msg.answers) ? msg.answers : [])
      .map((entry) => ({ question: String(entry?.label || '').slice(0, 300), answer: String(entry?.value || '').slice(0, 2000), source: 'manager' }))
      .filter((entry) => entry.question && entry.answer);
    await post('submitted', { appliedAnswers });
    result = await post('result', { submitted: true, removeJob: true, appliedAnswers });
    // The application record is gone (its hold ran out while QTS was away): the bid from the job.
    if (!result?.success && result?._httpStatus === 409 && typeof msg.jobId === 'string') {
      result = await workerApiRequest('POST', '/api/extension/apply/save-bid', { jobId: msg.jobId, appliedAnswers });
    }
  } else if (action === 'cancel') {
    result = await post('release', { mode: 'drop', reason: 'Cancelled by the Manager.' });
    if (result?.success) await noteCancelledJob(msg.jobId);
  } else if (action === 'remove') {
    result = await post('release', { mode: 'remove', reason: 'Removed by the Manager.' });
  } else {
    return { ok: false, error: 'Apply restarted in this Chrome: if the site took the application, click Submitted; else Cancel.' };
  }
  if (result?.success) await forgetApplySession(attemptId);
  if (result?.success && tabId != null) {
    await removeReviewPanel(tabId);
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  return result?.success ? { ok: true } : { ok: false, error: result?.message || 'QTS did not record it.' };
}

// The application each tab holds while it waits for the Manager: the panel comes back after the
// page reloads or moves to the site's next step.
const activeReviews = new Map();

// The applications open in this Chrome, for the QTS panel's Apply row in every tab.
const APPLY_STATE_KEY = 'qtsApplyState';
function publishApplyState() {
  const open = [...activeReviews.values()].map((review) => ({
    attemptId: review.attemptId,
    candidate: review.candidate,
    title: review.job?.title || '',
    company: review.job?.company || '',
  }));
  try {
    Promise.resolve(chrome.storage?.local?.set({ [APPLY_STATE_KEY]: { open } })).catch(() => {});
  } catch {
    // Only the panel's Apply row reads it.
  }
}
// A worker that restarted holds none until it takes its pages up again.
publishApplyState();

// The panel's list of open applications: a click brings that application's page to the front.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'QTS_SHOW_APPLICATION') return false;
  const tabId = activeReviews.get(msg.attemptId)?.tabId;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'That application is no longer open in this Chrome.' });
    return false;
  }
  focusApplyTab(tabId).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false, error: 'QTS could not show that page.' }));
  return true;
});

/** The tabs an application lives in: the assistant's job page and the tabs opened from it. */
const tabsOf = (review) => review.tabIds || new Set(review.tabId != null ? [review.tabId] : []);

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  for (const review of activeReviews.values()) {
    if (!tabsOf(review).has(tabId) || !review.panel) continue;
    if (review.panel.mode === 'review') {
      // The page changed under a review: the Manager clicked the site's Next (go on to the next
      // step) or Submit (ask Yes/No) themselves.
      answerManager(review.attemptId, { action: review.panel.final ? 'submitted' : 'continue_manual', noticed: true });
    }
    showReviewPanel(tabId, review.panel).catch(() => {});
    // A page loaded in an assistant's tab (a redirect, a sign-in, the next step): filled at once.
    review.assistant?.poke(tabId);
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

// An assistant's page ends only when all its tabs are closed; the latest one left is worked in.
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const review of activeReviews.values()) {
    if (!review.tabIds) {
      if (review.tabId === tabId) answerManager(review.attemptId, { action: 'closed' });
      continue;
    }
    if (!review.tabIds.delete(tabId)) continue;
    if (!review.tabIds.size) answerManager(review.attemptId, { action: 'closed' });
    else {
      if (review.tabId === tabId) review.tabId = [...review.tabIds].pop();
      rememberApplySession(review).catch(() => {});
    }
  }
});

// A tab the job page opens ("Apply on the employer's site", a next step) joins its application: the
// panel shows there, QTS fills there, and its Submit counts.
chrome.tabs.onCreated.addListener((tab) => {
  for (const review of activeReviews.values()) {
    if (!review.tabIds || tab.openerTabId == null || !review.tabIds.has(tab.openerTabId)) continue;
    review.tabIds.add(tab.id);
    review.tabId = tab.id;
    tabOwnership.markTab(tab.id, 'apply').catch(() => {});
    rememberApplySession(review).catch(() => {});
  }
});

// The tab the Manager looks at is the one QTS fills.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  for (const review of activeReviews.values()) {
    if (review.tabIds?.has(tabId)) review.tabId = tabId;
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
  // While the Manager reviews, the server holds the application longer (it says how long), so the
  // hold is renewed less often; any other time, every 30 seconds.
  let renewedAt = 0;
  let waitingLeaseSeconds = 0;
  const keepAlive = async () => {
    const waiting = reviewWaiters.has(application.attemptId);
    if (waiting && Date.now() - renewedAt < self.__qtsIdlePacing.renewEveryMs(waitingLeaseSeconds)) return;
    const renewed = await workerApiRequest('POST', '/api/extension/apply/heartbeat', { attemptId: application.attemptId });
    if (renewed._httpStatus === 409) lostClaim = true;
    // Super Admin may change the review mode or automatic Submit during an application: the next step uses it.
    if (renewed.success === true) {
      renewedAt = Date.now();
      waitingLeaseSeconds = waiting ? Number(renewed.leaseSeconds) || 0 : 0;
      if (renewed.reviewMode) application.reviewMode = renewed.reviewMode;
      if (typeof renewed.autoSubmit === 'boolean') application.autoSubmit = renewed.autoSubmit;
    }
  };
  const heartbeat = setInterval(() => keepAlive().catch(() => {}), APPLY_HEARTBEAT_MS);
  const answersUsed = {};
  application.answerCache = new Map();
  const dryRun = (await chrome.storage.local.get(APPLY_DRY_RUN_KEY))[APPLY_DRY_RUN_KEY] === true;
  await loadApplyDebug();
  diag('application', { attempt: String(application.attemptId).slice(0, 8), site: recipe.site, aiMode: application.aiMode });
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
  publishApplyState();
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
      // A profile fact given in the field's own words ("Rumunia"): the profile's value, for the Manager to see.
      profileValue: answer.fact && answer.intended && simpleText(answer.intended) !== simpleText(answerText(answer.value)) ? String(answer.intended).slice(0, 200) : null,
      valueFrom: answer.fact === 'answer' ? 'reusable answer' : 'profile',
    })),
    ...extra,
  });
  const report = (path, body) => workerApiRequest('POST', `/api/extension/apply/${path}`, { attemptId: application.attemptId, ...body });
  const release = (mode, reason) => report('release', { mode, reason: reason.slice(0, 480), appliedAnswers: appliedAnswers(answersUsed) });
  let tab = null;
  let submitted = false;
  // An email-first step (only an email and a Continue): QTS types the profile's email; the Manager
  // clicks the site's Continue, whose next page may be a sign-in, an account, or a code sent by email
  // (never Apply's to take), then Continue here. Asked once per application.
  let emailFirstAsked = false;
  const emailFirstStep = async (tabId, stepNumber) => {
    const email = application.candidate.email || '';
    const typed = email && await inForm(tabId, async (value) => {
      const api = globalThis.__qtsApplyForm;
      const box = api.scanForm().find((field) => !field.hidden && !field.disabled && (field.kind === 'email' || /e-?mail/i.test(field.label)));
      return box ? (await api.fillField(box.id, value)).ok === true : false;
    }, [email]).catch(() => false);
    const message = `This site asks for the email first${typed ? ' (QTS typed the profile\'s email)' : ''}. Click the site's Continue yourself; if it then asks to sign in, create an account, or enter a code, do that or Skip. When the application form shows, press Continue here.`;
    return askManager(review, reviewState('review', { step: stepNumber, final: false, problems: [{ message, fieldId: null }] }), 'problem', 'The site asks for an email first.');
  };
  try {
    tab = await openApplyTab(recipe.formUrl);
    review.tabId = tab.id;
    await waitForTabComplete(tab.id, 45 * 1000);
    if (recipe.findStart) {
      try {
        tab = await reachApplicationForm(tab, (opened) => { tab = opened; review.tabId = opened.id; });
      } catch (error) {
        if (error instanceof ApplyStop && error.pageType === 'email_first_application') {
          emailFirstAsked = true;
          const decision = await emailFirstStep(tab.id, 1);
          if (decision.action !== 'continue') return await finishBeforeSubmit(decision.action);
          tab = await reachApplicationForm(tab, (opened) => { tab = opened; review.tabId = opened.id; });
        } else {
          // A security check before the job page goes to the Manager: solve it, then Continue.
          if (!(error instanceof ApplyStop) || !/CAPTCHA|security check/i.test(error.message)) throw error;
          const decision = await askManager(review, reviewState('review', {
            step: 1, final: false, problems: [{ message: 'Solve the security check (CAPTCHA) on this page, then Continue.', fieldId: null }],
          }), 'problem', 'Solve the CAPTCHA, then Continue.');
          if (decision.action !== 'continue') return await finishBeforeSubmit(decision.action);
          tab = await reachApplicationForm(tab, (opened) => { tab = opened; review.tabId = opened.id; });
        }
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
      let filled;
      try {
        filled = await fillFormPage(tab.id, application, keepAlive, step);
      } catch (error) {
        // A form address that opened on an email-first step: the Manager goes past it (once).
        if (!(error instanceof ApplyStop) || error.pageType !== 'email_first_application' || emailFirstAsked) throw error;
        emailFirstAsked = true;
        const decision = await emailFirstStep(tab.id, step);
        if (decision.action !== 'continue') return await finishBeforeSubmit(decision.action);
        continue;
      }
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
    publishApplyState();
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

// ---- Apply as the Manager's assistant ----
// Each Chrome keeps up to two job pages open, each with a panel: the candidate's profile,
// experience, education, and Super Admin's reusable answers (every item copied with a click), and
// two copy buttons (résumé + job description, and with the profile). On every page of the journey
// (the form's steps, a pop-up, the employer's site in a tab the job page opened) QTS fills, as soon
// as boxes show, only what it knows for sure: the résumé and cover letter, profile facts, reusable
// answers; never AI, never a search, newsletter, or job-alert form, never a sign-in or create-account
// form (the Manager types those, copying the site account password from the panel), and it never
// clicks the site's buttons.
// The Manager does the rest, clicks the site's Submit, then Submitted at the bottom of the panel (the
// site's buttons are never watched), or Cancel. Submitted saves the bid and deletes the job row;
// Cancel closes the page and leaves the job as it was.
const APPLY_TABS_PER_CHROME = 2;
// Where the assistant's answers may come from: the résumé and cover letter, the profile, reusable answers.
const ASSIST_SOURCES = new Set(['documents', 'profile', 'reusable']);
// The page tells QTS when new boxes show (content/apply-assist.js); this slower look is the backup.
const ASSIST_LOOK_EVERY_MS = 15 * 1000;
// While the Manager types on a page, QTS waits this long and looks again.
const ASSIST_TYPING_WAIT_MS = 3000;
// The longest one fill pass holds the other pages back.
const ASSIST_PASS_LIMIT_MS = 60 * 1000;
// Jobs cancelled in this Chrome since Apply was turned on: not opened again until Apply restarts.
const APPLY_CANCELLED_KEY = 'qtsApplyCancelledJobs';
// One page is filled at a time in this Chrome, so the open pages never fill over each other.
let assistFillChain = Promise.resolve();

/** A page's address without its #part: each step at its own address is its own page. */
function assistPageOf(url) {
  return String(url || '').split('#')[0];
}

/**
 * The assistant's two keys for a box: the box itself on this tab's page (met once, then it is the
 * Manager's, even if emptied), and its question on the page (a box the page draws anew, empty, is
 * filled at most twice there; an upload once), so nothing is filled or uploaded over and over.
 */
function assistKeys(tabId, page, field) {
  // An upload's section heading is part of its question: "Upload file" under "Upload your CV" and
  // under "Add a cover letter" (steps at one address) are two uploads.
  const question = HAS_WORDS.test(field.label || '') ? `${field.kind}|${field.label}|${field.section || ''}` : field.id;
  return { box: `${tabId}|${page}|${field.id}`, question: `${tabId}|${page}|${question}` };
}

function assistSkips(assistant, tabId, page, field) {
  const keys = assistKeys(tabId, page, field);
  return assistant.handled.has(keys.box) || (assistant.tries.get(keys.question) || 0) >= (field.kind === 'file' ? 1 : 2);
}

// The assistant's open applications, by attempt: the job and the tabs it lives in. Kept in local
// storage so that after the extension restarts (reloaded, updated, the worker stopped) the same
// pages are worked in again and Submitted still saves the bid. Tab ids last while Chrome is open.
const APPLY_SESSIONS_KEY = 'qtsApplySessions';
let applySessionWrites = Promise.resolve();

async function applySessions() {
  const stored = (await chrome.storage.local.get(APPLY_SESSIONS_KEY))[APPLY_SESSIONS_KEY];
  return stored && typeof stored === 'object' ? stored : {};
}

/** One write at a time, so two pages saving together never undo each other. */
function changeApplySessions(change) {
  applySessionWrites = applySessionWrites.then(async () => {
    const sessions = await applySessions();
    change(sessions);
    await chrome.storage.local.set({ [APPLY_SESSIONS_KEY]: sessions });
  }).catch(() => {});
  return applySessionWrites;
}

function rememberApplySession(review) {
  const tabIds = [...tabsOf(review)];
  if (!review.assist || !tabIds.length) return Promise.resolve();
  return changeApplySessions((sessions) => {
    sessions[review.attemptId] = { jobId: review.job.id, company: review.job.company, title: review.job.title, tabIds };
  });
}

function forgetApplySession(attemptId) {
  return changeApplySessions((sessions) => { delete sessions[attemptId]; });
}

/**
 * The applications whose pages are still open after the extension restarted: each is taken up
 * again (the server holds it for this Chrome again, or takes its job back when its hold ran out),
 * with its panel shown again. Returns the runs started; a page that cannot be taken up loses its
 * panel and the Manager is told.
 */
async function resumeApplySessions(limit) {
  const runs = [];
  for (const [attemptId, saved] of Object.entries(await applySessions())) {
    if (activeReviews.has(attemptId)) continue;
    const tabIds = [];
    for (const tabId of saved.tabIds || []) if (await getTab(tabId)) tabIds.push(tabId);
    await forgetApplySession(attemptId);
    if (!tabIds.length) continue;
    const reply = runs.length < limit
      ? await workerApiRequest('POST', '/api/extension/apply/resume', { attemptId, jobId: saved.jobId })
      : null;
    if (reply?.success === true && reply.application) {
      runs.push(runAssistedApplication(reply.application, { resumeTabIds: tabIds }));
      continue;
    }
    for (const tabId of tabIds) await removeStalePanel(tabId);
    await notifyApply(`${saved.company || 'A job'}: QTS restarted and could not take this page up again (another Chrome has it, or it has a bid). Its tab stays open.`);
  }
  return runs;
}

/** A panel left by an earlier run of the extension (it can no longer reach QTS) is removed. */
async function removeStalePanel(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => {
      for (const node of document.querySelectorAll('[data-qts-apply-assist], [data-qts-apply-dock]')) node.remove();
      document.documentElement.removeAttribute('data-qts-apply-docked');
    },
  }).catch(() => {});
}

async function cancelledJobIds() {
  const stored = (await chrome.storage.session.get(APPLY_CANCELLED_KEY))[APPLY_CANCELLED_KEY];
  return Array.isArray(stored) ? stored : [];
}

async function noteCancelledJob(jobId) {
  const ids = await cancelledJobIds();
  if (jobId && !ids.includes(jobId)) await chrome.storage.session.set({ [APPLY_CANCELLED_KEY]: [...ids, jobId].slice(-200) });
}

// Apply turned off: the cancelled jobs may be opened again next time.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[EXTENSION_STATUS_KEY] || changes[EXTENSION_STATUS_KEY].newValue === 'apply') return;
  chrome.storage.session.remove(APPLY_CANCELLED_KEY).catch(() => {});
});

/**
 * Looks at one of an application's pages (any step of the form, the employer's site, a pop-up) and
 * fills the boxes QTS has not met there yet; none while the Manager typed there in the last 3
 * seconds. Text the Manager or the site wrote stays; a box met once is the Manager's from then on.
 * Sign-in and create-account forms are the Manager's (the panel copies the site account password),
 * and boxes outside the application (search, newsletter, job alerts) are never filled.
 */
async function assistFillPass(tabId, application, assistant) {
  const tab = await getTab(tabId);
  if (!tab || tab.status !== 'complete') return;
  const page = assistPageOf(tab.url);
  const look = await inForm(tabId, () => ({
    fields: globalThis.__qtsApplyForm.scanForAssist(),
    embedded: globalThis.__qtsApplyForm.embeddedApplicationUrl(),
    typing: Date.now() - (globalThis.__qtsApplyAssist?.lastKeyAt?.() || 0) < 3000,
  })).catch(() => null);
  if (!look) return;
  // A company page showing a job board's form in a frame QTS cannot read (jobs.elastic.co with
  // Greenhouse): the form opens in this tab, once per page, where QTS fills it.
  if (look.embedded && !assistant.openedForms.has(`${tabId}|${page}`)) {
    assistant.openedForms.add(`${tabId}|${page}`);
    await chrome.tabs.update(tabId, { url: look.embedded }).catch(() => {});
    return;
  }
  if (look.typing) {
    setTimeout(() => assistant.poke(tabId), ASSIST_TYPING_WAIT_MS);
    return;
  }
  const skip = (field) => assistSkips(assistant, tabId, page, field);
  const unmet = (look.fields || []).filter((field) => !field.hidden && !field.disabled && !field.filled && !field.unrelated && !field.account && !skip(field));
  if (!unmet.length) return;
  const pass = assistFillChain.then(async () => {
    if (assistant.stopped) return;
    assistant.filling = true;
    await assistant.show();
    try {
      // A page that goes away mid-fill (the Manager clicked Next) never holds up the other pages.
      const filled = await Promise.race([
        fillFormPage(tabId, application, assistant.keepAlive, 1, { assist: true, skip }),
        sleep(ASSIST_PASS_LIMIT_MS).then(() => ({ used: {}, problems: [], met: [] })),
      ]);
      Object.assign(assistant.used, filled.used);
      const counted = new Set();
      for (const field of [...unmet, ...(filled.met || [])]) {
        const keys = assistKeys(tabId, page, field);
        assistant.handled.add(keys.box);
        if (counted.has(keys.question)) continue;
        counted.add(keys.question);
        assistant.tries.set(keys.question, (assistant.tries.get(keys.question) || 0) + 1);
      }
      const known = new Set(filled.problems.map((entry) => entry.message));
      assistant.problems = [...assistant.problems.filter((entry) => !known.has(entry.message)), ...filled.problems];
    } finally {
      assistant.filling = false;
      await assistant.show();
    }
  });
  assistFillChain = pass.catch(() => {});
  await pass;
}

/** The candidate's profile facts for the panel, in the order a form asks for them. */
function panelProfile(candidate) {
  const { candidateId: _candidateId, ...facts } = candidate || {};
  return facts;
}

/**
 * One job page with the Manager: opened (behind the Manager's tab when another is open), followed
 * into the tabs it opens, filled with what QTS knows whenever new questions show, and ended by the
 * Manager. Only Submitted (or Yes after the site's Submit) records anything: the bid, and the job row
 * deleted. Cancel, closing all its tabs, Apply turned off, or an error record nothing: the job stays
 * as it was (not opened again in this Chrome until Apply restarts). No goes back to the form.
 */
async function runAssistedApplication(application, { resumeTabIds = null, adoptTabId = null } = {}) {
  const { attemptId } = application;
  let renewedAt = Date.now();
  let leaseSeconds = 0;
  const keepAlive = async () => {
    if (Date.now() - renewedAt < self.__qtsIdlePacing.renewEveryMs(leaseSeconds)) return;
    const renewed = await workerApiRequest('POST', '/api/extension/apply/heartbeat', { attemptId });
    if (renewed._httpStatus === 409) answerManager(attemptId, { action: 'lost' });
    if (renewed.success === true) {
      renewedAt = Date.now();
      leaseSeconds = Number(renewed.leaseSeconds) || 0;
    }
  };
  const heartbeat = setInterval(() => keepAlive().catch(() => {}), APPLY_HEARTBEAT_MS);
  await loadApplyDebug();
  diag('application', { attempt: String(attemptId).slice(0, 8), assist: true });
  const candidate = [application.candidate.firstName, application.candidate.lastName].filter(Boolean).join(' ') || 'Candidate';
  const review = {
    attemptId,
    tabId: null,
    assist: true,
    chromeName: await browserName(),
    candidate,
    job: application.job,
    resumeFolder: application.job.resumeFolder,
    panel: null,
  };
  activeReviews.set(attemptId, review);
  publishApplyState();
  const assistant = {
    used: {}, handled: new Set(), tries: new Map(), problems: [], filling: false, stopped: false, keepAlive, show: null,
    // Pages whose embedded job-board form was opened in their tab (once each).
    openedForms: new Set(),
    // "Fill again": the tab's boxes, uploads and embedded forms are forgotten, so the page is
    // filled as if the job were new (text already in a box still stays), at once.
    refill(tabId) {
      if (assistant.stopped || tabId == null || !tabsOf(review).has(tabId)) return;
      const ofTab = (key) => key.startsWith(`${tabId}|`);
      for (const key of [...assistant.handled]) if (ofTab(key)) assistant.handled.delete(key);
      for (const key of [...assistant.tries.keys()]) if (ofTab(key)) assistant.tries.delete(key);
      for (const key of [...assistant.openedForms]) if (ofTab(key)) assistant.openedForms.delete(key);
      assistant.problems = [];
      assistant.poke(tabId);
    },
    // Tabs with a fill pass on its way, and those to look at once more when it ends.
    looking: new Set(), lookAgain: new Set(),
    // Fills one of this application's tabs now (new boxes shown, a page loaded); a second request
    // while it fills becomes one more pass after it.
    poke(tabId) {
      if (assistant.stopped || tabId == null || !tabsOf(review).has(tabId)) return;
      if (assistant.looking.has(tabId)) {
        assistant.lookAgain.add(tabId);
        return;
      }
      assistant.looking.add(tabId);
      assistFillPass(tabId, application, assistant).catch(() => {}).finally(() => {
        assistant.looking.delete(tabId);
        if (assistant.lookAgain.delete(tabId)) assistant.poke(tabId);
      });
    },
  };
  review.assistant = assistant;
  const panelState = (mode, extra = {}) => ({
    assist: true,
    attemptId,
    jobId: application.job.id,
    mode,
    chromeName: review.chromeName,
    candidate,
    job: {
      title: application.job.title,
      company: application.job.company,
      location: application.job.location,
      workType: application.job.workType,
      salary: application.job.salary,
      url: application.job.url,
      description: application.job.description || '',
    },
    resumeText: application.job.resumeText || '',
    resumeFolder: application.job.resumeFolder,
    profile: panelProfile(application.candidate),
    // Copied from the panel for sign-in and create-account forms; shown as dots.
    siteAccountPassword: application.siteAccountPassword || null,
    experiences: application.profileDetails?.experiences || [],
    educations: application.profileDetails?.educations || [],
    reusable: (application.savedAnswers || []).map((entry) => ({ question: entry.questionText, answer: entry.answer, note: entry.note || null })),
    filled: Object.keys(assistant.used).length,
    filling: assistant.filling,
    problems: assistant.problems,
    ...extra,
  });
  // The panel shows in every tab of the application.
  const showPanel = (mode, extra) => {
    review.panel = panelState(mode, extra);
    return Promise.all([...tabsOf(review)].map((tabId) => showReviewPanel(tabId, review.panel).catch(() => {})));
  };
  assistant.show = () => showPanel('assist');
  const report = (path, body) => workerApiRequest('POST', `/api/extension/apply/${path}`, { attemptId, ...body });
  // Nothing is recorded unless the Manager clicks Submitted on the panel: any other end lets the job
  // go exactly as it was.
  const drop = (reason) => report('release', { mode: 'drop', reason });
  const closeTabs = () => Promise.all([...tabsOf(review)].map((tabId) => chrome.tabs.remove(tabId).catch(() => {})));
  let tab = null;
  // The form's answers when Submitted was clicked.
  let answersAtSubmit = null;
  let learnedAtSubmit = [];
  // The bid's first step reached QTS (the Manager answered; only saving the bid is left).
  let marked = false;
  // Every tab of the application is filled when the page says boxes changed, and looked at every
  // 15 seconds as a backup.
  let fillerRun = 0;
  const startFiller = () => {
    assistant.stopped = false;
    const run = ++fillerRun;
    (async () => {
      while (!assistant.stopped && run === fillerRun && activeReviews.has(attemptId)) {
        for (const tabId of tabsOf(review)) assistant.poke(tabId);
        await sleep(ASSIST_LOOK_EVERY_MS);
      }
    })();
  };
  const readAnswers = async (given) => {
    const current = (given?.length ? given : null) || await inForm(review.tabId, () => globalThis.__qtsApplyForm.currentAnswers()).catch(() => []) || [];
    return { answers: submittedAnswers(assistant.used, current), learned: learnedAnswers(assistant.used, current) };
  };
  // Submitted when the application record is gone (its hold ran out while the Chrome was away):
  // the bid is saved from the job itself.
  const saveFromJob = () => workerApiRequest('POST', '/api/extension/apply/save-bid', {
    jobId: application.job.id,
    appliedAnswers: answersAtSubmit || [],
  });
  try {
    if (adoptTabId != null) {
      // "Apply this page": the Manager's own tab becomes the application, filled from now on (the
      // server holds it for the Manager already).
      review.tabIds = new Set([adoptTabId]);
      review.tabId = adoptTabId;
    } else if (resumeTabIds?.length) {
      // The extension restarted with this job's pages open: they are worked in again, and what
      // they already show is left as it is (met), as the Manager may have chosen it.
      review.tabIds = new Set(resumeTabIds);
      review.tabId = resumeTabIds[resumeTabIds.length - 1];
      for (const tabId of resumeTabIds) {
        const page = assistPageOf((await getTab(tabId))?.url);
        const shown = await inForm(tabId, () => globalThis.__qtsApplyForm.scanForAssist()
          .filter((field) => !field.hidden && !globalThis.__qtsApplyForm.isUnanswered(field))).catch(() => []);
        for (const field of shown || []) assistant.handled.add(assistKeys(tabId, page, field).box);
      }
    } else {
      const othersOpen = [...activeReviews.values()].some((entry) => entry !== review && entry.assist && entry.tabId != null);
      tab = await openApplyTab(application.job.url, { active: !othersOpen });
      review.tabId = tab.id;
      review.tabIds = new Set([tab.id]);
      // Held for the Manager from the start (the longer hold): the page waits for them.
      await report('review', { review: true, appliedAnswers: [] });
    }
    await rememberApplySession(review);
    if (tab) await waitForTabComplete(tab.id, 45 * 1000).catch(() => {});
    await showPanel('assist');
    startFiller();
    for (;;) {
      const decision = await waitForManager(attemptId);
      // Submitted on the panel (the site's own buttons are never watched): the bid, and the job row deleted.
      if (decision.action === 'submitted') {
        assistant.stopped = true;
        if (!marked) {
          ({ answers: answersAtSubmit, learned: learnedAtSubmit } = await readAnswers(decision.answers));
          const sent = await report('submitted', { appliedAnswers: answersAtSubmit, learned: learnedAtSubmit });
          // The application record is gone: the bid comes from the job itself.
          const fromJob = !sent.success && sent._httpStatus === 409 ? await saveFromJob() : null;
          if (fromJob?.success) {
            await closeTabs();
            return;
          }
          if (!sent.success) {
            await showPanel('assist', { message: fromJob?.message || sent.message || 'QTS did not save the bid; try again.' });
            startFiller();
            continue;
          }
          marked = true;
        }
        const saved = await report('result', { submitted: true, removeJob: true, appliedAnswers: answersAtSubmit });
        const fromJob = !saved.success && saved._httpStatus === 409 ? await saveFromJob() : null;
        if (!saved.success && !fromJob?.success) {
          await showPanel('assist', { message: fromJob?.message || saved.message || 'QTS did not save the bid; try again.' });
          continue;
        }
        await closeTabs();
        return;
      }
      if (decision.action === 'lost') return;
      // Remove on the panel: the job row is deleted and its tabs closed.
      if (decision.action === 'remove' && !marked) {
        assistant.stopped = true;
        const removed = await report('release', { mode: 'remove', reason: 'Removed by the Manager.' });
        if (!removed.success) {
          await showPanel('assist', { message: removed.message || 'QTS did not remove the job; try again.' });
          startFiller();
          continue;
        }
        await closeTabs();
        return;
      }
      // Cancel, all its tabs closed, or Apply turned off: nothing recorded.
      if (marked) {
        await notifyApply(`${application.job.company}: answer "Submitted successfully?" on the Jobs page.`);
        return;
      }
      await drop(decision.action === 'cancel' ? 'Cancelled by the Manager.' : decision.action === 'closed' ? 'The job page was closed.' : 'Apply was turned off.').catch(() => {});
      if (decision.action === 'cancel' || decision.action === 'closed') await noteCancelledJob(application.job.id);
      if (decision.action !== 'closed') await closeTabs();
      return;
    }
  } catch (error) {
    if (marked) {
      await notifyApply(`${application.job.company}: answer "Submitted successfully?" on the Jobs page.`);
    } else {
      // Nothing recorded; not opened again in this Chrome until Apply restarts, so it cannot loop.
      await drop(error instanceof Error ? error.message.slice(0, 400) : 'Apply could not open the job.').catch(() => {});
      await noteCancelledJob(application.job.id);
    }
  } finally {
    assistant.stopped = true;
    clearInterval(heartbeat);
    activeReviews.delete(attemptId);
    publishApplyState();
    reviewWaiters.delete(attemptId);
    earlyDecisions.delete(attemptId);
    // Ended here (a worker that stops never gets here, so its pages are taken up again after a restart).
    await forgetApplySession(attemptId);
    for (const tabId of tabsOf(review)) {
      await removeReviewPanel(tabId);
      await releaseDebugger(tabId);
    }
  }
}

/** Applies to ready jobs while Apply is on in this Chrome; the alarm calls it again when idle. */
async function processApplyQueue() {
  if (applyLoopRunning) return;
  applyLoopRunning = true;
  // The applications open in this Chrome: up to two job pages with the Manager's panel (one
  // automatic application at a time in test mode).
  const running = new Set();
  const track = (work) => {
    const run = work.catch(() => {}).finally(() => {
      running.delete(run);
      self.__qtsIdlePacing.noteActivity().catch(() => {});
    });
    running.add(run);
  };
  try {
    // Pages still open from before the extension restarted are taken up first (they count as open).
    if (await isApplyOn()) for (const run of await resumeApplySessions(APPLY_TABS_PER_CHROME)) track(run);
    while (await isApplyOn()) {
      const testMode = (await chrome.storage.local.get(APPLY_DRY_RUN_KEY))[APPLY_DRY_RUN_KEY] === true;
      if (running.size >= (testMode ? 1 : APPLY_TABS_PER_CHROME)) {
        await Promise.race(running);
        continue;
      }
      const claim = await workerApiRequest('POST', '/api/extension/apply/claim', { skipJobIds: await cancelledJobIds() });
      if (claim.success !== true) {
        if ([401, 403, 426].includes(claim._httpStatus)) {
          await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
          await notifyApply(claim.message || 'Apply stopped.');
          break;
        }
        if (!running.size) break;
      }
      const application = claim.success === true ? claim.application : null;
      if (!application) {
        if (!running.size) break;
        // Nothing ready now: looked for again in a minute, or when one of the open jobs ends.
        await Promise.race([...running, sleep(60 * 1000)]);
        continue;
      }
      // Work found: this Chrome is not idle (shared/idle-pacing.js), until the queue is empty for a while.
      await self.__qtsIdlePacing.noteActivity();
      const recipe = self.__qtsApplyRecipes.recipeFor(application.job.url);
      // The Manager signs in to a site that needs an account; only a link that is no web page is skipped.
      if (recipe.unsupported && (testMode || recipe.site !== 'account')) {
        await workerApiRequest('POST', '/api/extension/apply/release', {
          attemptId: application.attemptId,
          mode: 'skip',
          reason: recipe.unsupported,
        });
        continue;
      }
      track(testMode ? runApplication(application, recipe) : runAssistedApplication(application));
    }
  } finally {
    await Promise.allSettled([...running]);
    applyLoopRunning = false;
  }
}

// "Apply this page": the launcher on a job page asks which of the Manager's accounts have this job
// (generated, no bid), then starts the one chosen in that very tab. Only while Apply is on; a job
// chosen this way opens even when this Chrome has its two pages open.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'QTS_APPLY_PAGE_ACCOUNTS' && msg?.type !== 'QTS_APPLY_PAGE_START') return false;
  (async () => {
    const tab = sender.tab;
    if (tab?.id == null || !/^https?:/i.test(tab.url || '')) return { ok: false, error: 'Open the job\'s page first.' };
    if (!(await isApplyOn())) return { ok: true, applyOn: false, applications: [] };
    const owner = [...activeReviews.values()].find((review) => review.assist && tabsOf(review).has(tab.id));
    if (msg.type === 'QTS_APPLY_PAGE_ACCOUNTS') {
      if (owner) return { ok: true, applyOn: true, openHere: owner.candidate, applications: [] };
      const reply = await workerApiRequest('POST', '/api/extension/apply/page', { url: tab.url });
      return reply.success === true
        ? { ok: true, applyOn: true, applications: reply.applications || [] }
        : { ok: false, error: reply.message || 'QTS could not look up this page.' };
    }
    if (owner) return { ok: false, error: `This tab is already ${owner.candidate}'s application.` };
    const reply = await workerApiRequest('POST', '/api/extension/apply/start-job', { jobId: msg.jobId });
    if (reply.success !== true || !reply.application) return { ok: false, error: reply.message || 'QTS could not start this job.' };
    await tabOwnership.markTab(tab.id, 'apply').catch(() => {});
    runAssistedApplication(reply.application, { adoptTabId: tab.id }).catch(() => {});
    return { ok: true };
  })().then(sendResponse, (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Failed.' }));
  return true;
});

// An application being filled or waiting for the Manager: never paced down or turned off.
const isBusy = () => activeReviews.size > 0;

self.__qtsApplyRunner = { processApplyQueue, syncApplyQueueAlarm, isBusy, APPLY_QUEUE_ALARM, APPLY_DRY_RUN_KEY };
