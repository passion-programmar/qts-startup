// LinkedIn skip-list on LinkedIn's job search: cards whose (title, company) the Manager has already
// seen (clicked, labelled Viewed / Saved / Applied by LinkedIn, applied or saved in QTS) show inverted:
// the card's title white on black at 70% (rgba 0.7: ::highlight takes no opacity); the rest of the
// card stays as LinkedIn shows it. Only the CSS Custom Highlight API paints it (text ranges and
// their ::highlight colours): LinkedIn's HTML is never changed, no style rule names its elements,
// nothing is hidden or clicked. Cards are read only through hooks confirmed on the live
// page (2026-11-21): the card's componentkey "job-card-component-ref-<id>", the title in its Dismiss
// button's aria-label (and as a text line), the company as the next line. LinkedIn's class names are
// hashed and never used. When fewer than half the cards read cleanly, the feature pauses itself.
// QTS's server is required (the worker decides): without it, or with the Super Admin's switch off,
// nothing is painted. Paging uses the worker's mirror; it fetches on load, on return to the tab
// after a while, and when the panel opens. Leaving the tab sends the waiting marks.
(function initLinkedInSkip() {
  if (globalThis.__qtsLinkedInSkip?.alive?.()) return;
  const keyOf = globalThis.__qtsTitleCompanyKey?.computeTitleCompanyKey;
  if (!keyOf || !/(^|\.)linkedin\.com$/i.test(location.hostname)) return;

  const CARD = '[componentkey^="job-card-component-ref-"]';
  const CARD_PREFIX = 'job-card-component-ref-';
  const STATES = { Viewed: 'viewed', Saved: 'saved', Applied: 'applied' };
  // LinkedIn's label line: "Viewed", "Saved", "Applied", also with words after it ("Applied 2 days ago").
  const STATE_LINE = /^(Viewed|Saved|Applied)\b/;
  // Lines that are never a company (seen on live cards).
  const NOT_COMPANY = /^(?:viewed|saved|applied|promoted|easy apply|actively reviewing applicants|be an early applicant|posted\b.*|\d+\s+(?:second|minute|hour|day|week|month)s?\s+ago|.*\b(?:alumni|connections?)\b.*\bwork(?:s)? here)$/i;
  const LOCATION_LINE = /\((?:remote|hybrid|on-?site)\)$/i;
  const HIGHLIGHT = 'qts-linkedin-skip';             // the title of a seen card: white on 70% black
  const OLD_TITLE_HIGHLIGHT = 'qts-linkedin-skip-title'; // an earlier version's title strike, cleared
  const BATCH_MS = 400;
  const RETURN_AFTER_MS = 2 * 60_000;

  const style = new CSSStyleSheet();
  let styleAdopted = false;
  let cards = [];            // the cards read on the last look: { id, el, key, title, company, state }
  let skipped = new Set();   // keys the worker said are skipped
  let reported = new Set();  // card ids whose LinkedIn label was already sent
  let status = { state: 'starting', total: 0, readable: 0, seen: 0 };
  let timer = null;
  let nextReason = 'load';   // why the next look may fetch: load, return, panel (paging never does)
  let hiddenAt = 0;
  let disposed = false;

  const alive = () => { try { return !disposed && Boolean(chrome.runtime?.id); } catch { return false; } };
  const onSearchPage = () => /^\/jobs\/(?:search|search-results)(?:\/|$)/.test(location.pathname);
  const lines = (el) => (el.innerText || '').split('\n').map((text) => text.trim()).filter(Boolean);

  /** One card's title, company and LinkedIn label, or null when it does not read cleanly. */
  function readCard(el) {
    const id = (el.getAttribute('componentkey') || '').slice(CARD_PREFIX.length);
    const dismiss = el.querySelector('button[aria-label^="Dismiss "]')?.getAttribute('aria-label') || '';
    const title = dismiss.replace(/^Dismiss\s+/, '').replace(/\s+job$/, '').trim();
    if (!/^\d+$/.test(id) || !title) return null;
    const text = lines(el);
    const at = text.indexOf(title);
    // Cross-check: the title must also be one of the card's visible lines.
    if (at < 0) return null;
    // A card without LinkedIn's verified badge repeats its title line (screen-reader copy + visible
    // copy): the company is the first line after the title lines.
    let next = at + 1;
    while (next < text.length && text[next] === title) next += 1;
    const company = text[next] || '';
    if (!company || company === title || NOT_COMPANY.test(company) || LOCATION_LINE.test(company)) return null;
    const key = keyOf(title, company);
    if (!key) return null;
    const label = text.map((line) => STATE_LINE.exec(line)?.[1]).find(Boolean);
    const place = text[next + 1] || '';
    const location = place && !NOT_COMPANY.test(place) && !STATE_LINE.test(place) ? place : '';
    return { id, el, key, title, company, location, state: label ? STATES[label] : null };
  }

  function adoptStyle() {
    if (styleAdopted) return;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];
    styleAdopted = true;
  }

  function clearPaint() {
    CSS.highlights.delete(HIGHLIGHT);
    CSS.highlights.delete(OLD_TITLE_HIGHLIGHT);
    if (styleAdopted) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== style);
      styleAdopted = false;
    }
  }

  // Every skipped card: its title white on 70% black (a range over each title text, also beside the
  // verified badge). Only the highlight name gets a style: no rule names LinkedIn's elements, and
  // the page is untouched.
  style.replaceSync(`::highlight(${HIGHLIGHT}) { color: #ffffff; background-color: rgba(0, 0, 0, 0.7); }`);
  function paint() {
    const seen = cards.filter((card) => skipped.has(card.key));
    status = { ...status, seen: seen.length };
    if (!seen.length) { clearPaint(); return; }
    const marked = new Highlight();
    for (const card of seen) {
      const walker = document.createTreeWalker(card.el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if ((node.nodeValue || '').trim() !== card.title) continue;
        const range = new Range();
        range.selectNodeContents(node);
        marked.add(range);
      }
    }
    CSS.highlights.delete(OLD_TITLE_HIGHLIGHT);
    CSS.highlights.set(HIGHLIGHT, marked);
    adoptStyle();
  }

  async function signedInAndOn() {
    const stored = await chrome.storage.local.get(['authExpiresAt', 'qtsLinkedInSkipOn']).catch(() => ({}));
    if ((Number(stored.authExpiresAt) || 0) <= Date.now()) return 'signed-out';
    return stored.qtsLinkedInSkipOn === false ? 'off' : 'on';
  }

  /** Reads the cards, asks the worker which are skipped, and paints them. */
  async function look() {
    timer = null;
    if (!alive()) { dispose(); return; }
    if (!onSearchPage() || document.hidden) {
      if (!onSearchPage()) { cards = []; clearPaint(); status = { state: 'not-search', total: 0, readable: 0, seen: 0 }; }
      return;
    }
    const switchState = await signedInAndOn();
    if (switchState !== 'on') { cards = []; clearPaint(); status = { state: switchState, total: 0, readable: 0, seen: 0 }; return; }
    const elements = [...document.querySelectorAll(CARD)];
    const read = elements.map(readCard).filter(Boolean);
    // Self-check: a page where most cards do not read is a layout QTS does not know; paint nothing.
    if (elements.length >= 5 && read.length < elements.length / 2) {
      cards = [];
      clearPaint();
      status = { state: 'paused', total: elements.length, readable: read.length, seen: 0 };
      console.warn(`[QTS LinkedIn skip-list] Paused: only ${read.length} of ${elements.length} job cards could be read (LinkedIn's layout changed).`);
      return;
    }
    cards = read;
    const reason = nextReason;
    nextReason = undefined;
    const marks = read.filter((card) => card.state && !reported.has(card.id))
      .map(({ key, title, company, location, state }) => ({ key, title, company, location, source: state }));
    const reply = await chrome.runtime.sendMessage({
      type: 'QTS_LINKEDIN_SKIPS_MATCH', reason, marks, keys: [...new Set(read.map((card) => card.key))],
    }).catch(() => null);
    if (!alive()) { dispose(); return; }
    if (!reply?.ok) {
      // QTS not reachable, the Super Admin's switch off, or signed out: LinkedIn as usual.
      skipped = new Set();
      clearPaint();
      status = { state: reply?.state || 'server-down', total: elements.length, readable: read.length, seen: 0 };
      return;
    }
    for (const card of read) if (card.state) reported.add(card.id);
    skipped = new Set(reply.skipped);
    status = { state: 'ok', total: elements.length, readable: read.length, seen: 0 };
    paint();
  }

  function schedule(delay = BATCH_MS) {
    if (timer == null && !disposed) timer = setTimeout(() => look().catch((error) => console.warn('[QTS LinkedIn skip-list]', error)), delay);
  }

  // A click on a card (LinkedIn opens it, which marks it viewed): skipped at once, sent in the background.
  function onClick(event) {
    if (!event.isTrusted || !onSearchPage()) return;
    const el = event.target?.closest?.(CARD);
    if (!el) return;
    const card = readCard(el);
    if (!card) return;
    if (status.state !== 'ok') return;
    if (!cards.some((known) => known.id === card.id)) cards.push(card);
    const wasSkipped = skipped.has(card.key);
    skipped.add(card.key);
    paint();
    chrome.runtime.sendMessage({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [{ key: card.key, title: card.title, company: card.company, location: card.location, source: 'clicked' }] })
      .then((reply) => { if (!reply?.ok && !wasSkipped) { skipped.delete(card.key); paint(); schedule(0); } })
      .catch(() => {});
  }

  /** The job shown on the right (currentJobId), read from its card in the list. */
  function selectedCard() {
    const id = new URLSearchParams(location.search).get('currentJobId');
    const el = id ? document.querySelector(`[componentkey="${CARD_PREFIX}${id}"]`) : null;
    return el ? readCard(el) : null;
  }

  async function setSelected(skip) {
    const card = selectedCard();
    if (!card) return { ok: false, error: 'Select a job in the list first.' };
    const reply = await chrome.runtime.sendMessage({
      type: skip ? 'QTS_LINKEDIN_SKIPS_MARK' : 'QTS_LINKEDIN_SKIPS_UNSKIP',
      immediate: true,
      items: [{ key: card.key, title: card.title, company: card.company, location: card.location, source: 'manual' }],
    }).catch(() => null);
    if (!reply?.ok) {
      if (reply?.state) schedule(0);
      return { ok: false, error: reply?.error || (reply?.state === 'admin-off' ? 'Your Super Admin turned the LinkedIn skip-list off.' : 'QTS could not be reached; the skip-list is paused.') };
    }
    if (skip) skipped.add(card.key); else skipped.delete(card.key);
    paint();
    return { ok: true, title: card.title, company: card.company };
  }

  const observer = new MutationObserver(() => { if (alive()) schedule(); else dispose(); });
  function onMessage(message) {
    // After a batch QTS did not take, the worker says "changed": LinkedIn's labels are sent again.
    if (message?.type === 'QTS_LINKEDIN_SKIPS_CHANGED') reported = new Set();
    if (message?.type === 'QTS_PAGE_URL_CHANGED' || message?.type === 'QTS_LINKEDIN_SKIPS_CHANGED') schedule(50);
  }
  function onStorage(changes, area) {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsLinkedInSkipOn)) schedule(0);
  }
  const onPopState = () => schedule(50);
  // Leaving the tab sends the waiting marks now; coming back after a while fetches the latest list.
  const flushNow = () => { chrome.runtime.sendMessage({ type: 'QTS_LINKEDIN_SKIPS_FLUSH' }).catch(() => {}); };
  const onVisibility = () => {
    if (document.hidden) { hiddenAt = Date.now(); flushNow(); return; }
    if (hiddenAt && Date.now() - hiddenAt > RETURN_AFTER_MS) nextReason = 'return';
    schedule(50);
  };
  const onPageHide = () => flushNow();

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    observer.disconnect();
    clearPaint();
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* reloaded */ }
    try { chrome.storage.onChanged.removeListener(onStorage); } catch { /* reloaded */ }
  }

  document.addEventListener('click', onClick, { capture: true, passive: true });
  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  const startObserving = () => {
    if (!document.body) { setTimeout(startObserving, 200); return; }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule(0);
  };
  startObserving();

  /** How the selected job was seen before: { source, location, at }, or null (asks the worker's mirror). */
  async function seenBefore() {
    const card = selectedCard();
    if (!card || !skipped.has(card.key)) return null;
    const reply = await chrome.runtime.sendMessage({ type: 'QTS_LINKEDIN_SKIPS_INFO', key: card.key }).catch(() => null);
    return reply?.ok && reply.info ? reply.info : null;
  }

  /** For "Copy report" when paused: what each card reads as (like the DevTools report), no page changes. */
  function report() {
    const elements = [...document.querySelectorAll(CARD)];
    return JSON.stringify({
      path: location.pathname,
      start: new URLSearchParams(location.search).get('start'),
      status,
      cards: elements.slice(0, 25).map((el) => {
        const text = lines(el);
        const dismiss = el.querySelector('button[aria-label^="Dismiss "]')?.getAttribute('aria-label') || null;
        return { id: (el.getAttribute('componentkey') || '').slice(CARD_PREFIX.length), dismiss, lines: text.slice(0, 10), readsAs: readCard(el) ? 'ok' : 'unreadable' };
      }),
    }, null, 2);
  }

  globalThis.__qtsLinkedInSkip = Object.freeze({
    alive,
    /** { state: ok | paused | off | signed-out | server-down | admin-off | not-search | starting, total, readable, seen } */
    status: () => ({ ...status }),
    selected: () => { const card = selectedCard(); return card ? { title: card.title, company: card.company, location: card.location, skipped: skipped.has(card.key) } : null; },
    seenBefore,
    skipSelected: () => setSelected(true),
    unskipSelected: () => setSelected(false),
    /** The panel opened: fetch the latest list if the last fetch is over 30 s old. */
    refresh: (reason) => { if (reason) nextReason = reason; return look(); },
    report,
  });
})();
