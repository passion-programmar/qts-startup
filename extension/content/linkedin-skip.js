// LinkedIn skip-list on LinkedIn's job search: cards whose (title, company) the Manager has already
// seen (clicked, labelled Viewed / Saved / Applied by LinkedIn, applied or saved in QTS) look faded,
// their title struck through in amber. Only the CSS Custom Highlight API paints it (text ranges and
// their ::highlight colours): LinkedIn's HTML is never changed, no style rule names its elements,
// nothing is hidden or clicked. Cards are read only through hooks confirmed on the live
// page (2026-11-21): the card's componentkey "job-card-component-ref-<id>", the title in its Dismiss
// button's aria-label (and as a text line), the company as the next line. LinkedIn's class names are
// hashed and never used. When fewer than half the cards read cleanly, the feature pauses itself.
(function initLinkedInSkip() {
  if (globalThis.__qtsLinkedInSkip?.alive?.()) return;
  const keyOf = globalThis.__qtsTitleCompanyKey?.computeTitleCompanyKey;
  if (!keyOf || !/(^|\.)linkedin\.com$/i.test(location.hostname)) return;

  const CARD = '[componentkey^="job-card-component-ref-"]';
  const CARD_PREFIX = 'job-card-component-ref-';
  const STATES = { Viewed: 'viewed', Saved: 'saved', Applied: 'applied' };
  // Lines that are never a company (seen on live cards).
  const NOT_COMPANY = /^(?:viewed|saved|applied|promoted|easy apply|actively reviewing applicants|be an early applicant|posted\b.*|\d+\s+(?:second|minute|hour|day|week|month)s?\s+ago|.*\b(?:alumni|connections?)\b.*\bwork(?:s)? here)$/i;
  const LOCATION_LINE = /\((?:remote|hybrid|on-?site)\)$/i;
  const HIGHLIGHT = 'qts-linkedin-skip';             // the whole card's text: faded
  const TITLE_HIGHLIGHT = 'qts-linkedin-skip-title';  // the title: struck through, amber
  const BATCH_MS = 400;

  const style = new CSSStyleSheet();
  let styleAdopted = false;
  let cards = [];            // the cards read on the last look: { id, el, key, title, company, state }
  let skipped = new Set();   // keys the worker said are skipped
  let reported = new Set();  // card ids whose LinkedIn label was already sent
  let status = { state: 'starting', total: 0, readable: 0, seen: 0 };
  let timer = null;
  let lookedAtUrl = '';
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
    const company = text[at + 1] || '';
    if (!company || company === title || NOT_COMPANY.test(company) || LOCATION_LINE.test(company)) return null;
    const key = keyOf(title, company);
    if (!key) return null;
    const label = text.find((line) => STATES[line]);
    return { id, el, key, title, company, state: label ? STATES[label] : null };
  }

  function adoptStyle() {
    if (styleAdopted) return;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, style];
    styleAdopted = true;
  }

  function clearPaint() {
    CSS.highlights.delete(HIGHLIGHT);
    CSS.highlights.delete(TITLE_HIGHLIGHT);
    if (styleAdopted) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== style);
      styleAdopted = false;
    }
  }

  // Every skipped card: its whole text faded (one range over the card), its title struck through in
  // amber (a range over each title line, painted on top). Only highlight names get styles: no rule
  // names LinkedIn's elements, and the page is untouched.
  style.replaceSync([
    `::highlight(${HIGHLIGHT}) { color: #9aa3af; }`,
    `::highlight(${TITLE_HIGHLIGHT}) { color: #78350f; background-color: #fde68a; text-decoration: line-through; text-decoration-thickness: 2px; text-decoration-color: #b45309; }`,
  ].join('\n'));
  function paint() {
    const seen = cards.filter((card) => skipped.has(card.key));
    status = { ...status, seen: seen.length };
    if (!seen.length) { clearPaint(); return; }
    const faded = new Highlight();
    const titles = new Highlight();
    titles.priority = 1;
    for (const card of seen) {
      const whole = new Range();
      whole.selectNodeContents(card.el);
      faded.add(whole);
      for (const node of card.el.querySelectorAll('*')) {
        if (node.children.length) continue;
        if ((node.innerText || node.textContent || '').trim() !== card.title) continue;
        const range = new Range();
        range.selectNodeContents(node);
        titles.add(range);
      }
    }
    CSS.highlights.set(HIGHLIGHT, faded);
    CSS.highlights.set(TITLE_HIGHLIGHT, titles);
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
    status = { state: 'ok', total: elements.length, readable: read.length, seen: status.seen };
    const refresh = lookedAtUrl !== location.href;
    lookedAtUrl = location.href;
    const marks = read.filter((card) => card.state && !reported.has(card.id))
      .map(({ key, title, company, state }) => ({ key, title, company, source: state }));
    const reply = await chrome.runtime.sendMessage({
      type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh, marks, keys: [...new Set(read.map((card) => card.key))],
    }).catch(() => null);
    if (!alive()) { dispose(); return; }
    if (reply?.ok) {
      for (const card of read) if (card.state) reported.add(card.id);
      skipped = new Set(reply.skipped);
    } else if (reply?.signedOut) {
      status = { ...status, state: 'signed-out' };
      skipped = new Set();
    }
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
    if (!cards.some((known) => known.id === card.id)) cards.push(card);
    skipped.add(card.key);
    paint();
    chrome.runtime.sendMessage({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [{ key: card.key, title: card.title, company: card.company, source: 'clicked' }] }).catch(() => {});
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
      items: [{ key: card.key, title: card.title, company: card.company, source: 'manual' }],
    }).catch(() => null);
    if (!reply?.ok) return { ok: false, error: reply?.error || 'QTS could not change the skip-list.' };
    if (skip) skipped.add(card.key); else skipped.delete(card.key);
    paint();
    return { ok: true, title: card.title, company: card.company };
  }

  const observer = new MutationObserver(() => { if (alive()) schedule(); else dispose(); });
  function onMessage(message) {
    if (message?.type === 'QTS_PAGE_URL_CHANGED' || message?.type === 'QTS_LINKEDIN_SKIPS_CHANGED') schedule(50);
  }
  function onStorage(changes, area) {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsLinkedInSkipOn)) schedule(0);
  }
  const onPopState = () => schedule(50);
  const onVisibility = () => { if (!document.hidden) schedule(50); };

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    observer.disconnect();
    clearPaint();
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', onPopState);
    document.removeEventListener('visibilitychange', onVisibility);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* reloaded */ }
    try { chrome.storage.onChanged.removeListener(onStorage); } catch { /* reloaded */ }
  }

  document.addEventListener('click', onClick, { capture: true, passive: true });
  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibility);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  const startObserving = () => {
    if (!document.body) { setTimeout(startObserving, 200); return; }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule(0);
  };
  startObserving();

  globalThis.__qtsLinkedInSkip = Object.freeze({
    alive,
    /** { state: ok | paused | off | signed-out | not-search | starting, total, readable, seen } */
    status: () => ({ ...status }),
    selected: () => { const card = selectedCard(); return card ? { title: card.title, company: card.company, skipped: skipped.has(card.key) } : null; },
    skipSelected: () => setSelected(true),
    unskipSelected: () => setSelected(false),
    refresh: () => look(),
  });
})();
