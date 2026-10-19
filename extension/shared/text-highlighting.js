(function initTextHighlighting(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__qtsTextHighlighting = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
  const LEGACY_GLOBAL_STORAGE_KEY = 'qtsTextHighlights';
  const GLOBAL_STORAGE_KEY = 'qtsGlobalTextHighlightsCache';
  const LEGACY_PAGE_STORAGE_PREFIX = 'qtsPageTextHighlights:';
  const GLOBAL_STORAGE_TIMESTAMP_KEY = 'qtsGlobalTextHighlightsFetchedAt';

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') {
      throw new TypeError('A highlight rule must be an object.');
    }
    const id = String(rule.id || '').trim();
    const text = String(rule.text || '').trim();
    const textColor = String(rule.textColor || '').trim();
    const backgroundColor = String(rule.backgroundColor || '').trim();
    if (!id) throw new TypeError('A highlight rule needs an ID.');
    if (!text) throw new TypeError('Enter text or characters to highlight.');
    if (!COLOR_PATTERN.test(textColor) || !COLOR_PATTERN.test(backgroundColor)) {
      throw new TypeError('Choose valid text and background colors.');
    }
    return { id, text, textColor, backgroundColor };
  }

  function normalizeRules(rules) {
    if (!Array.isArray(rules)) {
      throw new TypeError('Saved highlight rules must be a list.');
    }
    const normalized = rules.map(normalizeRule);
    const ids = new Set();
    const texts = new Set();
    for (const rule of normalized) {
      if (ids.has(rule.id)) throw new TypeError('Saved highlight rules contain a duplicate ID.');
      const textKey = rule.text.toLowerCase();
      if (texts.has(textKey)) throw new TypeError('Saved highlight rules contain duplicate text.');
      ids.add(rule.id);
      texts.add(textKey);
    }
    return normalized;
  }

  function getPageStorageKey(pageUrl) {
    let page;
    try {
      page = new URL(pageUrl);
    } catch {
      throw new TypeError('Open a supported web page before managing text highlights.');
    }
    if (page.protocol !== 'http:' && page.protocol !== 'https:') {
      throw new TypeError('Text highlights are available on HTTP and HTTPS pages only.');
    }
    page.hash = '';
    return `${LEGACY_PAGE_STORAGE_PREFIX}${encodeURIComponent(page.href)}`;
  }

  function getGlobalStorageKey() {
    return GLOBAL_STORAGE_KEY;
  }

  function migratePageRules(storage) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
      throw new TypeError('Saved highlight storage must be an object.');
    }

    const legacyKeys = Object.keys(storage)
      .filter((key) => key.startsWith(LEGACY_PAGE_STORAGE_PREFIX))
      .sort();
    const sources = [];
    if (Object.prototype.hasOwnProperty.call(storage, LEGACY_GLOBAL_STORAGE_KEY)) {
      sources.push(storage[LEGACY_GLOBAL_STORAGE_KEY]);
      legacyKeys.unshift(LEGACY_GLOBAL_STORAGE_KEY);
    }
    for (const key of legacyKeys) {
      if (key !== LEGACY_GLOBAL_STORAGE_KEY) sources.push(storage[key]);
    }

    const rules = [];
    const ids = new Set();
    const texts = new Set();
    let duplicatesMerged = 0;
    for (const source of sources) {
      if (!Array.isArray(source)) {
        throw new TypeError('Saved highlight rules must be a list.');
      }
      for (const candidate of source) {
        const rule = normalizeRule(candidate);
        const textKey = rule.text.toLowerCase();
        if (ids.has(rule.id) || texts.has(textKey)) {
          duplicatesMerged += 1;
          continue;
        }
        ids.add(rule.id);
        texts.add(textKey);
        rules.push(rule);
      }
    }

    return { rules, legacyKeys, duplicatesMerged };
  }

  return {
    normalizeRule,
    normalizeRules,
    getPageStorageKey,
    getGlobalStorageKey,
    getGlobalStorageTimestampKey: () => GLOBAL_STORAGE_TIMESTAMP_KEY,
    migratePageRules,
  };
});
