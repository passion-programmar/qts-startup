// ChatGPT is driven by Generation and streams constantly, so highlighting there only costs CPU.
const TEXT_HIGHLIGHT_SKIPPED_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com)$/i;
// Page changes are batched so busy pages are rescanned at most twice a second.
const TEXT_HIGHLIGHT_BATCH_MS = 500;

async function startPageTextHighlighter() {
  if (globalThis.__qtsPageTextHighlighter) return;
  if (TEXT_HIGHLIGHT_SKIPPED_HOSTS.test(location.hostname)) return;

  const highlighting = globalThis.__qtsTextHighlighting;
  if (!highlighting || !globalThis.chrome?.storage?.local) return;

  let currentStorageKey = '';
  let currentRules = [];
  let ruleMatcher = null;
  const observer = new MutationObserver(queueChangedNodes);
  const pendingNodes = new Set();
  let batchTimer = null;
  const excluded = 'script,style,noscript,textarea,option,[contenteditable="true"],[data-qts-text-highlight]';

  function waitForDocumentBody() {
    if (document.body) return Promise.resolve();
    return new Promise((resolve) => {
      const bodyObserver = new MutationObserver(() => {
        if (!document.body) return;
        bodyObserver.disconnect();
        resolve();
      });
      bodyObserver.observe(document, { childList: true, subtree: true });
    });
  }

  function unwrapHighlights() {
    const marks = document.querySelectorAll('mark[data-qts-text-highlight]');
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      mark.replaceWith(...mark.childNodes);
      parent.normalize();
    }
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

  function highlightTextNode(textNode) {
    const source = textNode.nodeValue;
    const parent = textNode.parentElement;
    if (!source || !parent || parent.closest(excluded)) return;
    const { pattern, byText } = ruleMatcher;
    pattern.lastIndex = 0;
    let match;
    let cursor = 0;
    let matched = false;
    const fragment = document.createDocumentFragment();
    while ((match = pattern.exec(source))) {
      const rule = byText.get(match[0].toLowerCase());
      if (!rule) continue;
      if (match.index > cursor) {
        fragment.append(document.createTextNode(source.slice(cursor, match.index)));
      }
      const mark = document.createElement('mark');
      mark.dataset.qtsTextHighlight = rule.id;
      mark.textContent = match[0];
      mark.style.color = rule.textColor;
      mark.style.backgroundColor = rule.backgroundColor;
      mark.style.boxDecorationBreak = 'clone';
      fragment.append(mark);
      cursor = pattern.lastIndex;
      matched = true;
    }
    if (matched) {
      if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
      textNode.replaceWith(fragment);
    }
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
    if (ruleMatcher && document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  // Our own DOM edits must not be observed, or every highlight would trigger another pass.
  function withoutObserving(change) {
    observer.disconnect();
    try {
      change();
    } finally {
      observePage();
    }
  }

  function applyRules(rules) {
    if (!document.body) return;
    observer.disconnect();
    pendingNodes.clear();
    unwrapHighlights();
    ruleMatcher = buildRuleMatcher(rules);
    withoutObserving(() => highlightWithin(document.body));
  }

  function queueChangedNodes(records) {
    for (const record of records) {
      if (record.type === 'characterData') pendingNodes.add(record.target);
      else for (const node of record.addedNodes) pendingNodes.add(node);
    }
    if (pendingNodes.size && batchTimer == null) {
      batchTimer = setTimeout(highlightChangedNodes, TEXT_HIGHLIGHT_BATCH_MS);
    }
  }

  function highlightChangedNodes() {
    batchTimer = null;
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    withoutObserving(() => {
      for (const node of nodes) highlightWithin(node);
    });
  }

  async function loadAndApply() {
    await waitForDocumentBody();
    currentStorageKey = highlighting.getGlobalStorageKey();
    const stored = await chrome.storage.local.get([
      currentStorageKey,
      'authExpiresAt',
    ]);
    currentRules = highlighting.normalizeRules(stored[currentStorageKey] || []);
    if ((Number(stored.authExpiresAt) || 0) <= Date.now()) {
      applyRules([]);
      return;
    }
    applyRules(currentRules);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_GLOBAL_TEXT_HIGHLIGHTS' });
      if (!response?.success) {
        console.warn('[QTS text highlights] Shared rules are unavailable:', response?.message || 'Unknown error.');
      }
    } catch (error) {
      console.warn('[QTS text highlights] Could not request shared rules:', error);
    }
  }

  globalThis.__qtsPageTextHighlighter = { refresh: loadAndApply };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === 'local' &&
      currentStorageKey &&
      (
        changes[currentStorageKey]
        || changes.authExpiresAt
      )
    ) {
      loadAndApply().catch((error) => console.error('[QTS text highlights] Could not apply saved rules:', error));
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'QTS_PAGE_URL_CHANGED') return;
    loadAndApply().catch((error) => {
      console.error('[QTS text highlights] Could not follow page navigation:', error);
    });
  });
  window.addEventListener('popstate', () => {
    loadAndApply().catch((error) => console.error('[QTS text highlights] Could not follow page navigation:', error));
  });
  window.addEventListener('hashchange', () => {
    loadAndApply().catch((error) => console.error('[QTS text highlights] Could not follow page navigation:', error));
  });

  loadAndApply().catch((error) => console.error('[QTS text highlights] Could not load saved rules:', error));
}

function startPageTextHighlighterAfterLoad() {
  startPageTextHighlighter().catch((error) => {
    console.error('[QTS text highlights] Could not verify page access:', error);
  });
}

if (document.readyState === 'complete') startPageTextHighlighterAfterLoad();
else window.addEventListener('load', startPageTextHighlighterAfterLoad, { once: true });
