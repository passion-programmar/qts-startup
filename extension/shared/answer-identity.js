// Identity is context-aware, not an authorization token. Never merges or writes records.
(function init(global) {
  // Static require lets the Profile client bundle include the same registry as MV3.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const semantics = global.__qtsSemanticFields || (typeof module !== 'undefined' && require('./semantic-fields.js'));
  function identity(question) {
    const found = semantics.recognize(question);
    if (!found?.definition || found.blocked) return null;
    return { version: 1, key: found.key, valueType: found.definition.valueType };
  }
  function same(left, right) {
    const a = identity(left), b = identity(right);
    return Boolean(a && b && a.key === b.key);
  }
  function duplicateGroups(rows) {
    const groups = new Map();
    for (const row of rows) {
      const meaning = identity(row.questionText);
      if (!meaning) continue;
      const key = JSON.stringify([row.managerId || '', row.contextKey || [row.scope, row.candidateId || '', row.jobId || ''], meaning.key]);
      const group = groups.get(key) || []; group.push(row); groups.set(key, group);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  }
  function variantKey(variant) {
    return JSON.stringify([variant.questionText || '', variant.kind, [...(variant.options || [])].sort(), variant.representation || null, variant.policyContext || null]);
  }
  function selectVariant(row, field) {
    const variants = (row.variants || []).map((entry) => entry.normalVariation || entry).filter((entry) => entry.questionText && same(entry.questionText, row.questionText)
      && entry.kind === field.kind && JSON.stringify([...(entry.options || [])].sort()) === JSON.stringify([...(field.options || [])].sort()));
    const exact = variants.filter((entry) => entry.questionText.trim().toLowerCase() === field.label.trim().toLowerCase());
    const matches = exact.length ? exact : [];
    if (new Set(matches.map((entry) => JSON.stringify([entry.answer, entry.representation || null]))).size > 1) return { conflict: true };
    return { variant: matches[0] || null };
  }
  const api = Object.freeze({ version: 1, identity, same, duplicateGroups, variantKey, selectVariant });
  global.__qtsAnswerIdentity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
