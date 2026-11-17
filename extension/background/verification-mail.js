// A job site's verification page (a code or a link sent by email), done from the Manager's
// verification mailbox: QTS waits 15 s, then asks the server (which reads the mailbox) up to three
// times, types the code into the page or opens the link in this Chrome, and Apply goes on. Nothing
// found, no mailbox saved, or no code box: the page stays for the Manager, as before.
// Both Normal Apply and Auto Apply call complete() where they meet such a page.

(function initializeQtsVerificationMail(global) {
  const FIRST_WAIT_MS = 15_000;
  const ASKS = 3;
  const PAGE_MOVE_WAIT_MS = 15_000;
  // At most this many tries per application (a page that keeps asking is the Manager's).
  const TRIES_PER_APPLICATION = 4;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function onPage(tabId, func, args = []) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/verification-code.js'] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args });
    return result?.result;
  }

  async function say(tabId, message, type = 'info', durationMs = 0) {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (text, kind, ms) => globalThis.__qtsPageToast?.show(text, { type: kind, ...(ms ? { durationMs: ms } : {}) }),
      args: [message, type, durationMs],
    }).catch(() => {});
  }

  async function waitStoppable(ms, stop) {
    for (let waited = 0; waited < ms; waited += 1000) {
      if (stop && await stop()) return false;
      await sleep(Math.min(1000, ms - waited));
    }
    return true;
  }

  /** Whether the page left the code step (another address, or no code box any more). */
  async function pageMovedOn(tabId, before) {
    for (let waited = 0; waited < PAGE_MOVE_WAIT_MS; waited += 1000) {
      await sleep(1000);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return false;
      if (tab.status !== 'complete') continue;
      const now = await onPage(tabId, () => globalThis.__qtsVerificationCode.state()).catch(() => null);
      if (!now) continue;
      if (now.url !== before.url || !now.codeBox) return true;
    }
    return false;
  }

  /** Opens the link in a background tab of this Chrome, waits for it, closes it, reloads the page. */
  async function openLink(tabId, url) {
    const from = await chrome.tabs.get(tabId).catch(() => null);
    const opened = await chrome.tabs.create({ url, active: false, ...(from ? { windowId: from.windowId, openerTabId: tabId } : {}) }).catch(() => null);
    if (!opened?.id) return false;
    for (let waited = 0; waited < 20_000; waited += 500) {
      await sleep(500);
      const tab = await chrome.tabs.get(opened.id).catch(() => null);
      if (!tab || tab.status === 'complete') break;
    }
    await sleep(1500);
    await chrome.tabs.remove(opened.id).catch(() => {});
    await chrome.tabs.reload(tabId).catch(() => {});
    await sleep(3000);
    return true;
  }

  /**
   * Done when the page went past the code step: true. Otherwise false, with the reason shown on the
   * page (the Manager does it, as before).
   */
  // One search per tab at a time: Apply's own steps and the watcher below share it.
  const inFlight = new Map();
  // Per application: how many searches so far, and the codes and links already used.
  const perApplication = new Map();

  function complete(tabId, application, options = {}) {
    if (!application?.attemptId || tabId == null) return Promise.resolve(false);
    if (inFlight.has(tabId)) return inFlight.get(tabId);
    const run = search(tabId, application.attemptId, options).finally(() => inFlight.delete(tabId));
    inFlight.set(tabId, run);
    return run;
  }

  async function search(tabId, attemptId, { stop = null } = {}) {
    const application = perApplication.get(attemptId) || { attemptId, verificationTries: 0, verificationUsed: [] };
    perApplication.set(attemptId, application);
    application.verificationTries += 1;
    if (application.verificationTries > TRIES_PER_APPLICATION) return false;
    const since = Date.now();
    const pageUrl = (await chrome.tabs.get(tabId).catch(() => null))?.url || '';
    await say(tabId, 'QTS: waiting for the code in the verification mailbox (up to 2–3 minutes)…', 'info', FIRST_WAIT_MS + 5000);
    if (!(await waitStoppable(FIRST_WAIT_MS, stop))) return false;

    for (let ask = 0; ask < ASKS; ask += 1) {
      if (stop && await stop()) return false;
      const answer = await workerApiRequest('POST', '/api/extension/apply/verification', {
        attemptId: application.attemptId,
        since,
        pageUrl,
        exclude: application.verificationUsed,
      }, { timeoutMs: 70_000 });
      if (!answer?.success) {
        await say(tabId, `QTS could not read the verification mailbox: ${answer?.message || 'try again'}. Do the verification yourself.`, 'warn');
        return false;
      }
      if (answer.status === 'no_mailbox') {
        await say(tabId, 'Do the verification yourself. Tip: add a Verification mailbox in your QTS Profile and QTS types codes for you.', 'warn');
        return false;
      }
      if (answer.status === 'no_candidate_email') {
        await say(tabId, 'This candidate has no email in QTS, so QTS cannot find the code. Do the verification yourself.', 'warn');
        return false;
      }
      if (answer.status === 'mailbox_error') {
        await say(tabId, `${answer.message} Do the verification yourself.`, 'warn');
        return false;
      }
      if (answer.status !== 'found') {
        if (ask < ASKS - 1) await say(tabId, 'QTS: no code yet, still waiting…', 'info', 45_000);
        continue;
      }
      const before = await onPage(tabId, () => globalThis.__qtsVerificationCode.state()).catch(() => null);
      if (answer.code && before?.codeBox) {
        application.verificationUsed.push(answer.code);
        const typed = await onPage(tabId, (code) => globalThis.__qtsVerificationCode.fill(code), [answer.code]).catch(() => null);
        if (!typed?.ok) {
          await say(tabId, `QTS found the code ${answer.code} in email but could not type it (${typed?.reason || 'unknown'}). Type it yourself.`, 'warn', 60_000);
          return false;
        }
        await say(tabId, 'QTS: code found in email and typed.', 'success');
        if (await pageMovedOn(tabId, before)) return true;
        // A wrong or old code: the next one, if any.
        continue;
      }
      if (answer.link) {
        application.verificationUsed.push(answer.link);
        await say(tabId, 'QTS: verification link found in email, opening it…', 'success');
        return openLink(tabId, answer.link);
      }
      if (answer.code) {
        // No box for it here (yet): the Manager sees it.
        await say(tabId, `Code from the verification mailbox: ${answer.code}. Type it where the site asks for it.`, 'warn', 120_000);
        return false;
      }
    }
    await say(tabId, 'No code or link came to the verification mailbox. Do the verification yourself.', 'warn');
    return false;
  }

  // The watcher: every few seconds, each tab of an application under way (Normal Apply and Auto
  // Apply) is checked; a page that waits for an emailed code or link is done from the mailbox, also
  // one that appears after the Manager's own click. Nothing is sent to the server for other pages.
  const WATCH_EVERY_MS = 4000;
  // A page already searched for (its address): not again unless it changes.
  const searchedPages = new Map();

  async function watch() {
    const tabs = global.__qtsApplyRunner?.applicationTabs?.() || [];
    const live = new Set(tabs.map((entry) => entry.tabId));
    for (const tabId of searchedPages.keys()) if (!live.has(tabId)) searchedPages.delete(tabId);
    for (const id of perApplication.keys()) if (!tabs.some((entry) => entry.attemptId === id)) perApplication.delete(id);
    for (const { tabId, attemptId } of tabs) {
      if (inFlight.has(tabId)) continue;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab || tab.status !== 'complete' || !/^https?:\/\//i.test(tab.url || '')) continue;
      if (searchedPages.get(tabId) === tab.url) continue;
      const waits = await onPage(tabId, () => globalThis.__qtsVerificationCode.waitsForMail()).catch(() => false);
      if (!waits) continue;
      searchedPages.set(tabId, tab.url);
      complete(tabId, { attemptId }).then((done) => { if (done) searchedPages.delete(tabId); }).catch(() => {});
    }
  }

  let watching = false;
  setInterval(() => {
    if (watching) return;
    watching = true;
    watch().catch(() => {}).finally(() => { watching = false; });
  }, WATCH_EVERY_MS);

  global.__qtsVerificationMail = { complete };
})(self);
