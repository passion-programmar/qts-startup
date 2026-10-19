(function startPageTextHighlighter() {
  if (globalThis.__qtsPageTextHighlighter) return;

  const highlighting = globalThis.__qtsTextHighlighting;
  if (!highlighting || !globalThis.chrome?.storage?.local) return;

  let currentStorageKey = '';
  let currentRules = [];
  let observer = null;
  let refreshQueued = false;

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

  function applyRules(rules) {
    if (!document.body) return;
    unwrapHighlights();
    if (!rules.length) return;

    const orderedRules = [...rules].sort((left, right) => right.text.length - left.text.length);
    const byText = new Map();
    for (const rule of orderedRules) {
      const key = rule.text.toLowerCase();
      if (!byText.has(key)) byText.set(key, rule);
    }
    const matcher = new RegExp(orderedRules.map((rule) => escapeRegExp(rule.text)).join('|'), 'giu');
    const excluded = 'script,style,noscript,textarea,option,[contenteditable="true"],[data-qts-text-highlight]';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!node.nodeValue || !parent || parent.closest(excluded)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const textNode of textNodes) {
      const source = textNode.nodeValue;
      matcher.lastIndex = 0;
      let match;
      let cursor = 0;
      let matched = false;
      const fragment = document.createDocumentFragment();
      while ((match = matcher.exec(source))) {
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
        cursor = matcher.lastIndex;
        matched = true;
      }
      if (matched) {
        if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)));
        textNode.replaceWith(fragment);
      }
    }
  }

  async function loadAndApply() {
    currentStorageKey = highlighting.getGlobalStorageKey();
    const stored = await chrome.storage.local.get(currentStorageKey);
    currentRules = highlighting.normalizeRules(stored[currentStorageKey] || []);
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

  function observePage() {
    if (observer && document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      if (observer) observer.disconnect();
      applyRules(currentRules);
      observePage();
    }, 0);
  }

  globalThis.__qtsPageTextHighlighter = { refresh: loadAndApply };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && currentStorageKey && changes[currentStorageKey]) {
      loadAndApply().catch((error) => console.error('[QTS text highlights] Could not apply saved rules:', error));
    }
  });
  window.addEventListener('popstate', () => {
    loadAndApply().catch((error) => console.error('[QTS text highlights] Could not follow page navigation:', error));
  });
  window.addEventListener('hashchange', () => {
    loadAndApply().catch((error) => console.error('[QTS text highlights] Could not follow page navigation:', error));
  });

  loadAndApply().then(() => {
    if (!document.body) return;
    observer = new MutationObserver(scheduleRefresh);
    observePage();
  }).catch((error) => console.error('[QTS text highlights] Could not load saved rules:', error));
})();
