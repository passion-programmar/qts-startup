const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPageStorageKey,
  getGlobalStorageKey,
  migratePageRules,
  normalizeRule,
  normalizeRules,
} = require('./text-highlighting');

test('rules are trimmed and keep their selected colors', () => {
  assert.deepEqual(normalizeRule({
    id: 'rule-1',
    text: '  JavaScript  ',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  }), {
    id: 'rule-1',
    text: 'JavaScript',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  });
});

test('rules require text and valid six-digit colors', () => {
  assert.throws(() => normalizeRule({
    id: 'rule-1',
    text: ' ',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  }), /Enter text or characters/);
  assert.throws(() => normalizeRule({
    id: 'rule-1',
    text: 'term',
    textColor: 'red',
    backgroundColor: '#aabbcc',
  }), /valid text and background colors/);
});

test('rule lists reject malformed data and duplicate IDs', () => {
  assert.throws(() => normalizeRules({}), /must be a list/);
  assert.throws(() => normalizeRules([
    { id: 'same', text: 'one', textColor: '#112233', backgroundColor: '#aabbcc' },
    { id: 'same', text: 'two', textColor: '#112233', backgroundColor: '#aabbcc' },
  ]), /duplicate ID/);
  assert.throws(() => normalizeRules([
    { id: 'one', text: 'JavaScript', textColor: '#112233', backgroundColor: '#aabbcc' },
    { id: 'two', text: ' javascript ', textColor: '#223344', backgroundColor: '#bbccdd' },
  ]), /duplicate text/);
});

test('storage keys are page-specific and ignore URL fragments', () => {
  assert.equal(
    getPageStorageKey('https://example.com/jobs/1?source=mail#details'),
    getPageStorageKey('https://example.com/jobs/1?source=mail#apply')
  );
  assert.notEqual(
    getPageStorageKey('https://example.com/jobs/1'),
    getPageStorageKey('https://example.com/jobs/2')
  );
});

test('storage keys reject non-web pages', () => {
  assert.throws(() => getPageStorageKey('chrome://extensions'), /HTTP and HTTPS/);
  assert.throws(() => getPageStorageKey('not a URL'), /Open a supported web page/);
});

test('global storage key is independent of the current page', () => {
  assert.equal(getGlobalStorageKey(), 'qtsGlobalTextHighlightsCache');
});

test('page-specific rules migrate to global storage and merge duplicate text', () => {
  const baseRule = {
    id: 'global-rule',
    text: 'JavaScript',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  };
  const migratedRule = {
    id: 'legacy-rule',
    text: 'TypeScript',
    textColor: '#223344',
    backgroundColor: '#bbccdd',
  };
  const duplicateRule = {
    id: 'duplicate-rule',
    text: 'typescript',
    textColor: '#334455',
    backgroundColor: '#ccddee',
  };

  assert.deepEqual(migratePageRules({
    qtsTextHighlights: [baseRule],
    'qtsPageTextHighlights:https%3A%2F%2Fa.example%2F': [migratedRule],
    'qtsPageTextHighlights:https%3A%2F%2Fb.example%2F': [duplicateRule],
    unrelatedStorage: 'untouched',
  }), {
    rules: [baseRule, migratedRule],
    legacyKeys: [
      'qtsTextHighlights',
      'qtsPageTextHighlights:https%3A%2F%2Fa.example%2F',
      'qtsPageTextHighlights:https%3A%2F%2Fb.example%2F',
    ],
    duplicatesMerged: 1,
  });
});

test('legacy migration rejects malformed saved rules', () => {
  assert.throws(() => migratePageRules({
    'qtsPageTextHighlights:https%3A%2F%2Fa.example%2F': [{ text: 'missing fields' }],
  }), /needs an ID/);
});
