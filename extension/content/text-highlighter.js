// ChatGPT is driven by Generation and streams constantly, so highlighting there only costs CPU.
const TEXT_HIGHLIGHT_SKIPPED_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i;
// QTS's résumé template pages are printed into PDFs: a highlight there would end up in the file.
const TEXT_HIGHLIGHT_SKIPPED_PATHS = /^\/resume-templates\//;
// Page changes are batched so busy pages are rescanned at most twice a second.
const TEXT_HIGHLIGHT_BATCH_MS = 500;

async function startPageTextHighlighter() {
  // One highlighter per page. The extension restarts it in open tabs after a reload or update: a
  // copy still running stays; one from before the reload (cut off from the extension) is replaced.
  if (globalThis.__qtsPageTextHighlighter?.alive?.()) return;
  if (TEXT_HIGHLIGHT_SKIPPED_HOSTS.test(location.hostname) || TEXT_HIGHLIGHT_SKIPPED_PATHS.test(location.pathname)) return;

  const highlighting = globalThis.__qtsTextHighlighting;
  if (!highlighting || !globalThis.chrome?.storage?.local) return;

  let currentStorageKey = '';
  let currentRules = [];
  let ruleMatcher = null;
  const observer = new MutationObserver(queueChangedNodes);
  const pendingNodes = new Set();
  let batchTimer = null;
  let disposed = false;
  let bodyObserver = null;
  let finishBodyWait = null;
  let sharedRulesRequestUrl = '';
  const excluded = 'script,style,noscript,textarea,option,[contenteditable="true"],[data-qts-text-highlight]';
  // The browser paints the highlights (CSS Custom Highlight API): the page's HTML is never changed.
  // Each rule is one named Highlight with its colours (one ::highlight() style); its ranges cover
  // that rule's matches. rangesByNode keeps each text node's ranges, to redo or drop them.
  const HIGHLIGHT_PREFIX = 'qts-text-highlight-';
  const highlightStyle = new CSSStyleSheet();
  let styleAdopted = false;
  let highlightNames = [];
  let highlightByRuleId = new Map();
  let ruleById = new Map();
  const rangesByNode = new Map();
  let prunePending = false;

  function contextAvailable() {
    try { return !disposed && Boolean(chrome.runtime?.id); }
    catch { return false; }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopWatching();
    bodyObserver?.disconnect();
    finishBodyWait?.();
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('hashchange', onNavigation);
    document.removeEventListener('visibilitychange', onVisibility);
    try { chrome.storage.onChanged.removeListener(onStorage); } catch { /* The extension was reloaded. */ }
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* The extension was reloaded. */ }
    clearHighlights();
    removeHighlightStyle();
    unwrapLegacyMarks();
    currentRules = [];
    ruleMatcher = null;
    jobPageCheck = null;
  }

  function handleError(error, message) {
    if (!contextAvailable() || /extension context invalidated/i.test(String(error?.message || error))) {
      dispose();
      return;
    }
    console.error(`[QTS text highlights] ${message}:`, error);
  }

  function refresh() {
    return loadAndApply().catch(error => handleError(error, 'Could not apply saved rules'));
  }

  // One wait for <body>, shared by every caller: a second call while the first still waits (an
  // extension reload, a page rebuilding its document) must not replace the first watcher, whose
  // callback would then find the shared variable already cleared.
  let bodyWait = null;
  function waitForDocumentBody() {
    if (document.body) return Promise.resolve();
    if (bodyWait) return bodyWait;
    bodyWait = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!contextAvailable()) { dispose(); return; }
        if (!document.body) return;
        observer.disconnect();
        if (bodyObserver === observer) bodyObserver = null;
        finishBodyWait = null;
        bodyWait = null;
        resolve();
      });
      bodyObserver = observer;
      finishBodyWait = () => { bodyWait = null; resolve(); };
      observer.observe(document, { childList: true, subtree: true });
    });
    return bodyWait;
  }

  // An earlier version wrapped matches in <mark> elements: any left on the page become plain text again.
  function unwrapLegacyMarks() {
    const marks = document.querySelectorAll('mark[data-qts-text-highlight]');
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      mark.replaceWith(...mark.childNodes);
      parent.normalize();
    }
  }

  function adoptHighlightStyle() {
    if (styleAdopted) return;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightStyle];
    styleAdopted = true;
  }

  function removeHighlightStyle() {
    if (!styleAdopted) return;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== highlightStyle);
    styleAdopted = false;
  }

  function clearHighlights() {
    for (const name of highlightNames) CSS.highlights.delete(name);
    highlightNames = [];
    highlightByRuleId = new Map();
    ruleById = new Map();
    rangesByNode.clear();
  }

  function forgetNode(textNode) {
    const entries = rangesByNode.get(textNode);
    if (!entries) return;
    for (const { ruleId, range } of entries) highlightByRuleId.get(ruleId)?.delete(range);
    rangesByNode.delete(textNode);
  }

  // Text the page removed: its ranges go too.
  function pruneDetached() {
    for (const textNode of [...rangesByNode.keys()]) if (!textNode.isConnected) forgetNode(textNode);
  }

  /** What is highlighted now, in page order: { id, text, textColor, backgroundColor } (for tests and checks). */
  function highlightedMatches() {
    const found = [];
    for (const [textNode, entries] of rangesByNode) {
      if (!textNode.isConnected) continue;
      for (const { ruleId, range } of entries) found.push({ ruleId, range });
    }
    found.sort((left, right) => left.range.compareBoundaryPoints(Range.START_TO_START, right.range));
    return found.map(({ ruleId, range }) => {
      const rule = ruleById.get(ruleId) || {};
      return { id: ruleId, text: range.toString(), textColor: rule.textColor, backgroundColor: rule.backgroundColor };
    });
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildRuleMatcher(rules) {
    if (!rules.length) return null;
    const orderedRules = [...rules].sort((left, right) => right.text.length - left.text.length);
    const byText = new Map();
    for (const rule of orderedRules) {
      const key = rule.text.toLowerCase();
      if (!byText.has(key)) byText.set(key, rule);
    }
    const pattern = new RegExp(orderedRules.map((rule) => escapeRegExp(rule.text)).join('|'), 'giu');
    return { pattern, byText };
  }

  // The same matching as before; each match becomes a range in its rule's highlight.
  function highlightTextNode(textNode) {
    forgetNode(textNode);
    const source = textNode.nodeValue;
    const parent = textNode.parentElement;
    if (!source || !parent || parent.closest(excluded)) return;
    const { pattern, byText } = ruleMatcher;
    pattern.lastIndex = 0;
    let match;
    const entries = [];
    while ((match = pattern.exec(source))) {
      const rule = byText.get(match[0].toLowerCase());
      if (!rule) continue;
      const highlight = highlightByRuleId.get(rule.id);
      if (!highlight) continue;
      const range = new Range();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, match.index + match[0].length);
      highlight.add(range);
      entries.push({ ruleId: rule.id, range });
    }
    if (entries.length) rangesByNode.set(textNode, entries);
  }

  function highlightWithin(root) {
    if (!ruleMatcher || !root?.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) {
      highlightTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(excluded)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) highlightTextNode(textNode);
  }

  function observePage() {
    if (contextAvailable() && !document.hidden && ruleMatcher && document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  // Highlighting changes nothing in the page, so the watcher never sees its own work.
  function applyRules(rules) {
    if (!document.body) return;
    observer.disconnect();
    pendingNodes.clear();
    unwrapLegacyMarks();
    clearHighlights();
    ruleMatcher = buildRuleMatcher(rules);
    if (!ruleMatcher) {
      removeHighlightStyle();
      return;
    }
    const styles = [];
    rules.forEach((rule, index) => {
      const name = `${HIGHLIGHT_PREFIX}${index}`;
      const highlight = new Highlight();
      CSS.highlights.set(name, highlight);
      highlightNames.push(name);
      highlightByRuleId.set(rule.id, highlight);
      ruleById.set(rule.id, rule);
      // Colours are checked #rrggbb values (normalizeRule), so they are safe in the style text.
      styles.push(`::highlight(${name}) { color: ${rule.textColor}; background-color: ${rule.backgroundColor}; }`);
    });
    highlightStyle.replaceSync(styles.join('\n'));
    adoptHighlightStyle();
    highlightWithin(document.body);
    observePage();
  }

  function queueChangedNodes(records) {
    if (!contextAvailable()) { dispose(); return; }
    for (const record of records) {
      if (record.type === 'characterData') pendingNodes.add(record.target);
      else for (const node of record.addedNodes) pendingNodes.add(node);
      if (record.removedNodes?.length) prunePending = true;
    }
    if ((pendingNodes.size || prunePending) && batchTimer == null) {
      batchTimer = setTimeout(highlightChangedNodes, TEXT_HIGHLIGHT_BATCH_MS);
    }
  }

  function highlightChangedNodes() {
    if (!contextAvailable()) { dispose(); return; }
    batchTimer = null;
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    if (prunePending) {
      prunePending = false;
      pruneDetached();
    }
    for (const node of nodes) highlightWithin(node);
  }

  // Hidden, the page is not watched at all; shown again, it is highlighted once and watched again.
  function stopWatching() {
    observer.disconnect();
    pendingNodes.clear();
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  // Highlights show only on a job page (asked once per address) while its tab is shown.
  let jobPageUrl = '';
  let jobPageCheck = null;
  let sharedRulesUrl = '';
  function isJobPage() {
    if (jobPageUrl !== location.href) {
      jobPageUrl = location.href;
      jobPageCheck = chrome.runtime.sendMessage({ type: 'QTS_IS_JOB_PAGE' })
        .then((reply) => reply?.jobPage === true)
        .catch(error => { if (!contextAvailable() || /extension context invalidated/i.test(String(error?.message || error))) dispose(); return false; });
    }
    return jobPageCheck;
  }

  async function loadAndApply() {
    if (!contextAvailable()) { dispose(); return; }
    await waitForDocumentBody();
    if (!contextAvailable()) { dispose(); return; }
    if (document.hidden) {
      stopWatching();
      return;
    }
    currentStorageKey = highlighting.getGlobalStorageKey();
    const stored = await chrome.storage.local.get([
      currentStorageKey,
      'authExpiresAt',
    ]);
    if (!contextAvailable()) { dispose(); return; }
    currentRules = highlighting.normalizeRules(stored[currentStorageKey] || []);
    if ((Number(stored.authExpiresAt) || 0) <= Date.now()) {
      applyRules([]);
      return;
    }
    const url = location.href;
    const jobPage = await isJobPage();
    if (!contextAvailable()) { dispose(); return; }
    if (document.hidden || url !== location.href) return;
    if (!jobPage) {
      applyRules([]);
      return;
    }
    applyRules(currentRules);
    if (sharedRulesUrl === url || sharedRulesRequestUrl === url) return;
    sharedRulesRequestUrl = url;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_GLOBAL_TEXT_HIGHLIGHTS' });
      if (!response?.success) {
        console.warn('[QTS text highlights] Shared rules are unavailable:', response?.message || 'Unknown error.');
      } else {
        sharedRulesUrl = url;
      }
    } catch (error) {
      if (!contextAvailable() || /extension context invalidated/i.test(String(error?.message || error))) { dispose(); return; }
      console.warn('[QTS text highlights] Could not request shared rules:', error);
    } finally {
      if (sharedRulesRequestUrl === url) sharedRulesRequestUrl = '';
    }
  }

  globalThis.__qtsPageTextHighlighter = { refresh, alive: contextAvailable, highlights: highlightedMatches };
  function onStorage(changes, area) {
    if (
      area === 'local' &&
      currentStorageKey &&
      (
        changes[currentStorageKey]
        || changes.authExpiresAt
      )
    ) {
      refresh();
    }
  }
  function onMessage(message) {
    if (message?.type !== 'QTS_PAGE_URL_CHANGED') return;
    refresh();
  }
  function onNavigation() { refresh(); }
  function onVisibility() {
    if (document.hidden) stopWatching();
    else refresh();
  }
  if (!contextAvailable()) { dispose(); return; }
  chrome.storage.onChanged.addListener(onStorage);
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);
  document.addEventListener('visibilitychange', onVisibility);

  await refresh();
}

function startPageTextHighlighterAfterLoad() {
  startPageTextHighlighter().catch((error) => {
    if (/extension context invalidated/i.test(String(error?.message || error))) return;
    console.error('[QTS text highlights] Could not verify page access:', error);
  });
}

startPageTextHighlighterAfterLoad();
